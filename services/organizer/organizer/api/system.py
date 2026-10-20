"""System, settings and AI status routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import __version__
from ..ai.providers import PROVIDER_CATALOG, build_provider
from ..ai.service import (
    clear_health_cache,
    describe_providers,
    provider_health,
    resolve_provider,
)
from ..config import get_config
from ..core.categories import CATEGORY_FOLDERS, DEFAULT_CATEGORIES
from ..database.models import (
    FileEmbedding,
    FileOperation,
    FileRecord,
    OperationBatch,
    OrganizationSession,
)
from ..database.repository import PROVIDERS, SettingsRepository
from ..schemas import (
    AIStatus,
    DashboardResponse,
    MessageResponse,
    ProviderOut,
    SettingsOut,
    SettingsPatch,
)
from .deps import get_db, get_settings_repo
from .serializers import batch_payload, session_payload

public_router = APIRouter()
router = APIRouter()


@public_router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "app": "LazyDesk",
        "version": __version__,
        "auth_required": True,
    }


def _settings_payload(db: Session, repo: SettingsRepository) -> SettingsOut:
    active = repo.get("ai.provider") or "auto"
    providers = [
        ProviderOut(
            id=info.id,
            label=info.label,
            kind=info.kind,
            free=info.free,
            configured=info.configured,
            model=info.model,
            description=info.description,
            signup_url=info.signup_url,
            models=info.models,
            selected=active == info.id,
        )
        for info in describe_providers(repo)
    ]
    status = provider_health(repo)
    return SettingsOut(
        provider=active,
        ai_enabled=repo.get_bool("ai.enabled", True),
        ai_scope=repo.get("ai.scope") or "ambiguous",
        cloud_consent=repo.get_bool("ai.cloud_consent", False),
        content_index_enabled=repo.get_bool("index.content_enabled", False),
        semantic_search_enabled=repo.get_bool("search.semantic_enabled", True),
        automation_enabled=repo.get_bool("automation.enabled", False),
        ollama_url=repo.get("ai.ollama_url") or "http://127.0.0.1:11434",
        embedding_model=repo.get("ai.embedding.model") or "gemini-embedding-001",
        batch_size=repo.get_int("ai.batch_size", 20),
        theme=repo.get("theme") or "system",
        data_dir=str(get_config().data_dir),
        api_keys_configured={
            provider: bool(repo.get(PROVIDER_CATALOG[provider].key_setting))
            for provider in PROVIDERS
            if PROVIDER_CATALOG[provider].key_setting
        },
        providers=providers,
        status=AIStatus(**status),
    )


@router.get("/settings", response_model=SettingsOut)
def get_settings(
    db: Session = Depends(get_db), repo: SettingsRepository = Depends(get_settings_repo)
) -> SettingsOut:
    return _settings_payload(db, repo)


@router.patch("/settings", response_model=SettingsOut)
def patch_settings(
    patch: SettingsPatch,
    db: Session = Depends(get_db),
    repo: SettingsRepository = Depends(get_settings_repo),
) -> SettingsOut:
    if patch.provider is not None:
        allowed = {*PROVIDERS, "auto", "rules"}
        if patch.provider not in allowed:
            raise HTTPException(status_code=400, detail="Unknown AI provider")
        repo.set("ai.provider", patch.provider)
    if patch.ai_enabled is not None:
        repo.set("ai.enabled", "true" if patch.ai_enabled else "false")
    if patch.ai_scope is not None:
        repo.set("ai.scope", patch.ai_scope)
    if patch.cloud_consent is not None:
        repo.set("ai.cloud_consent", "true" if patch.cloud_consent else "false")
    if patch.content_index_enabled is not None:
        repo.set("index.content_enabled", "true" if patch.content_index_enabled else "false")
    if patch.semantic_search_enabled is not None:
        repo.set("search.semantic_enabled", "true" if patch.semantic_search_enabled else "false")
    if patch.automation_enabled is not None:
        repo.set("automation.enabled", "true" if patch.automation_enabled else "false")
    if patch.ollama_url is not None:
        url = patch.ollama_url.strip().rstrip("/")
        if not url.startswith(("http://127.0.0.1", "http://localhost", "https://")):
            raise HTTPException(status_code=400, detail="Ollama URL must be a local HTTP URL")
        repo.set("ai.ollama_url", url)
    if patch.embedding_model is not None and patch.embedding_model.strip():
        repo.set("ai.embedding.model", patch.embedding_model.strip()[:120])
    if patch.batch_size is not None:
        repo.set("ai.batch_size", str(patch.batch_size))
    if patch.theme is not None:
        repo.set("theme", patch.theme)
    if patch.models:
        for provider, model in patch.models.items():
            if provider not in PROVIDER_CATALOG:
                continue
            if not model or len(model) > 160:
                continue
            repo.set(PROVIDER_CATALOG[provider].model_setting, model.strip())
    if patch.api_keys:
        for provider, key in patch.api_keys.items():
            if provider not in PROVIDER_CATALOG:
                continue
            setting = PROVIDER_CATALOG[provider].key_setting
            if not setting:
                continue
            key = (key or "").strip()
            if key.startswith("•") or key.startswith("***"):
                continue
            if len(key) > 300:
                raise HTTPException(status_code=400, detail="API key is too long")
            repo.set(setting, key)

    clear_health_cache()
    return _settings_payload(db, repo)


@router.get("/ai/status", response_model=AIStatus)
def ai_status(repo: SettingsRepository = Depends(get_settings_repo)) -> AIStatus:
    return AIStatus(**provider_health(repo))


@router.get("/ai/providers", response_model=list[ProviderOut])
def ai_providers(repo: SettingsRepository = Depends(get_settings_repo)) -> list[ProviderOut]:
    active = repo.get("ai.provider") or "auto"
    return [
        ProviderOut(
            id=info.id,
            label=info.label,
            kind=info.kind,
            free=info.free,
            configured=info.configured,
            model=info.model,
            description=info.description,
            signup_url=info.signup_url,
            models=info.models,
            selected=active == info.id,
        )
        for info in describe_providers(repo)
    ]


@router.get("/ai/models")
def ai_models(
    provider: str,
    refresh: bool = False,
    repo: SettingsRepository = Depends(get_settings_repo),
) -> dict:
    if provider not in PROVIDER_CATALOG:
        raise HTTPException(status_code=404, detail="Unknown provider")
    meta = PROVIDER_CATALOG[provider]
    suggested = list(meta.suggested_models)
    if meta.key_setting and not repo.get(meta.key_setting):
        return {
            "provider": provider,
            "models": suggested,
            "fetched": False,
            "message": "Add an API key to load the provider's current free model list.",
        }
    try:
        instance = build_provider(provider, repo)
        models = instance.list_models()
    except Exception as exc:
        return {
            "provider": provider,
            "models": suggested,
            "fetched": False,
            "message": str(exc)[:200],
        }
    if refresh:
        clear_health_cache()
    return {
        "provider": provider,
        "models": models or suggested,
        "fetched": bool(models),
        "message": f"Loaded {len(models)} models." if models else "Showing suggested models.",
    }


@router.post("/ai/test")
def ai_test(
    provider: str | None = None,
    repo: SettingsRepository = Depends(get_settings_repo),
) -> dict:
    if provider is not None and provider not in PROVIDER_CATALOG:
        raise HTTPException(status_code=404, detail="Unknown provider")
    if provider and repo.get("ai.provider") != provider:
        # Test a specific provider without changing the saved selection.
        configured = resolve_provider(repo, provider, ignore_consent=True)
    else:
        configured = resolve_provider(repo, ignore_consent=True)
    if configured is None:
        return {
            "ok": False,
            "message": "No usable AI provider. Add a free API key or start Ollama, then test again.",
        }
    ok, message = configured.health()
    clear_health_cache()
    return {
        "ok": ok,
        "message": message,
        "provider": configured.id,
        "model": configured.model,
    }


@router.get("/categories")
def categories() -> dict:
    return {"categories": DEFAULT_CATEGORIES, "folders": CATEGORY_FOLDERS}


@router.get("/dashboard", response_model=DashboardResponse)
def dashboard(
    db: Session = Depends(get_db), repo: SettingsRepository = Depends(get_settings_repo)
) -> DashboardResponse:
    file_count = db.scalar(select(func.count()).select_from(FileRecord)) or 0
    total_bytes = db.scalar(select(func.coalesce(func.sum(FileRecord.size), 0))) or 0
    session_count = db.scalar(select(func.count()).select_from(OrganizationSession)) or 0
    pending = db.scalar(
        select(func.count())
        .select_from(FileOperation)
        .where(FileOperation.status == "proposed")
    ) or 0

    recent_sessions = list(
        db.scalars(
            select(OrganizationSession)
            .order_by(OrganizationSession.created_at.desc())
            .limit(5)
        ).all()
    )
    recent_batches = list(
        db.scalars(select(OperationBatch).order_by(OperationBatch.created_at.desc()).limit(5)).all()
    )
    status = provider_health(repo)
    return DashboardResponse(
        files_indexed=int(file_count),
        total_bytes=int(total_bytes),
        sessions=int(session_count),
        pending_moves=int(pending),
        duplicate_groups=repo.get_int("stats.duplicate_groups", 0),
        duplicate_bytes=repo.get_int("stats.duplicate_bytes", 0),
        duplicate_scanned_at=repo.get("stats.duplicates_scanned_at") or None,
        recent_sessions=[session_payload(session) for session in recent_sessions],
        recent_batches=[batch_payload(db, batch) for batch in recent_batches],
        ai=AIStatus(**status),
    )


@router.post("/index/clear", response_model=MessageResponse)
def clear_index(db: Session = Depends(get_db)) -> MessageResponse:
    count = db.scalar(select(func.count()).select_from(FileEmbedding)) or 0
    db.query(FileEmbedding).delete()
    db.commit()
    return MessageResponse(message=f"Removed {count} embedding(s) from the local index.")
