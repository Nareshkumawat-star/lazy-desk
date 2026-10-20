"""Natural-language file search.

Deterministic metadata filters always work. When a free AI provider is ready it
parses the query into structured filters, and embeddings are used to rerank when
an index has been built.
"""

from __future__ import annotations

import json
import math
import os
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai.service import AIService, resolve_provider
from ..database.models import FileEmbedding, FileRecord
from ..database.repository import SettingsRepository
from ..schemas import SearchFilters, SearchHit
from .categories import DEFAULT_CATEGORIES, EXTENSION_CATEGORY

STOPWORDS = {
    "a",
    "an",
    "and",
    "any",
    "all",
    "are",
    "find",
    "for",
    "from",
    "get",
    "give",
    "i",
    "in",
    "is",
    "it",
    "me",
    "my",
    "of",
    "on",
    "or",
    "please",
    "show",
    "some",
    "that",
    "the",
    "to",
    "with",
    "files",
    "file",
}

CATEGORY_WORDS = {
    "document": "Documents",
    "documents": "Documents",
    "docs": "Documents",
    "image": "Images",
    "images": "Images",
    "photos": "Images",
    "pictures": "Images",
    "screenshots": "Images",
    "video": "Videos",
    "videos": "Videos",
    "movies": "Videos",
    "audio": "Audio",
    "music": "Audio",
    "songs": "Audio",
    "code": "Source Code",
    "source": "Source Code",
    "scripts": "Source Code",
    "projects": "Projects",
    "presentations": "Presentations",
    "slides": "Presentations",
    "spreadsheets": "Spreadsheets",
    "archives": "Archives",
    "zip": "Archives",
    "installers": "Installers",
}

EXTENSION_WORDS = {
    "pdf": "pdf",
    "pdfs": "pdf",
    "python": "py",
    "py": "py",
    "javascript": "js",
    "typescript": "ts",
    "excel": "xlsx",
    "word": "docx",
    "powerpoint": "pptx",
    "csv": "csv",
    "json": "json",
    "markdown": "md",
    "text": "txt",
    "zip": "zip",
    "images": None,
    "video": None,
}

TEXT_INDEX_EXTENSIONS = {
    "txt",
    "md",
    "markdown",
    "py",
    "js",
    "ts",
    "tsx",
    "jsx",
    "json",
    "yaml",
    "yml",
    "toml",
    "csv",
    "html",
    "css",
    "java",
    "c",
    "cpp",
    "go",
    "rs",
    "rb",
    "php",
    "sql",
    "sh",
}


def rule_parse_query(query: str) -> dict:
    lowered = query.lower()
    tokens = re.findall(r"[a-zA-Z0-9_.\-]+", lowered)
    category = None
    extensions: list[str] = []
    min_size_mb = None
    max_size_mb = None
    days = None

    for word in tokens:
        if word in CATEGORY_WORDS and category is None:
            candidate = CATEGORY_WORDS[word]
            if candidate in DEFAULT_CATEGORIES:
                category = candidate
        ext = EXTENSION_WORDS.get(word)
        if ext and ext not in extensions:
            extensions.append(ext)
        if word.startswith(".") and len(word) > 1:
            ext = word[1:]
            if ext not in extensions:
                extensions.append(ext)

    if re.search(r"\b(large|big|huge|giant)\b", lowered):
        min_size_mb = 100
    if re.search(r"\b(small|tiny)\b", lowered):
        max_size_mb = 1
    if re.search(r"\b(today|last 24 hours)\b", lowered):
        days = 1
    elif re.search(r"\b(this week|last week|past week|recent|recently)\b", lowered):
        days = 7
    elif re.search(r"\b(this month|last month|past month)\b", lowered):
        days = 30
    elif re.search(r"\b(this year|last year)\b", lowered):
        days = 365

    keywords = []
    for token in tokens:
        if token in STOPWORDS or token in CATEGORY_WORDS:
            continue
        if token in EXTENSION_WORDS:
            continue
        if re.fullmatch(r"[\d.]+", token):
            continue
        keywords.append(token)
    if not keywords:
        # Allow searching by extension-like words, e.g. "find pdfs".
        pass

    return {
        "category": category,
        "extensions": extensions,
        "keywords": keywords[:8],
        "min_size_mb": min_size_mb,
        "max_size_mb": max_size_mb,
        "modified_within_days": days,
    }


