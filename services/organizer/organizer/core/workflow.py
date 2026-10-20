"""Scanning, categorization and plan generation."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import delete
from sqlalchemy.orm import Session

from ..ai.service import AIService, resolve_provider
from ..database.models import FileOperation, FileRecord, OrganizationSession
from ..database.repository import SettingsRepository, add_allowed_root
from ..filesystem.safety import ensure_within, sanitize_folder_name, unique_destination
from ..schemas import CategoryCount, CategorySummary, FileOut, PlanItem
from .categories import (
    CATEGORY_FOLDERS,
    DEFAULT_CATEGORIES,
    needs_ai,
    rule_category,
)
from .scanner import ScanResult, scan_folder


@dataclass
class PlanOutcome:
    items: list[PlanItem]
    categories: list[CategorySummary]
    unchanged: int
    ai_used: bool
    provider: str | None
    model: str | None
    warnings: list[str]


def scan_into_session(
    db: Session,
    *,
    path: str,
    max_depth: int = 12,
    max_files: int = 20000,
    include_hidden: bool = False,
    include_system: bool = False,
    source: str = "manual",
) -> tuple[OrganizationSession, ScanResult]:
    from ..filesystem.safety import resolve_selected_folder

    root = resolve_selected_folder(path)
    add_allowed_root(db, root)
    result = scan_folder(
        root,
        max_depth=max_depth,
        max_files=max_files,
        include_hidden=include_hidden,
        include_system=include_system,
    )

    session = OrganizationSession(
        root_path=str(root),
        status="scanned",
        source=source,
        file_count=len(result.files),
        total_bytes=result.total_bytes,
        skipped_count=result.skipped,
    )
    db.add(session)
    db.flush()
    for item in result.files:
        category, confidence, reason = rule_category(item.name)
        db.add(
            FileRecord(
                session_id=session.id,
                path=item.path,
                name=item.name,
                extension=item.extension,
                size=item.size,
                modified_at=item.modified_at,
                category=category,
                confidence=confidence,
                reason=reason,
                source="rules",
            )
        )
    db.commit()
    db.refresh(session)
    return session, result


def categorize_session(
    db: Session,
    session: OrganizationSession,
    settings: SettingsRepository,
    *,
    use_ai: bool,
    ai_scope: str = "ambiguous",
    categories: list[str] | None = None,
) -> tuple[bool, str | None, str | None, list[str]]:
    """Apply rules then (optionally) AI to a session's files."""
    allowed = categories or DEFAULT_CATEGORIES
    files: list[FileRecord] = list(session.files)
    warnings: list[str] = []

    for record in files:
        category, confidence, reason = rule_category(record.name)
        record.category = category
        record.confidence = confidence
        record.reason = reason
        record.source = "rules"
    db.flush()

    ai_used = False
    provider_id: str | None = None
    model: str | None = None

    if use_ai and ai_scope != "none" and files:
        targets = files if ai_scope == "all" else [f for f in files if needs_ai(f.name, f.category or "", f.confidence or 0)]
        if ai_scope == "all":
            targets = files
        if targets:
            provider = resolve_provider(settings)
            if provider is None:
                warnings.append(
                    "AI provider is not ready, so deterministic rules were used for every file. "
                    "Add a free provider key in Settings or start Ollama to enable AI suggestions."
                )
            else:
                service = AIService(settings, provider)
                payload = [
                    {
                        "path": record.path,
                        "name": record.name,
                        "extension": record.extension,
                        "size": record.size,
                    }
                    for record in targets
                ]
                ai_result = service.categorize(payload, allowed)
                for record in targets:
                    suggestion = ai_result.suggestions.get(record.path)
                    if suggestion is None:
                        continue
                    record.category = suggestion.category
                    record.confidence = suggestion.confidence
                    record.reason = suggestion.reason
                    record.source = "ai"
                ai_used = ai_result.used
                provider_id = ai_result.provider
                model = ai_result.model
                if ai_result.errors:
                    warnings.append(
                        "AI categorization was incomplete; remaining files kept rule-based categories. "
                        + ai_result.errors[0][:180]
                    )

    session.ai_used = ai_used
    session.ai_provider = provider_id
    session.ai_model = model
    db.commit()
    return ai_used, provider_id, model, warnings


