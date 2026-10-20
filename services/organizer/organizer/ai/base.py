"""Provider interface, catalog metadata and JSON helpers."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Protocol


class AIError(RuntimeError):
    """Raised when an AI provider cannot complete a request."""


@dataclass
class ProviderInfo:
    id: str
    label: str
    kind: str  # "local" | "cloud" | "rules"
    free: bool
    configured: bool
    model: str
    description: str
    signup_url: str | None = None
    notes: str = ""
    models: list[str] = field(default_factory=list)


class AIProvider(Protocol):
    id: str
    label: str
    model: str
    is_cloud: bool

    def chat_json(self, system: str, user: str) -> str: ...

    def embed(self, texts: list[str]) -> list[list[float]]: ...

    def health(self) -> tuple[bool, str]: ...

    def list_models(self) -> list[str]: ...


def extract_json(text: str):
    """Extract the first JSON object/array from a model response.

    Models frequently wrap JSON in markdown fences or add a sentence of prose.
    We scan for balanced braces while respecting string literals.
    """
    if not text:
        raise AIError("Empty response from model")
    cleaned = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", cleaned, re.DOTALL)
    if fenced:
        cleaned = fenced.group(1).strip()

    for opener, closer in (("{", "}"), ("[", "]")):
        start = cleaned.find(opener)
        if start == -1:
            continue
        depth = 0
        in_string = False
        escaped = False
        for index in range(start, len(cleaned)):
            char = cleaned[index]
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
            elif char == opener:
                depth += 1
            elif char == closer:
                depth -= 1
                if depth == 0:
                    candidate = cleaned[start : index + 1]
                    try:
                        return json.loads(candidate)
                    except json.JSONDecodeError:
                        break
    raise AIError("Model response did not contain valid JSON")


def clamp_confidence(value) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.5
    return max(0.0, min(1.0, number))
