"""Pluggable AI providers used by LazyDesk."""

from .base import AIError, ProviderInfo
from .service import AIService, resolve_provider

__all__ = ["AIService", "AIError", "ProviderInfo", "resolve_provider"]