def category_counts(files: list[FileRecord]) -> list[CategoryCount]:
    totals: dict[str, tuple[int, int]] = {}
    for record in files:
        category = record.category or "Other"
        count, size = totals.get(category, (0, 0))
        totals[category] = (count + 1, size + record.size)
    return [
        CategoryCount(category=name, count=count, bytes=size)
        for name, (count, size) in sorted(totals.items(), key=lambda kv: (-kv[1][0], kv[0]))
    ]


def serialize_file(record: FileRecord) -> FileOut:
    return FileOut.model_validate(record)


def serialize_session(session: OrganizationSession) -> dict:
    return {
        "id": session.id,
        "root_path": session.root_path,
        "status": session.status,
        "source": session.source,
        "file_count": session.file_count,
        "total_bytes": session.total_bytes,
        "skipped_count": session.skipped_count,
        "ai_provider": session.ai_provider,
        "ai_model": session.ai_model,
        "ai_used": session.ai_used,
        "created_at": session.created_at,
        "warnings": [],
    }


def build_plan(
    db: Session,
    session: OrganizationSession,
    settings: SettingsRepository,
    *,
    use_ai: bool,
    ai_scope: str = "ambiguous",
    categories: list[str] | None = None,
    folder_names: dict[str, str] | None = None,
    include_categories: list[str] | None = None,
) -> PlanOutcome:
    allowed = categories or DEFAULT_CATEGORIES
    ai_used, provider_id, model, warnings = categorize_session(
        db, session, settings, use_ai=use_ai, ai_scope=ai_scope, categories=allowed
    )

    db.execute(
        delete(FileOperation).where(
            FileOperation.session_id == session.id,
            FileOperation.status == "proposed",
        )
    )
    db.flush()

    root = Path(session.root_path)
    folder_map = dict(CATEGORY_FOLDERS)
    if folder_names:
        for category, folder in folder_names.items():
            if category in folder_map or category in allowed:
                folder_map[category] = folder

    included = set(include_categories) if include_categories else set(allowed)
    taken: set[str] = set()
    items: list[PlanItem] = []
    summaries: dict[str, dict] = {}
    unchanged = 0

    for record in sorted(session.files, key=lambda f: f.name.lower()):
        category = record.category or "Other"
        if category not in included:
            unchanged += 1
            continue
        folder = sanitize_folder_name(folder_map.get(category, category))
        destination_dir = root / folder
        try:
            ensure_within(root, destination_dir)
        except Exception:
            warnings.append(f"Skipped unsafe destination for {record.name}")
            unchanged += 1
            continue

        if Path(record.path).parent == destination_dir:
            unchanged += 1
            continue

        intended = destination_dir / record.name
        final, renamed = unique_destination(intended, taken)
        conflict_reason = None
        if renamed:
            conflict_reason = f"{intended.name} already exists; the file will be saved as {final.name}"

        operation = FileOperation(
            session_id=session.id,
            file_id=record.id,
            source_path=record.path,
            destination_path=str(intended),
            final_destination=str(final),
            category=category,
            reason=record.reason,
            confidence=record.confidence,
            source=record.source,
            status="proposed",
            error=conflict_reason,
        )
        db.add(operation)
        db.flush()

        summary = summaries.setdefault(category, {"count": 0, "bytes": 0, "folder": folder})
        summary["count"] += 1
        summary["bytes"] += record.size

        items.append(
            PlanItem(
                operation_id=operation.id,
                file_id=record.id,
                name=record.name,
                source_path=record.path,
                destination_path=str(final),
                category=category,
                reason=record.reason,
                confidence=record.confidence,
                classification_source=record.source,
                conflict=renamed,
                conflict_reason=conflict_reason,
                status="proposed",
            )
        )

    session.status = "planned"
    db.commit()

    return PlanOutcome(
        items=items,
        categories=[
            CategorySummary(category=name, count=data["count"], bytes=data["bytes"], folder=data["folder"])
            for name, data in sorted(summaries.items(), key=lambda kv: (-kv[1]["count"], kv[0]))
        ],
        unchanged=unchanged,
        ai_used=ai_used,
        provider=provider_id,
        model=model,
        warnings=warnings,
    )
