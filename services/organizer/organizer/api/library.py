"""Duplicates, search, indexing, reveal and automation routes."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.automation import next_run_at, pending_sessions, run_rule
from ..core.duplicates import find_duplicates
from ..core.operations import reveal_in_file_manager
from ..core.search import index_files, search_files
from ..database.models import AutomationRule, FileEmbedding, FileOperation
from ..database.repository import SettingsRepository, add_allowed_root, is_path_allowed
from ..filesystem.safety import resolve_selected_folder
from ..schemas import (
    AutomationRuleIn,
    AutomationRuleOut,
    AutomationRulePatch,
    AutomationRunResponse,
    AutomationStatus,
    DuplicatesRequest,
    DuplicatesResponse,
    IndexRequest,
    IndexResponse,
    RevealRequest,
    RevealResponse,
    SearchRequest,
    SearchResponse,
)
from .deps import get_db, get_settings_repo
from .serializers import session_payload

router = APIRouter()


# ----------------------------------------------------------------- duplicates
@router.post("/duplicates/scan", response_model=DuplicatesResponse)
def duplicates_scan(
    request: DuplicatesRequest,
    db: Session = Depends(get_db),
    repo: SettingsRepository = Depends(get_settings_repo),
) -> DuplicatesResponse:
    try:
        payload = find_duplicates(
            request.path,
            min_size=request.min_size,
            max_files=request.max_files,
            settings=repo,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return DuplicatesResponse(**payload)


# --------------------------------------------------------------------- search
@router.post("/search", response_model=SearchResponse)
def search(
    request: SearchRequest,
    db: Session = Depends(get_db),
    repo: SettingsRepository = Depends(get_settings_repo),
) -> SearchResponse:
    hits, filters, semantic, provider, message = search_files(
        db,
        repo,
        query=request.query,
        root_path=request.root_path,
        limit=request.limit,
        use_ai=request.use_ai,
        category=request.category,
        extensions=request.extensions,
    )
    return SearchResponse(
        query=request.query,
        hits=hits,
        total=len(hits),
        filters=filters,
        semantic=semantic,
        provider=provider,
        message=message,
    )


@router.post("/search/index", response_model=IndexResponse)
def search_index(
    request: IndexRequest,
    db: Session = Depends(get_db),
    repo: SettingsRepository = Depends(get_settings_repo),
) -> IndexResponse:
    indexed, provider, model, message = index_files(
        db, repo, root_path=request.root_path, limit=request.limit
    )
    return IndexResponse(indexed=indexed, provider=provider, model=model, message=message)


@router.get("/search/index/status")
def index_status(db: Session = Depends(get_db)) -> dict:
    count = db.scalar(select(func.count()).select_from(FileEmbedding)) or 0
    latest = db.scalar(select(func.max(FileEmbedding.created_at)))
    content_count = (
        db.scalar(
            select(func.count())
            .select_from(FileEmbedding)
            .where(FileEmbedding.content_indexed.is_(True))
        )
        or 0
    )
    return {
        "indexed": int(count),
        "content_indexed": int(content_count),
        "last_indexed_at": latest.isoformat() if latest else None,
    }


# --------------------------------------------------------------------- reveal
@router.post("/files/reveal", response_model=RevealResponse)
def reveal(request: RevealRequest, db: Session = Depends(get_db)) -> RevealResponse:
    if not is_path_allowed(db, request.path):
        raise HTTPException(status_code=403, detail="Path is outside the folders approved by the user")
    ok, message = reveal_in_file_manager(request.path)
    if not ok:
        raise HTTPException(status_code=404, detail=message)
    return RevealResponse(revealed=True, message=message)


# ----------------------------------------------------------------- automation
def _rule_payload(rule: AutomationRule) -> AutomationRuleOut:
    categories = None
    if rule.categories_json:
        try:
            parsed = json.loads(rule.categories_json)
            if isinstance(parsed, list):
                categories = [str(item) for item in parsed]
        except ValueError:
            categories = None
    return AutomationRuleOut(
        id=rule.id,
        name=rule.name,
        root_path=rule.root_path,
        enabled=rule.enabled,
        interval_minutes=rule.interval_minutes,
        auto_apply=rule.auto_apply,
        categories=categories,
        last_run_at=rule.last_run_at,
        last_session_id=rule.last_session_id,
        last_result=rule.last_result,
        next_run_at=next_run_at(rule),
    )


@router.get("/automation")
def automation_overview(
    db: Session = Depends(get_db), repo: SettingsRepository = Depends(get_settings_repo)
) -> dict:
    rules = db.scalars(select(AutomationRule).order_by(AutomationRule.id)).all()
    enabled = repo.get_bool("automation.enabled", False)
    active = sum(1 for rule in rules if rule.enabled)
    last_run = max((rule.last_run_at for rule in rules if rule.last_run_at), default=None)
    if not enabled:
        message = "Scheduled automation is off. Rules can always be run manually."
    elif active == 0:
        message = "Automation is on but no rule is enabled yet."
    else:
        message = f"Automation is on with {active} active rule{'s' if active != 1 else ''}."
    return {
        "enabled": enabled,
        "rules": [_rule_payload(rule).model_dump(mode="json") for rule in rules],
        "status": AutomationStatus(
            enabled=enabled,
            rules=len(rules),
            active_rules=active,
            last_run_at=last_run,
            message=message,
        ).model_dump(mode="json"),
    }


def _validate_root(db: Session, path: str) -> str:
    try:
        root = resolve_selected_folder(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    add_allowed_root(db, root)
    return str(root)


@router.post("/automation/rules", response_model=AutomationRuleOut)
def create_rule(
    request: AutomationRuleIn, db: Session = Depends(get_db)
) -> AutomationRuleOut:
    root = _validate_root(db, request.root_path)
    rule = AutomationRule(
        name=request.name.strip(),
        root_path=root,
        enabled=request.enabled,
        interval_minutes=request.interval_minutes,
        auto_apply=request.auto_apply,
        categories_json=json.dumps(request.categories) if request.categories else None,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _rule_payload(rule)


@router.patch("/automation/rules/{rule_id}", response_model=AutomationRuleOut)
def update_rule(
    rule_id: int, request: AutomationRulePatch, db: Session = Depends(get_db)
) -> AutomationRuleOut:
    rule = db.get(AutomationRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    if request.name is not None:
        rule.name = request.name.strip()
    if request.root_path is not None:
        rule.root_path = _validate_root(db, request.root_path)
    if request.enabled is not None:
        rule.enabled = request.enabled
    if request.interval_minutes is not None:
        rule.interval_minutes = request.interval_minutes
    if request.auto_apply is not None:
        rule.auto_apply = request.auto_apply
    if request.categories is not None:
        rule.categories_json = json.dumps(request.categories) if request.categories else None
    db.commit()
    db.refresh(rule)
    return _rule_payload(rule)


@router.delete("/automation/rules/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)) -> dict:
    rule = db.get(AutomationRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule)
    db.commit()
    return {"ok": True, "message": "Rule deleted"}


@router.post("/automation/rules/{rule_id}/run", response_model=AutomationRunResponse)
def run_rule_now(
    rule_id: int,
    db: Session = Depends(get_db),
    repo: SettingsRepository = Depends(get_settings_repo),
) -> AutomationRunResponse:
    rule = db.get(AutomationRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    return run_rule(db, rule, repo, force=True)


@router.get("/automation/pending")
def automation_pending(db: Session = Depends(get_db)) -> dict:
    sessions = pending_sessions(db)
    items = []
    for session in sessions:
        planned = db.scalar(
            select(func.count())
            .select_from(FileOperation)
            .where(
                FileOperation.session_id == session.id,
                FileOperation.status == "proposed",
            )
        ) or 0
        items.append(
            {
                "session": session_payload(session).model_dump(mode="json"),
                "planned": int(planned),
            }
        )
    return {"pending": items}
