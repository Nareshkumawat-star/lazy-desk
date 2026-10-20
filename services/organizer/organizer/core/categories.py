"""Deterministic category rules used as the AI fallback and first pass."""

from __future__ import annotations

from pathlib import Path

CATEGORY_FOLDERS: dict[str, str] = {
    "Documents": "Documents",
    "Images": "Images",
    "Videos": "Videos",
    "Audio": "Audio",
    "Source Code": "Source-Code",
    "Projects": "Projects",
    "Presentations": "Presentations",
    "Spreadsheets": "Spreadsheets",
    "Archives": "Archives",
    "Installers": "Installers",
    "Other": "Other",
}

DEFAULT_CATEGORIES = list(CATEGORY_FOLDERS.keys())

_EXTENSION_GROUPS: dict[str, tuple[str, ...]] = {
    "Documents": (
        "pdf",
        "doc",
        "docx",
        "odt",
        "rtf",
        "txt",
        "md",
        "markdown",
        "tex",
        "epub",
        "mobi",
        "pages",
        "json",
        "xml",
        "yaml",
        "yml",
        "toml",
        "ini",
        "cfg",
    ),
    "Images": (
        "jpg",
        "jpeg",
        "png",
        "gif",
        "bmp",
        "webp",
        "svg",
        "heic",
        "heif",
        "tif",
        "tiff",
        "ico",
        "raw",
        "cr2",
        "nef",
        "psd",
        "ai",
        "sketch",
        "fig",
    ),
    "Videos": (
        "mp4",
        "mkv",
        "avi",
        "mov",
        "wmv",
        "webm",
        "flv",
        "m4v",
        "mpg",
        "mpeg",
        "3gp",
        "ts",
    ),
    "Audio": (
        "mp3",
        "wav",
        "flac",
        "aac",
        "ogg",
        "oga",
        "m4a",
        "wma",
        "opus",
        "mid",
        "midi",
        "aiff",
    ),
    "Source Code": (
        "py",
        "pyw",
        "js",
        "mjs",
        "cjs",
        "jsx",
        "ts",
        "tsx",
        "java",
        "c",
        "h",
        "cpp",
        "cc",
        "hpp",
        "cs",
        "go",
        "rs",
        "rb",
        "php",
        "swift",
        "kt",
        "kts",
        "scala",
        "sh",
        "bash",
        "zsh",
        "ps1",
        "html",
        "htm",
        "css",
        "scss",
        "sass",
        "less",
        "vue",
        "svelte",
        "lua",
        "r",
        "pl",
        "ex",
        "exs",
        "dart",
        "sql",
        "ipynb",
    ),
    "Presentations": ("ppt", "pptx", "odp", "key", "pps", "ppsx"),
    "Spreadsheets": ("xls", "xlsx", "xlsm", "ods", "numbers", "csv", "tsv"),
    "Archives": (
        "zip",
        "rar",
        "7z",
        "tar",
        "gz",
        "tgz",
        "bz2",
        "xz",
        "zst",
        "cab",
        "iso",
        "lz",
        "lzma",
    ),
    "Installers": (
        "exe",
        "msi",
        "msix",
        "appx",
        "pkg",
        "deb",
        "rpm",
        "appimage",
        "apk",
        "dmg",
    ),
}

EXTENSION_CATEGORY: dict[str, str] = {}
for _category, _extensions in _EXTENSION_GROUPS.items():
    for _ext in _extensions:
        # First mapping wins so spreadsheet CSV stays a spreadsheet.
        EXTENSION_CATEGORY.setdefault(_ext, _category)

# Extensions with no reliable meaning; let the local model look at the filename.
AMBIGUOUS_EXTENSIONS = {"", "dat", "tmp", "temp", "bak", "bin", "file", "unknown", "part", "cache"}

PROJECT_MARKERS = {
    "package.json",
    "pyproject.toml",
    "poetry.lock",
    "requirements.txt",
    "cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "cmakelists.txt",
    "makefile",
    "dockerfile",
    "docker-compose.yml",
    "composer.json",
    "gemfile",
    "setup.py",
    "setup.cfg",
    "tsconfig.json",
    "vite.config.ts",
    "next.config.js",
    "next.config.mjs",
}

INSTALLER_NAME_HINTS = ("setup", "install", "installer")


def extension_of(name: str) -> str:
    suffix = Path(name).suffix.lower()
    return suffix[1:] if suffix.startswith(".") else suffix


def rule_category(name: str) -> tuple[str, float, str]:
    """Classify a single filename with deterministic rules."""
    lower = name.lower()
    ext = extension_of(lower)

    if lower in PROJECT_MARKERS or lower.endswith((".sln", ".csproj", ".vcxproj")):
        return "Projects", 0.9, f"Project manifest ({ext or lower})"

    if ext in AMBIGUOUS_EXTENSIONS:
        return "Other", 0.2, "Unrecognised or missing file extension"

    if ext in {"exe", "msi", "msix", "appx"} and any(h in lower for h in INSTALLER_NAME_HINTS):
        return "Installers", 0.95, f"Installer package ({ext})"

    category = EXTENSION_CATEGORY.get(ext)
    if category:
        return category, 0.92, f"{ext.upper()} files are typically {category.lower()}"

    return "Other", 0.25, "No rule matched this file type"


def needs_ai(name: str, category: str, confidence: float) -> bool:
    ext = extension_of(name)
    return ext in AMBIGUOUS_EXTENSIONS or confidence < 0.6
