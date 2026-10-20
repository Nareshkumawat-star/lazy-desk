"""Exact duplicate detection.

Files are grouped by size first, then hashed with SHA-256. Duplicates are never
deleted or moved by this module.
"""

from __future__ import annotations

import hashlib
import time
from datetime import datetime
from pathlib import Path

from ..database.repository import SettingsRepository
from ..filesystem.safety import resolve_selected_folder
from .scanner import scan_folder

CHUNK_SIZE = 1024 * 1024


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def find_duplicates(
    path: str,
    *,
    min_size: int = 1,
    max_files: int = 20000,
    settings: SettingsRepository | None = None,
) -> dict:
    started = time.perf_counter()
    root = resolve_selected_folder(path)
    scan = scan_folder(root, max_files=max_files)

    by_size: dict[int, list] = {}
    for item in scan.files:
        if item.size < min_size:
            continue
        by_size.setdefault(item.size, []).append(item)

    hashed = 0
    groups = []
    errors = list(scan.errors)
    for size, items in by_size.items():
        if len(items) < 2:
            continue
        by_hash: dict[str, list] = {}
        for item in items:
            try:
                digest = _hash_file(Path(item.path))
            except OSError as exc:
                errors.append(f"Could not read {item.name}: {exc.strerror or exc}")
                continue
            hashed += 1
            by_hash.setdefault(digest, []).append(item)
        for digest, matches in by_hash.items():
            if len(matches) < 2:
                continue
            matches.sort(key=lambda entry: entry.path.lower())
            groups.append(
                {
                    "hash": digest,
                    "size": size,
                    "count": len(matches),
                    "potential_savings": size * (len(matches) - 1),
                    "files": [
                        {
                            "path": entry.path,
                            "name": entry.name,
                            "size": entry.size,
                            "modified_at": entry.modified_at,
                        }
                        for entry in matches
                    ],
                }
            )

    groups.sort(key=lambda group: group["potential_savings"], reverse=True)
    potential = sum(group["potential_savings"] for group in groups)
    duration = int((time.perf_counter() - started) * 1000)

    if settings is not None:
        settings.set("stats.duplicate_groups", str(len(groups)))
        settings.set("stats.duplicate_bytes", str(potential))
        settings.set("stats.duplicates_scanned_at", datetime.now().isoformat(timespec="seconds"))

    return {
        "root": str(root),
        "groups": groups,
        "scanned_files": len(scan.files),
        "hashed_files": hashed,
        "potential_savings": potential,
        "duration_ms": duration,
        "skipped": scan.skipped,
        "errors": errors[:20],
    }
