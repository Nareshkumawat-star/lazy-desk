"""Filesystem mutations: preview, apply, undo and reveal.

Every move is user-initiated, never overwrites an existing file, and is recorded
so it can be undone after validating both endpoints.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database.models import FileOperation, FileRecord, OperationBatch, OrganizationSession
from ..filesystem.safety import ensure_within, unique_destination
from ..schemas import OperationOut, PlanItem

RESOLVED_STATUSES = ("applied", "partial")


def _now() -> datetime:
    return datetime.now(UTC)


def _operations_for(
    db: Session, session_id: int, operation_ids: list[int] | None, statuses: tuple[str, ...] = ("proposed",)
) -> list[FileOperation]:
    query = (
        select(FileOperation)
        .where(FileOperation.session_id == session_id, FileOperation.status.in_(statuses))
        .order_by(FileOperation.id)
    )
    if operation_ids is not None:
        query = query.where(FileOperation.id.in_(operation_ids))
    return list(db.scalars(query).all())


def _item_from_operation(
    op: FileOperation,
    *,
    destination: str | None = None,
    conflict: bool = False,
    conflict_reason: str | None = None,
    status: str | None = None,
) -> PlanItem:
    return PlanItem(
        operation_id=op.id,
        file_id=op.file_id,
        name=Path(op.source_path).name,
        source_path=op.source_path,
        destination_path=destination or op.final_destination or op.destination_path,
        category=op.category or "Other",
        reason=op.reason,
        confidence=op.confidence,
        classification_source=getattr(op, "source", "rules") or "rules",
        conflict=conflict,
        conflict_reason=conflict_reason,
        status=status or op.status,
    )


def preview_operations(
    db: Session,
    session: OrganizationSession,
    *,
    operation_ids: list[int] | None = None,
    resolve_conflicts: bool = True,
) -> tuple[list[PlanItem], list[str], int, bool]:
    """Validate proposed operations against the current filesystem."""
    ops = _operations_for(db, session.id, operation_ids)
    root = Path(session.root_path)
    taken: set[str] = set()
    items: list[PlanItem] = []
    missing: list[str] = []
    conflicts = 0

    for op in ops:
        source = Path(op.source_path)
        if not source.exists() or not source.is_file() or source.is_symlink():
            missing.append(op.source_path)
            items.append(
                _item_from_operation(
                    op,
                    conflict=True,
                    conflict_reason="Source file no longer exists",
                    status="missing",
                )
            )
            continue

        intended = Path(op.destination_path)
        try:
            ensure_within(root, source)
            ensure_within(root, intended)
        except Exception:
            missing.append(op.source_path)
            items.append(
                _item_from_operation(
                    op,
                    conflict=True,
                    conflict_reason="Path is outside the approved folder",
                    status="missing",
                )
            )
            continue

        if resolve_conflicts:
            final, renamed = unique_destination(intended, taken)
        else:
            final = intended
            renamed = intended.exists() or str(intended) in taken

        if renamed:
            conflicts += 1
        items.append(
            _item_from_operation(
                op,
                destination=str(final),
                conflict=renamed,
                conflict_reason=(
                    f"{intended.name} already exists; it will be saved as {final.name}"
                    if renamed and resolve_conflicts
                    else ("Destination already exists and will be skipped" if renamed else None)
                ),
                status="proposed",
            )
        )

    unchanged = 0
    can_apply = bool(items) and (resolve_conflicts or conflicts == 0)
    return items, missing, unchanged, can_apply


def apply_operations(
    db: Session,
    session: OrganizationSession,
    *,
    operation_ids: list[int] | None = None,
    resolve_conflicts: bool = True,
) -> tuple[str | None, int, int, int, list[str], list[FileOperation]]:
    ops = _operations_for(db, session.id, operation_ids)
    if not ops:
        return None, 0, 0, 0, ["No proposed operations matched."], []

    batch = OperationBatch(
        id=str(uuid.uuid4()),
        session_id=session.id,
        status="applying",
    )
    db.add(batch)
    db.commit()

    root = Path(session.root_path)
    taken: set[str] = set()
    applied = 0
    failed = 0
    skipped = 0
    errors: list[str] = []
    touched: list[FileOperation] = []

    for op in ops:
        source = Path(op.source_path)
        intended = Path(op.destination_path)

        if not source.exists() or not source.is_file() or source.is_symlink():
            op.status = "missing"
            op.error = "Source file no longer exists"
            failed += 1
            errors.append(f"{source.name}: source no longer exists")
            db.commit()
            continue
        try:
            ensure_within(root, source)
            ensure_within(root, intended)
        except Exception:
            op.status = "failed"
            op.error = "Path is outside the approved folder"
            failed += 1
            errors.append(f"{source.name}: unsafe path")
            db.commit()
            continue

        if resolve_conflicts:
            final, renamed = unique_destination(intended, taken)
        else:
            if intended.exists() or str(intended) in taken:
                op.status = "conflict"
                op.error = "Destination already exists"
                skipped += 1
                errors.append(f"{source.name}: destination already exists, skipped")
                db.commit()
                continue
            final = intended
            taken.add(str(intended))

        try:
            final.parent.mkdir(parents=True, exist_ok=True)
            if final.exists():
                raise FileExistsError(f"{final} already exists")
            shutil.move(str(source), str(final))
        except (OSError, shutil.Error) as exc:
            op.status = "failed"
            op.error = str(exc)[:300]
            failed += 1
            errors.append(f"{source.name}: {op.error}")
            db.commit()
            continue

        op.final_destination = str(final)
        op.status = "applied"
        op.applied_at = _now()
        op.batch_id = batch.id
        op.error = None
        if op.file_id is not None:
            record = db.get(FileRecord, op.file_id)
            if record is not None:
                record.path = str(final)
                record.name = final.name
        applied += 1
        touched.append(op)
        db.commit()

    batch.applied_count = applied
    batch.failed_count = failed + skipped
    batch.status = "applied" if applied and failed == 0 and skipped == 0 else ("partial" if applied else "failed")
    session.status = "applied" if batch.status == "applied" else ("partial" if applied else session.status)
    db.commit()

    if applied == 0:
        errors.append("No files were moved. Review the conflicts and try again.")
    return batch.id, applied, failed, skipped, errors, touched


def latest_batch(db: Session) -> OperationBatch | None:
    return db.scalar(
        select(OperationBatch)
        .order_by(OperationBatch.created_at.desc())
        .limit(1)
    )


def undo_batch(db: Session, batch_id: str | None = None) -> tuple[str | None, int, int, list[str], str]:
    if batch_id:
        batch = db.get(OperationBatch, batch_id)
    else:
        batch = db.scalar(
            select(OperationBatch)
            .where(OperationBatch.status.in_(RESOLVED_STATUSES))
            .order_by(OperationBatch.created_at.desc())
            .limit(1)
        )

    if batch is None:
        return None, 0, 0, [], "There is no completed operation to undo."

    ops = list(
        db.scalars(
            select(FileOperation)
            .where(FileOperation.batch_id == batch.id, FileOperation.status == "applied")
            .order_by(FileOperation.id.desc())
        ).all()
    )
    if not ops:
        status = "undone" if batch.status == "undone" else batch.status
        return batch.id, 0, 0, [], f"Nothing left to undo ({status})."

    session = db.get(OrganizationSession, batch.session_id) if batch.session_id else None
    root = Path(session.root_path) if session else None
    restored = 0
    failed = 0
    errors: list[str] = []

    for op in ops:
        destination = Path(op.final_destination or op.destination_path)
        source = Path(op.source_path)
        if not destination.exists() or destination.is_symlink():
            failed += 1
            errors.append(f"{destination.name}: the moved file is no longer at its destination")
            op.error = "File is missing from its destination"
            db.commit()
            continue
        if source.exists():
            failed += 1
            errors.append(f"{source.name}: the original location is already occupied")
            op.error = "Original location is occupied"
            db.commit()
            continue
        if root is not None:
            try:
                ensure_within(root, destination)
                ensure_within(root, source)
            except Exception:
                failed += 1
                errors.append(f"{destination.name}: unsafe path")
                continue
        try:
            source.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(destination), str(source))
        except (OSError, shutil.Error) as exc:
            failed += 1
            errors.append(f"{destination.name}: {str(exc)[:200]}")
            op.error = str(exc)[:300]
            db.commit()
            continue

        op.status = "undone"
        op.undone_at = _now()
        op.error = None
        if op.file_id is not None:
            record = db.get(FileRecord, op.file_id)
            if record is not None:
                record.path = str(source)
                record.name = source.name
        restored += 1
        db.commit()

    if failed == 0 and restored:
        batch.status = "undone"
        batch.undone_count = restored
        if session:
            session.status = "undone"
    else:
        batch.status = "partial"
        batch.undone_count = restored
    db.commit()

    message = (
        f"Restored {restored} file{'s' if restored != 1 else ''}."
        if restored
        else "Nothing was restored."
    )
    if failed:
        message += f" {failed} file(s) could not be restored; nothing was overwritten."
    return batch.id, restored, failed, errors, message


def reveal_in_file_manager(path: str) -> tuple[bool, str]:
    target = Path(path).expanduser()
    if not target.exists():
        return False, "File no longer exists at that path."
    try:
        if sys.platform == "win32":
            subprocess.Popen(["explorer", "/select,", str(target)])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(target)])
        else:
            folder = target if target.is_dir() else target.parent
            subprocess.Popen(["xdg-open", str(folder)])
    except OSError as exc:
        return False, f"Could not open the file manager: {exc}"
    return True, "Opened the containing folder."


def operation_payload(op: FileOperation) -> OperationOut:
    return OperationOut.model_validate(op)
