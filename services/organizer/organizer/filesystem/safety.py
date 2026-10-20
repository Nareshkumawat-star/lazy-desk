"""Path validation helpers used before any filesystem mutation."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

INVALID_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
RESERVED_NAMES = {
    "con",
    "prn",
    "aux",
    "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}

_PROTECTED_PATHS: list[Path] = []
if sys.platform == "win32":
    for env in ("SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"):
        value = os.environ.get(env)
        if value:
            _PROTECTED_PATHS.append(Path(value))
else:
    for value in ("/System", "/Library", "/usr", "/etc", "/bin", "/sbin", "/dev", "/proc", "/sys"):
        _PROTECTED_PATHS.append(Path(value))


class FolderSelectionError(ValueError):
    """Raised when a folder cannot be used as an organization root."""


def _is_hidden(path: Path) -> bool:
    name = path.name
    if name.startswith("."):
        return True
    if sys.platform == "win32":
        try:
            import ctypes

            attrs = ctypes.windll.kernel32.GetFileAttributesW(str(path))  # type: ignore[attr-defined]
            if attrs != -1 and attrs & 0x2:
                return True
        except Exception:  # pragma: no cover - best effort only
            return False
    return False


def is_hidden(path: Path) -> bool:
    return _is_hidden(path)


def is_protected_path(path: str | Path) -> bool:
    """Reject filesystem roots, the home folder itself and OS-managed locations."""
    try:
        resolved = Path(path).expanduser().resolve()
    except OSError:
        return True
    if resolved.parent == resolved:
        return True
    try:
        if resolved == Path.home().resolve():
            return True
    except OSError:
        pass
    for protected in _PROTECTED_PATHS:
        try:
            resolved.relative_to(protected.resolve())
            return True
        except (ValueError, OSError):
            continue
    return False


def resolve_selected_folder(path: str | Path) -> Path:
    try:
        resolved = Path(path).expanduser().resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise FolderSelectionError(f"Folder does not exist or is not accessible: {path}") from exc
    if not resolved.is_dir():
        raise FolderSelectionError(f"Not a folder: {path}")
    if is_protected_path(resolved):
        raise FolderSelectionError(
            "That location is protected (system folder, drive root or home folder). "
            "Choose a specific folder such as Downloads or Desktop."
        )
    return resolved


def ensure_within(base: str | Path, candidate: str | Path) -> Path:
    """Resolve ``candidate`` and guarantee it stays inside ``base``."""
    base_path = Path(base).resolve()
    target = Path(candidate).expanduser().resolve()
    if target == base_path:
        return target
    try:
        target.relative_to(base_path)
    except ValueError as exc:
        raise FolderSelectionError(f"Path escapes the approved folder: {candidate}") from exc
    return target


def sanitize_folder_name(name: str, fallback: str = "Other") -> str:
    cleaned = INVALID_CHARS.sub("", (name or "").strip()).strip(". ")
    cleaned = re.sub(r"\s+", " ", cleaned)
    if not cleaned or cleaned in {".", ".."}:
        return fallback
    if cleaned.lower() in RESERVED_NAMES:
        return f"{cleaned}-files"
    return cleaned[:64].strip()


def unique_destination(
    destination: Path,
    taken: set[str] | None = None,
    *,
    case_insensitive: bool | None = None,
) -> tuple[Path, bool]:
    """Return a non-colliding destination plus whether it had to be renamed.

    ``taken`` should contain normalised paths already reserved by the current plan.
    """
    if case_insensitive is None:
        case_insensitive = sys.platform in {"win32", "darwin"}
    taken = taken if taken is not None else set()

    def key(path: Path) -> str:
        value = os.path.normpath(str(path))
        return os.path.normcase(value) if case_insensitive else value

    candidate = destination
    if not candidate.exists() and key(candidate) not in taken:
        taken.add(key(candidate))
        return candidate, False

    stem, suffix = candidate.stem, candidate.suffix
    parent = candidate.parent
    for index in range(1, 1000):
        alt = parent / f"{stem} ({index}){suffix}"
        if not alt.exists() and key(alt) not in taken:
            taken.add(key(alt))
            return alt, True
    raise FolderSelectionError(f"Could not find a free filename for {destination.name}")