def _merge_filters(rule_filters: dict, ai_filters: dict | None) -> dict:
    merged = dict(rule_filters)
    if ai_filters:
        for key in ("category", "extensions", "keywords", "min_size_mb", "max_size_mb", "modified_within_days"):
            value = ai_filters.get(key)
            if value:
                merged[key] = value
        if ai_filters.get("semantic_query"):
            merged["semantic_query"] = ai_filters["semantic_query"]
    return merged


def _latest_files(db: Session, limit: int = 60000) -> list[FileRecord]:
    rows = db.scalars(select(FileRecord).order_by(FileRecord.id.desc()).limit(limit)).all()
    seen: set[str] = set()
    unique: list[FileRecord] = []
    for row in rows:
        key = os.path.normcase(row.path)
        if key in seen:
            continue
        seen.add(key)
        unique.append(row)
    return unique


def _normalize_extensions(values: list[str] | None) -> list[str]:
    if not values:
        return []
    return [value.lower().lstrip(".").strip() for value in values if value]


def search_files(
    db: Session,
    settings: SettingsRepository,
    *,
    query: str,
    root_path: str | None = None,
    limit: int = 50,
    use_ai: bool = True,
    category: str | None = None,
    extensions: list[str] | None = None,
) -> tuple[list[SearchHit], SearchFilters, bool, str | None, str]:
    rule_filters = rule_parse_query(query)
    provider = resolve_provider(settings) if use_ai else None
    ai_filters = None
    provider_id = provider.id if provider else None

    if provider is not None and use_ai:
        try:
            ai_filters = AIService(settings, provider).parse_search_query(query, DEFAULT_CATEGORIES)
        except Exception:
            ai_filters = None
    filters = _merge_filters(rule_filters, ai_filters)

    if category:
        filters["category"] = category
    if extensions:
        filters["extensions"] = _normalize_extensions(extensions)
    else:
        filters["extensions"] = _normalize_extensions(filters.get("extensions"))

    # A precise extension is a better signal than a loose word like "projects".
    if filters["extensions"]:
        derived = {EXTENSION_CATEGORY.get(ext) for ext in filters["extensions"]}
        if len(derived) == 1 and None not in derived:
            if filters.get("category") in (None, "Projects"):
                filters["category"] = derived.pop()

    keywords = [str(word).lower() for word in filters.get("keywords") or [] if str(word).strip()]
    now = datetime.now(UTC)
    min_bytes = int((filters.get("min_size_mb") or 0) * 1024 * 1024)
    max_bytes = int(filters["max_size_mb"] * 1024 * 1024) if filters.get("max_size_mb") else None
    days = filters.get("modified_within_days")
    cutoff = now - timedelta(days=days) if days else None
    root_prefix = os.path.normcase(str(Path(root_path).resolve())) if root_path else None

    candidates: list[tuple[FileRecord, float, str]] = []
    for record in _latest_files(db):
        if root_prefix and not os.path.normcase(record.path).startswith(root_prefix):
            continue
        if filters.get("category") and (record.category or "Other") != filters["category"]:
            continue
        ext = (record.extension or "").lower()
        if filters["extensions"] and ext not in filters["extensions"]:
            continue
        if record.size < min_bytes:
            continue
        if max_bytes is not None and record.size > max_bytes:
            continue
        if cutoff is not None:
            modified = record.modified_at
            if modified is None:
                continue
            if modified.tzinfo is None:
                modified = modified.replace(tzinfo=UTC)
            if modified < cutoff:
                continue
        name_lower = record.name.lower()
        if keywords and not all(word in name_lower for word in keywords):
            continue
        if not Path(record.path).exists():
            continue

        score = 0.5
        reasons = []
        for word in keywords:
            if word in name_lower:
                score += 0.25
                reasons.append(f"name contains '{word}'")
        if filters.get("category"):
            score += 0.15
            reasons.append(f"category {filters['category']}")
        if filters["extensions"]:
            score += 0.1
            reasons.append(f".{ext} file")
        if record.modified_at is not None:
            modified = record.modified_at
            if modified.tzinfo is None:
                modified = modified.replace(tzinfo=UTC)
            age_days = max(0.0, (now - modified).total_seconds() / 86400)
            score += max(0.0, 0.1 - min(age_days, 365) / 3650)
        if not reasons:
            reasons.append("Metadata match")
        candidates.append((record, min(score, 0.95), ", ".join(reasons[:3])))

    semantic_used = False
    message = ""
    semantic_query = filters.get("semantic_query") or query
    if settings.get_bool("search.semantic_enabled", True) and candidates:
        embedding_provider = resolve_provider(settings, prefer_embeddings=True)
        if embedding_provider is not None:
            try:
                paths = [record.path for record, _, _ in candidates[: min(len(candidates), 800)]]
                rows = db.scalars(
                    select(FileEmbedding).where(FileEmbedding.path.in_(paths))
                ).all()
                if rows:
                    service = AIService(settings, embedding_provider)
                    query_vector = service.embed([semantic_query])[0]
                    vectors = {row.path: json.loads(row.vector_json) for row in rows}
                    rescored = []
                    for record, score, reason in candidates:
                        vector = vectors.get(record.path)
                        if vector and len(vector) == len(query_vector):
                            similarity = _cosine(query_vector, vector)
                            score = min(0.99, score * 0.55 + max(0.0, similarity) * 0.45 + 0.05)
                            reason = f"{reason}; semantic match {similarity:.2f}"
                        rescored.append((record, score, reason))
                    candidates = rescored
                    semantic_used = True
            except Exception as exc:
                message = f"Semantic reranking unavailable: {str(exc)[:120]}"
        elif settings.get_bool("index.content_enabled", False):
            message = "Semantic search needs an embedding-capable provider (Gemini or Ollama)."

    candidates.sort(key=lambda entry: (-entry[1], -(entry[0].modified_at.timestamp() if entry[0].modified_at else 0)))
    hits = [
        SearchHit(
            path=record.path,
            name=record.name,
            extension=record.extension,
            size=record.size,
            modified_at=record.modified_at,
            category=record.category,
            score=round(score, 3),
            match_reason=reason,
        )
        for record, score, reason in candidates[:limit]
    ]

    if not hits and not message:
        message = "No files matched. Try a broader query or scan more folders first."
    elif len(candidates) > limit:
        message = f"Showing the top {limit} of {len(candidates)} matches."

    return (
        hits,
        SearchFilters(
            category=filters.get("category"),
            extensions=filters["extensions"],
            keywords=keywords,
            min_size_mb=filters.get("min_size_mb"),
            max_size_mb=filters.get("max_size_mb"),
            modified_within_days=days,
        ),
        semantic_used,
        provider_id,
        message,
    )


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def index_files(
    db: Session,
    settings: SettingsRepository,
    *,
    root_path: str | None = None,
    limit: int = 2000,
) -> tuple[int, str | None, str | None, str]:
    provider = resolve_provider(settings, prefer_embeddings=True)
    if provider is None:
        return 0, None, None, (
            "No embedding-capable provider is ready. Gemini (free tier) and Ollama "
            "(with nomic-embed-text) support embeddings."
        )
    service = AIService(settings, provider)
    content_enabled = settings.get_bool("index.content_enabled", False)

    files = _latest_files(db)
    prefix = os.path.normcase(str(Path(root_path).resolve())) if root_path else None
    selected = [
        record
        for record in files
        if (prefix is None or os.path.normcase(record.path).startswith(prefix))
        and Path(record.path).exists()
    ][:limit]
    if not selected:
        return 0, provider.id, provider.model, "No indexed files matched; scan a folder first."

    indexed = 0
    model_name = getattr(provider, "embedding_model", provider.model)
    for start in range(0, len(selected), 32):
        batch = selected[start : start + 32]
        texts = []
        flags = []
        for record in batch:
            text = f"{record.name} {record.extension} {record.category or ''}".strip()
            used_content = False
            if (
                content_enabled
                and record.extension in TEXT_INDEX_EXTENSIONS
                and record.size <= 512 * 1024
            ):
                try:
                    snippet = Path(record.path).read_text(encoding="utf-8", errors="ignore")[:4000]
                    text = f"{text}\n{snippet}"
                    used_content = True
                except OSError:
                    pass
            texts.append(text or record.name)
            flags.append(used_content)
        try:
            vectors = service.embed(texts)
        except Exception as exc:
            return indexed, provider.id, model_name, f"Embedding failed: {str(exc)[:160]}"
        for record, vector, used_content in zip(batch, vectors, flags, strict=True):
            existing = db.scalar(select(FileEmbedding).where(FileEmbedding.path == record.path))
            payload = json.dumps(vector)
            if existing is None:
                db.add(
                    FileEmbedding(
                        path=record.path,
                        model=f"{provider.id}:{model_name}",
                        vector_json=payload,
                        content_indexed=used_content,
                    )
                )
            else:
                existing.vector_json = payload
                existing.model = f"{provider.id}:{model_name}"
                existing.content_indexed = used_content
            indexed += 1
        db.commit()
    return indexed, provider.id, model_name, f"Indexed {indexed} file{'s' if indexed != 1 else ''}."
