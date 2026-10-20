"""Serializers shared by API routes."""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..database.models import OperationBatch, OrganizationSession
from ..schemas import HistoryBatch, OperationOut, SessionOut


def session_payload(session: OrganizationSession, warnings: list[str] | None = None) -> SessionOut:
    return SessionOut(
        id=session.id,
        root_path=session.root_path,
        status=session.status,
        source=session.source,
        file_count=session.file_count,
        total_bytes=session.total_bytes,
        skipped_count=session.skipped_count,
        ai_provider=session.ai_provider,
        ai_model=session.ai_model,
        ai_used=session.ai_used,
        created_at=session.created_at,
        warnings=warnings or [],
    )


def batch_payload(db: Session, batch: OperationBatch) -> HistoryBatch:
    root_path = None
    if batch.session_id is not None:
        session = db.get(OrganizationSession, batch.session_id)
        root_path = session.root_path if session else None
    return HistoryBatch(
        id=batch.id,
        session_id=batch.session_id,
        root_path=root_path,
        status=batch.status,
        applied_count=batch.applied_count,
        failed_count=batch.failed_count,
        undone_count=batch.undone_count,
        created_at=batch.created_at,
        operations=[OperationOut.model_validate(op) for op in batch.operations],
    )
