"""Safe, read-only folder scanner.

The scanner never follows symbolic links, never reads file contents and only
returns metadata for regular files inside the selected folder.
"""

from __future__ import annotations

import os
import stat
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from ..filesystem.safety import is_hidden

EXCLUDED_DIRS = {
    "node_modules",
    "__pycache__",
    ".git",
    ".svn",
    ".hg",
    ".venv",
    "venv",
    "env",
    "system volume information",
    "$recycle.bin",
    "appdata",
    "windows",
    "windows.old",
    "program files",
    "program files (x86)",
    "proc",
    "sys",
    "dev",
}

MAX_DEFAULT_FILES = 20000
MAX_DEFAULT_DEPTH = 12


@dataclass
class ScannedFile:
    path: str
    name: str
    extension: str
    size: int
    modified_at: datetime | None


@dataclass
class ScanResult:
    root: str
    files: list[ScannedFile] = field(default_factory=list)
    skipped: int = 0
    errors: list[str] = field(default_factory=list)
    truncated: bool = False
    excluded_dirs: list[str] = field(default_factory=list)
    total_bytes: int = 0


def _safe_mtime(entry: os.DirEntry[str]) -> datetime | None:
    try:
        return datetime.fromtimestamp(entry.stat(follow_symlinks=False).st_mtime, tz=UTC)
    except OSError:
        return None


def scan_folder(
    root: str | Path,
    *,
    max_depth: int = MAX_DEFAULT_DEPTH,
    max_files: int = MAX_DEFAULT_FILES,
    include_hidden: bool = False,
    include_system: bool = False,
    on_progress=None,
) -> ScanResult:
    root_path = Path(root).expanduser().resolve()
    result = ScanResult(root=str(root_path))

    stack: list[tuple[Path, int]] = [(root_path, 0)]
    while stack:
        current, depth = stack.pop()
        if depth > max_depth:
            continue
        try:
            with os.scandir(current) as entries:
                children = list(entries)
        except PermissionError:
            result.errors.append(f"Permission denied: {current}")
            result.skipped += 1
            continue
        except OSError as exc:
            result.errors.append(f"Could not read {current}: {exc.strerror or exc}")
            result.skipped += 1
            continue

        subdirs: list[Path] = []
        for entry in children:
            try:
                if entry.is_symlink():
                    result.skipped += 1
                    continue
                is_dir = entry.is_dir(follow_symlinks=False)
                if is_dir:
                    if include_hidden is False and is_hidden(Path(entry.path)):
                        continue
                    if include_system is False and entry.name.lower() in EXCLUDED_DIRS:
                        if entry.name.lower() in {"node_modules", "__pycache__", ".git", ".venv"}:
                            result.excluded_dirs.append(entry.path)
                        continue
                    subdirs.append(Path(entry.path))
                    continue
                if not entry.is_file(follow_symlinks=False):
                    continue
                name_path = Path(entry.path)
                if include_hidden is False and is_hidden(name_path):
                    continue
                if include_system is False and name_path.name.lower() in {
                    "desktop.ini",
                    "thumbs.db",
                    ".ds_store",
                }:
                    continue
                size = entry.stat(follow_symlinks=False).st_size
                result.files.append(
                    ScannedFile(
                        path=str(name_path),
                        name=entry.name,
                        extension=name_path.suffix.lower().lstrip("."),
                        size=size,
                        modified_at=_safe_mtime(entry),
                    )
                )
                result.total_bytes += size
                if len(result.files) >= max_files:
                    result.truncated = True
                    result.skipped += max(0, len(children) - 1)
                    stack.clear()
                    break
            except OSError as exc:
                result.errors.append(f"Skipped {entry.path}: {exc.strerror or exc}")
                result.skipped += 1

        if result.truncated:
            break
        for sub in subdirs:
            stack.append((sub, depth + 1))
        if on_progress is not None:
            on_progress(len(result.files))

    # Only keep a handful of errors: enough to inform the user without a wall of text.
    result.errors = result.errors[:20]
    return result


def is_regular_file(path: str | Path) -> bool:
    try:
        st = os.lstat(path)
    except OSError:
        return False
    return stat.S_ISREG(st.st_mode)
