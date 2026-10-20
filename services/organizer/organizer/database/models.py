"""SQLAlchemy ORM models for LazyDesk's local SQLite store."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class OrganizationSession(Base):
    __tablename__ = "organization_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    root_path: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="scanned", nullable=False)
    source: Mapped[str] = mapped_column(String(32), default="manual", nullable=False)
    file_count: Mapped[int] = mapped_column(Integer, default=0)
    total_bytes: Mapped[int] = mapped_column(Integer, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0)
    ai_provider: Mapped[str | None] = mapped_column(String(64))
    ai_model: Mapped[str | None] = mapped_column(String(128))
    ai_used: Mapped[bool] = mapped_column(Boolean, default=False)
    warnings_json: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    files: Mapped[list[FileRecord]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    operations: Mapped[list[FileOperation]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class FileRecord(Base):
    __tablename__ = "files"
    __table_args__ = (UniqueConstraint("session_id", "path", name="uq_file_session_path"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("organization_sessions.id", ondelete="CASCADE"), index=True
    )
    path: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    extension: Mapped[str] = mapped_column(String(32), default="")
    size: Mapped[int] = mapped_column(Integer, default=0)
    modified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    category: Mapped[str | None] = mapped_column(String(64), index=True)
    confidence: Mapped[float | None] = mapped_column(Float)
    reason: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(16), default="rules")
    content_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    session: Mapped[OrganizationSession] = relationship(back_populates="files")
    operations: Mapped[list[FileOperation]] = relationship(back_populates="file")


class OperationBatch(Base):
    __tablename__ = "operation_batches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization_sessions.id", ondelete="SET NULL"), index=True
    )
    status: Mapped[str] = mapped_column(String(24), default="applied", index=True)
    applied_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    undone_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    operations: Mapped[list[FileOperation]] = relationship(back_populates="batch")


class FileOperation(Base):
    __tablename__ = "file_operations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("organization_sessions.id", ondelete="CASCADE"), index=True
    )
    file_id: Mapped[int | None] = mapped_column(
        ForeignKey("files.id", ondelete="SET NULL"), index=True
    )
    batch_id: Mapped[str | None] = mapped_column(
        ForeignKey("operation_batches.id", ondelete="SET NULL"), index=True
    )
    source_path: Mapped[str] = mapped_column(Text, nullable=False)
    destination_path: Mapped[str] = mapped_column(Text, nullable=False)
    final_destination: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(64), index=True)
    reason: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(16), default="rules")
    status: Mapped[str] = mapped_column(String(24), default="proposed", index=True)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    session: Mapped[OrganizationSession] = relationship(back_populates="operations")
    file: Mapped[FileRecord | None] = relationship(back_populates="operations")
    batch: Mapped[OperationBatch | None] = relationship(back_populates="operations")


class CategoryRecord(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    folder_name: Mapped[str] = mapped_column(String(64), nullable=False)
    extensions_json: Mapped[str | None] = mapped_column(Text)
    is_custom: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AutomationRule(Base):
    __tablename__ = "automation_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    root_path: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    interval_minutes: Mapped[int] = mapped_column(Integer, default=1440)
    auto_apply: Mapped[bool] = mapped_column(Boolean, default=False)
    categories_json: Mapped[str | None] = mapped_column(Text)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_session_id: Mapped[int | None] = mapped_column(Integer)
    last_result: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class FileEmbedding(Base):
    __tablename__ = "file_embeddings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    path: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    vector_json: Mapped[str] = mapped_column(Text, nullable=False)
    content_indexed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AllowedRoot(Base):
    __tablename__ = "allowed_roots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    path: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
