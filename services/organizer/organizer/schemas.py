"""Typed request/response schemas for the local API."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    path: str
    name: str
    extension: str
    size: int
    modified_at: datetime | None = None
    category: str | None = None
    confidence: float | None = None
    reason: str | None = None
    source: str = "rules"
    content_hash: str | None = None


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    root_path: str
    status: str
    source: str
    file_count: int
    total_bytes: int
    skipped_count: int
    ai_provider: str | None = None
    ai_model: str | None = None
    ai_used: bool = False
    created_at: datetime
    warnings: list[str] = Field(default_factory=list)


class ScanRequest(BaseModel):
    path: str = Field(min_length=1)
    max_depth: int = Field(default=12, ge=1, le=50)
    max_files: int = Field(default=20000, ge=1, le=200000)
    include_hidden: bool = False
    include_system: bool = False


class ScanResponse(BaseModel):
    session: SessionOut
    files: list[FileOut]
    skipped: int
    errors: list[str]
    truncated: bool
    excluded_dirs: list[str]


class CategorizeRequest(BaseModel):
    session_id: int
    use_ai: bool = True
    ai_scope: Literal["none", "ambiguous", "all"] = "ambiguous"
    categories: list[str] | None = None


class CategoryCount(BaseModel):
    category: str
    count: int
    bytes: int


class CategorizeResponse(BaseModel):
    session: SessionOut
    files: list[FileOut]
    categories: list[CategoryCount]
    ai_used: bool = False
    provider: str | None = None
    model: str | None = None
    warnings: list[str] = Field(default_factory=list)


class PlanRequest(BaseModel):
    session_id: int
    use_ai: bool = True
    ai_scope: Literal["none", "ambiguous", "all"] = "ambiguous"
    categories: list[str] | None = None
    folder_names: dict[str, str] | None = None
    include_categories: list[str] | None = None


class PlanItem(BaseModel):
    operation_id: int
    file_id: int | None = None
    name: str
    source_path: str
    destination_path: str
    category: str
    reason: str | None = None
    confidence: float | None = None
    classification_source: str = "rules"
    conflict: bool = False
    conflict_reason: str | None = None
    status: str = "proposed"


class CategorySummary(BaseModel):
    category: str
    count: int
    bytes: int
    folder: str


class PlanResponse(BaseModel):
    session_id: int
    items: list[PlanItem]
    categories: list[CategorySummary]
    unchanged: int = 0
    ai_used: bool = False
    provider: str | None = None
    model: str | None = None
    warnings: list[str] = Field(default_factory=list)


class PreviewRequest(BaseModel):
    session_id: int
    operation_ids: list[int] | None = None
    resolve_conflicts: bool = True


class PreviewResponse(BaseModel):
    session_id: int
    items: list[PlanItem]
    conflicts: int
    missing: list[str] = Field(default_factory=list)
    unchanged: int = 0
    can_apply: bool = True
    warnings: list[str] = Field(default_factory=list)


class ApplyRequest(BaseModel):
    session_id: int
    operation_ids: list[int] | None = None
    resolve_conflicts: bool = True


class OperationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_path: str
    destination_path: str
    final_destination: str | None = None
    category: str | None = None
    reason: str | None = None
    confidence: float | None = None
    status: str
    error: str | None = None
    batch_id: str | None = None


class ApplyResponse(BaseModel):
    batch_id: str | None = None
    applied: int = 0
    failed: int = 0
    skipped: int = 0
    items: list[OperationOut] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    message: str


class UndoRequest(BaseModel):
    batch_id: str | None = None


class UndoResponse(BaseModel):
    batch_id: str | None = None
    restored: int = 0
    failed: int = 0
    errors: list[str] = Field(default_factory=list)
    message: str


class HistoryBatch(BaseModel):
    id: str
    session_id: int | None = None
    root_path: str | None = None
    status: str
    applied_count: int
    failed_count: int
    undone_count: int
    created_at: datetime
    operations: list[OperationOut] = Field(default_factory=list)


class HistoryResponse(BaseModel):
    batches: list[HistoryBatch]
    total: int


class DuplicateFile(BaseModel):
    path: str
    name: str
    size: int
    modified_at: datetime | None = None


class DuplicateGroup(BaseModel):
    hash: str
    size: int
    count: int
    potential_savings: int
    files: list[DuplicateFile]


class DuplicatesRequest(BaseModel):
    path: str = Field(min_length=1)
    min_size: int = Field(default=1, ge=0)
    max_files: int = Field(default=20000, ge=1, le=200000)


class DuplicatesResponse(BaseModel):
    root: str
    groups: list[DuplicateGroup]
    scanned_files: int
    hashed_files: int
    potential_savings: int
    duration_ms: int
    skipped: int
    errors: list[str] = Field(default_factory=list)


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    root_path: str | None = None
    limit: int = Field(default=50, ge=1, le=200)
    use_ai: bool = True
    category: str | None = None
    extensions: list[str] | None = None


class SearchHit(BaseModel):
    path: str
    name: str
    extension: str
    size: int
    modified_at: datetime | None = None
    category: str | None = None
    score: float = 0.0
    match_reason: str = "Metadata match"


class SearchFilters(BaseModel):
    category: str | None = None
    extensions: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    min_size_mb: float | None = None
    max_size_mb: float | None = None
    modified_within_days: int | None = None


class SearchResponse(BaseModel):
    query: str
    hits: list[SearchHit]
    total: int
    filters: SearchFilters
    semantic: bool = False
    provider: str | None = None
    message: str = ""


class IndexRequest(BaseModel):
    root_path: str | None = None
    limit: int = Field(default=2000, ge=1, le=50000)


class IndexResponse(BaseModel):
    indexed: int
    provider: str | None = None
    model: str | None = None
    message: str


class RevealRequest(BaseModel):
    path: str


class RevealResponse(BaseModel):
    revealed: bool
    message: str


class IndexStatusOut(BaseModel):
    indexed: int = 0
    content_indexed: int = 0
    last_indexed_at: str | None = None


class AutomationRuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    root_path: str = Field(min_length=1)
    enabled: bool = False
    interval_minutes: int = Field(default=1440, ge=5, le=525600)
    auto_apply: bool = False
    categories: list[str] | None = None


class AutomationRulePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    root_path: str | None = None
    enabled: bool | None = None
    interval_minutes: int | None = Field(default=None, ge=5, le=525600)
    auto_apply: bool | None = None
    categories: list[str] | None = None


class AutomationRuleOut(BaseModel):
    id: int
    name: str
    root_path: str
    enabled: bool
    interval_minutes: int
    auto_apply: bool
    categories: list[str] | None = None
    last_run_at: datetime | None = None
    last_session_id: int | None = None
    last_result: str | None = None
    next_run_at: datetime | None = None


class AutomationRunResponse(BaseModel):
    rule_id: int
    session_id: int | None = None
    status: str
    planned: int = 0
    applied: int = 0
    message: str


class AutomationStatus(BaseModel):
    enabled: bool
    rules: int
    active_rules: int
    last_run_at: datetime | None = None
    message: str


class ProviderOut(BaseModel):
    id: str
    label: str
    kind: str
    free: bool
    configured: bool
    model: str
    description: str
    signup_url: str | None = None
    models: list[str] = Field(default_factory=list)
    selected: bool = False


class AIStatus(BaseModel):
    active: str | None = None
    model: str | None = None
    ready: bool = False
    message: str
    requested: str = "auto"
    rules_available: bool = True


class SettingsOut(BaseModel):
    provider: str
    ai_enabled: bool
    ai_scope: str
    cloud_consent: bool
    content_index_enabled: bool
    semantic_search_enabled: bool
    automation_enabled: bool
    ollama_url: str
    embedding_model: str
    batch_size: int
    theme: str
    data_dir: str
    api_keys_configured: dict[str, bool]
    providers: list[ProviderOut]
    status: AIStatus


class SettingsPatch(BaseModel):
    provider: str | None = None
    ai_enabled: bool | None = None
    ai_scope: Literal["none", "ambiguous", "all"] | None = None
    cloud_consent: bool | None = None
    content_index_enabled: bool | None = None
    semantic_search_enabled: bool | None = None
    automation_enabled: bool | None = None
    ollama_url: str | None = None
    embedding_model: str | None = None
    batch_size: int | None = Field(default=None, ge=1, le=30)
    theme: Literal["light", "dark", "system"] | None = None
    models: dict[str, str] | None = None
    api_keys: dict[str, str] | None = None


class DashboardResponse(BaseModel):
    files_indexed: int
    total_bytes: int
    sessions: int
    pending_moves: int
    duplicate_groups: int
    duplicate_bytes: int
    duplicate_scanned_at: str | None = None
    recent_sessions: list[SessionOut]
    recent_batches: list[HistoryBatch]
    ai: AIStatus


class MessageResponse(BaseModel):
    message: str
    ok: bool = True
