"""Scan → plan → preview → apply → undo endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.operations import (
    apply_operations,
    operation_payload,
    preview_operations,
    undo_batch,
)
from ..core.workflow import (
    build_plan,
    categorize_session,
    category_counts,
    scan_into_session,
    serialize_file,
)
from ..database.models import FileOperation, FileRecord, OperationBatch, OrganizationSession
from ..database.repository import SettingsRepository
from ..schemas import (
    ApplyRequest,
    ApplyResponse,
    CategorizeRequest,
    CategorizeResponse,
    HistoryResponse,
    PlanRequest,
    PlanResponse,
    PreviewRequest,
    PreviewResponse,
    ScanRequest,
    ScanResponse,
    SessionOut,
    UndoRequest,
    UndoResponse,
)
from .deps import get_db, get_settings_repo
from .serializers import batch_payload, session_payload

router = APIRouter()


def _get_session(db: Session, session_id: int) -> OrganizationSession:
    session = db.get(OrganizationSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Scan session not found")
    return session


@router.post("/scan", response_model=ScanResponse)
def scan(
    request: ScanRequest,
    db: Session = Depends(get_db),
    repo: SettingsRepository = Depends(get_settings_repo),
) -> ScanResponse:
    try:
        session, result = scan_into_session(
            db,
            path=request.path,
            max_depth=request.max_depth,
            max_files=request.max_files,
            include_hidden=request.include_hidden,
            include_system=request.include_system,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    files = list(
        db.scalars(
            select(FileRecord)
            .where(FileRecord.session_id == session.id)
            .order_by(FileRecord.name)
        ).all()
    )
    return ScanResponse(
        session=session_payload(session),
        files=[serialize_file(record) for record in files],
        skipped=result.skipped,
        errors=result.errors,
        truncated=result.truncated,
        excluded_dirs=result.excluded_dirs[:20],
    )


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(
    limit: int = Query(default=20, ge=1, le=100), db: Session = Depends(get_db)
) -> list[SessionOut]:
    sessions = db.scalars(
        select(OrganizationSession)
        .order_by(OrganizationSession.created_at.desc())
        .limit(limit)
    ).all()
    return [session_payload(session) for session in sessions]


@router.get("/sessions/{session_id}")
def get_session_detail(session_id: int, db: Session = Depends(get_db)) -> dict:
    session = _get_session(db, session_id)
    files = db.scalars(
        select(FileRecord).where(FileRecord.session_id == session_id).order_by(FileRecord.name)
    ).all()
    operations = db.scalars(
        select(FileOperation)
        .where(FileOperation.session_id == session_id, FileOperation.status == "proposed")
        .order_by(FileOperation.id)
    ).all()
    return {
        "session": session_payload(session).model_dump(mode="json"),
        "files": [serialize_file(record).model_dump(mode="json") for record in files],
        "operations": [operation_payload(op).model_dump(mode="json") for op in operations],
    }


@router.post("/categorize", response_model=CategorizeResponse)
def categorize(
    request: CategorizeRequest,
    db: Session = Depends(get_db),
    repo: SettingsRepository = Depends(get_settings_repo),
) -> CategorizeResponse:
    session = _get_session(db, request.session_id)
    ai_used, provider, model, warnings = categorize_session(
        db,
        session,
        repo,
        use_ai=request.use_ai,
        ai_scope=request.ai_scope,
        categories=request.categories,
    )
    files = list(session.files)
    counts = category_counts(files)
    return CategorizeResponse(
        session=session_payload(session, warnings),
        files=[serialize_file(record) for record in files],
        categories=counts,
        ai_used=ai_used,
        provider=provider,
        model=model,
        warnings=warnings,
    )


@router.post("/plan", response_model=PlanResponse)
def plan(
    request: PlanRequest,
    db: Session = Depends(get_db),
    repo: SettingsRepository = Depends(get_settings_repo),
) -> PlanResponse:
    session = _get_session(db, request.session_id)
    outcome = build_plan(
        db,
        session,
        repo,
        use_ai=request.use_ai,
        ai_scope=request.ai_scope,
        categories=request.categories,
        folder_names=request.folder_names,
        include_categories=request.include_categories,
    )
    return PlanResponse(
        session_id=session.id,
        items=outcome.items,
        categories=outcome.categories,
        unchanged=outcome.unchanged,
        ai_used=outcome.ai_used,
        provider=outcome.provider,
        model=outcome.model,
        warnings=outcome.warnings,
    )


@router.post("/operations/preview", response_model=PreviewResponse)
def preview(
    request: PreviewRequest, db: Session = Depends(get_db)
) -> PreviewResponse:
    session = _get_session(db, request.session_id)
    items, missing, unchanged, can_apply = preview_operations(
        db,
        session,
        operation_ids=request.operation_ids,
        resolve_conflicts=request.resolve_conflicts,
    )
    conflicts = sum(1 for item in items if item.conflict)
    warnings = []
    if missing:
        warnings.append(f"{len(missing)} source file(s) are no longer available.")
    if not items:
        warnings.append("This session has no proposed moves. Generate a plan first.")
    return PreviewResponse(
        session_id=session.id,
        items=items,
        conflicts=conflicts,
        missing=missing,
        unchanged=unchanged,
        can_apply=can_apply,
        warnings=warnings,
    )


@router.post("/operations/apply", response_model=ApplyResponse)
def apply(
    request: ApplyRequest, db: Session = Depends(get_db)
) -> ApplyResponse:
    session = _get_session(db, request.session_id)
    batch_id, applied, failed, skipped, errors, touched = apply_operations(
        db,
        session,
        operation_ids=request.operation_ids,
        resolve_conflicts=request.resolve_conflicts,
    )
    if applied:
        message = f"Moved {applied} file{'s' if applied != 1 else ''}."
        if failed or skipped:
            message += f" {failed + skipped} were not moved."
    else:
        message = "No files were moved."
    return ApplyResponse(
        batch_id=batch_id,
        applied=applied,
        failed=failed,
        skipped=skipped,
        items=[operation_payload(op) for op in touched],
        errors=errors,
        message=message,
    )


@router.post("/operations/undo", response_model=UndoResponse)
def undo(request: UndoRequest, db: Session = Depends(get_db)) -> UndoResponse:
    batch_id, restored, failed, errors, message = undo_batch(db, request.batch_id)
    return UndoResponse(
        batch_id=batch_id,
        restored=restored,
        failed=failed,
        errors=errors,
        message=message,
    )


@router.get("/history", response_model=HistoryResponse)
def history(
    limit: int = Query(default=20, ge=1, le=100), db: Session = Depends(get_db)
) -> HistoryResponse:
    total = db.scalar(select(func.count()).select_from(OperationBatch)) or 0
    batches = db.scalars(
        select(OperationBatch).order_by(OperationBatch.created_at.desc()).limit(limit)
    ).all()
    return HistoryResponse(
        batches=[batch_payload(db, batch) for batch in batches],
        total=int(total),
    )
