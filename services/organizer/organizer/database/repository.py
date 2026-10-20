"""Small repository helpers for settings and allowed filesystem roots."""

from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AllowedRoot, AppSetting

DEFAULTS: dict[str, str] = {
    "ai.enabled": "true",
    "ai.provider": "auto",
    "ai.scope": "ambiguous",
    "ai.cloud_consent": "false",
    "ai.batch_size": "20",
    "ai.timeout_seconds": "60",
    "ai.ollama_url": "http://127.0.0.1:11434",
    "ai.model.openrouter": "meta-llama/llama-3.3-70b-instruct:free",
    "ai.model.gemini": "gemini-2.5-flash",
    "ai.model.groq": "llama-3.3-70b-versatile",
    "ai.model.huggingface": "Qwen/Qwen2.5-7B-Instruct",
    "ai.model.ollama": "qwen2.5:7b",
    "ai.model.pollinations": "openai",
    "ai.embedding.provider": "auto",
    "ai.embedding.model": "gemini-embedding-001",
    "ai.key.openrouter": "",
    "ai.key.gemini": "",
    "ai.key.groq": "",
    "ai.key.huggingface": "",
    "index.content_enabled": "false",
    "search.semantic_enabled": "true",
    "automation.enabled": "false",
    "theme": "system",
    "stats.duplicate_groups": "0",
    "stats.duplicate_bytes": "0",
    "stats.duplicates_scanned_at": "",
}

SECRET_KEYS = {
    "ai.key.openrouter",
    "ai.key.gemini",
    "ai.key.groq",
    "ai.key.huggingface",
}

PROVIDERS = ["openrouter", "gemini", "groq", "huggingface", "pollinations", "ollama"]


class SettingsRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get(self, key: str, default: str | None = None) -> str | None:
        row = self.session.get(AppSetting, key)
        if row is not None and row.value is not None:
            return row.value
        if default is not None:
            return default
        return DEFAULTS.get(key)

    def get_bool(self, key: str, default: bool = False) -> bool:
        raw = self.get(key)
        if raw is None:
            return default
        return str(raw).strip().lower() in {"1", "true", "yes", "on"}

    def get_int(self, key: str, default: int = 0) -> int:
        raw = self.get(key)
        try:
            return int(raw) if raw is not None else default
        except (TypeError, ValueError):
            return default

    def set(self, key: str, value: str | None) -> None:
        row = self.session.get(AppSetting, key)
        if row is None:
            row = AppSetting(key=key, value=value)
            self.session.add(row)
        else:
            row.value = value
        self.session.commit()

    def as_dict(self, include_secrets: bool = False) -> dict[str, str | None]:
        rows = self.session.scalars(select(AppSetting)).all()
        data = dict(DEFAULTS)
        for row in rows:
            data[row.key] = row.value
        if not include_secrets:
            for key in SECRET_KEYS:
                data.pop(key, None)
        return data


def add_allowed_root(session: Session, path: str | Path) -> AllowedRoot:
    resolved = str(Path(path).expanduser().resolve())
    existing = session.scalar(select(AllowedRoot).where(AllowedRoot.path == resolved))
    if existing is not None:
        return existing
    root = AllowedRoot(path=resolved)
    session.add(root)
    session.commit()
    return root


def allowed_roots(session: Session) -> list[str]:
    return [row.path for row in session.scalars(select(AllowedRoot)).all()]


def is_path_allowed(session: Session, path: str | Path, roots: list[str] | None = None) -> bool:
    """True when ``path`` resolves inside one of the user-approved roots."""
    roots = roots if roots is not None else [row.path for row in session.scalars(select(AllowedRoot))]
    try:
        target = Path(path).expanduser().resolve()
    except OSError:
        return False
    for root in roots:
        try:
            base = Path(root).resolve()
        except OSError:
            continue
        if target == base:
            return True
        try:
            target.relative_to(base)
        except ValueError:
            continue
        return True
    return False


def same_path(a: str | Path, b: str | Path) -> bool:
    try:
        return os.path.normcase(str(Path(a).resolve())) == os.path.normcase(str(Path(b).resolve()))
    except OSError:
        return False
