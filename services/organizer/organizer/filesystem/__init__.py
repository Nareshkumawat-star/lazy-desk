"""Filesystem safety helpers."""

from .safety import (
    FolderSelectionError,
    ensure_within,
    is_protected_path,
    resolve_selected_folder,
    sanitize_folder_name,
    unique_destination,
)

__all__ = [
    "FolderSelectionError",
    "ensure_within",
    "is_protected_path",
    "resolve_selected_folder",
    "sanitize_folder_name",
    "unique_destination",
]
