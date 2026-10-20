"""Concrete AI providers.

Free hosted options are first-class here because they are the easiest way for a
new contributor to try LazyDesk without downloading a multi-gigabyte model:

* OpenRouter — several ``:free`` open-weight models, no card required
* Google AI Studio (Gemini) — free tier, no card required
* Groq — free developer tier for open-weight Llama/Qwen models
* Hugging Face Inference Providers — small free monthly credit
* Ollama — fully local inference (optional, not required)

All of them receive filenames only, never file contents or full paths, and only
after the user explicitly enables cloud processing.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from .base import AIError, AIProvider


class _HTTPProvider:
    def _request(self, method: str, url: str, **kwargs):
        kwargs.setdefault("timeout", self.timeout)  # type: ignore[attr-defined]
        try:
            response = httpx.request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            raise AIError(f"Could not reach {self.label}: {exc.__class__.__name__}") from exc
        if response.status_code >= 400:
            detail = ""
            try:
                payload = response.json()
                detail = (
                    payload.get("error", {}).get("message")
                    if isinstance(payload.get("error"), dict)
                    else payload.get("error") or payload.get("message")
                ) or ""
            except Exception:
                detail = response.text[:200]
            raise AIError(f"{self.label} error {response.status_code}: {detail}".strip())
        return response


class OpenAICompatibleProvider(_HTTPProvider):
    """OpenRouter, Groq and Hugging Face all speak the OpenAI chat schema."""

    supports_embeddings = False

    def __init__(
        self,
        provider_id: str,
        label: str,
        base_url: str,
        api_key: str,
        model: str,
        timeout: float = 60.0,
        is_cloud: bool = True,
        extra_headers: dict[str, str] | None = None,
        free_only: bool = False,
        chat_path: str = "/chat/completions",
        models_path: str = "/models",
    ) -> None:
        self.id = provider_id
        self.label = label
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.is_cloud = is_cloud
        self.extra_headers = extra_headers or {}
        self.free_only = free_only
        self.chat_path = chat_path
        self.models_path = models_path

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            **self.extra_headers,
        }

    def chat_json(self, system: str, user: str) -> str:
        payload = {
            "model": self.model,
            "temperature": 0.1,
            "max_tokens": 1500,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "response_format": {"type": "json_object"},
        }
        try:
            response = self._request(
                "POST",
                f"{self.base_url}{self.chat_path}",
                headers=self._headers(),
                json=payload,
            )
        except AIError as exc:
            # Some providers reject response_format; retry once without it.
            if "response_format" not in str(exc):
                raise
            payload.pop("response_format", None)
            response = self._request(
                "POST",
                f"{self.base_url}{self.chat_path}",
                headers=self._headers(),
                json=payload,
            )
        data = response.json()
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise AIError(f"{self.label} returned an unexpected response") from exc
        if isinstance(content, list):
            content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
        return content or ""

    def health(self) -> tuple[bool, str]:
        if not self.api_key:
            return False, "No API key configured"
        try:
            self._request(
                "GET", f"{self.base_url}{self.models_path}", headers=self._headers(), timeout=8.0
            )
            return True, f"Connected to {self.label}"
        except AIError as exc:
            return False, str(exc)

    def list_models(self) -> list[str]:
        try:
            response = self._request(
                "GET", f"{self.base_url}{self.models_path}", headers=self._headers(), timeout=10.0
            )
        except AIError:
            return []
        try:
            payload = response.json()
        except ValueError:
            return []
        if isinstance(payload, dict):
            data = payload.get("data", [])
        elif isinstance(payload, list):
            data = payload
        else:
            return []
        models: list[str] = []
        for entry in data:
            if not isinstance(entry, dict):
                continue
            model_id = entry.get("id") or entry.get("name")
            if not isinstance(model_id, str):
                continue
            if self.free_only:
                pricing = entry.get("pricing") or {}
                prompt_price = str(pricing.get("prompt", "")).strip().lower()
                is_free = model_id.endswith(":free") or prompt_price in {
                    "0",
                    "0.0",
                    "0.00",
                    "",
                }
                if not is_free:
                    continue
            models.append(model_id)
        return sorted(set(models))[:400]

    def embed(self, texts: list[str]) -> list[list[float]]:
        raise AIError(f"{self.label} does not provide embeddings in LazyDesk")


class GeminiProvider(_HTTPProvider):
    supports_embeddings = True

    def __init__(
        self,
        api_key: str,
        model: str,
        timeout: float = 60.0,
        embedding_model: str = "gemini-embedding-001",
    ) -> None:
        self.id = "gemini"
        self.label = "Google Gemini"
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.is_cloud = True
        self.base_url = "https://generativelanguage.googleapis.com/v1beta"
        self.embedding_model = embedding_model

    def _headers(self) -> dict[str, str]:
        return {"x-goog-api-key": self.api_key, "Content-Type": "application/json"}

    def chat_json(self, system: str, user: str) -> str:
        payload = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {
                "temperature": 0.1,
                "maxOutputTokens": 2048,
                "responseMimeType": "application/json",
            },
        }
        response = self._request(
            "POST",
            f"{self.base_url}/models/{self.model}:generateContent",
            headers=self._headers(),
            json=payload,
        )
        data = response.json()
        try:
            parts = data["candidates"][0]["content"]["parts"]
            return "".join(part.get("text", "") for part in parts)
        except (KeyError, IndexError, TypeError) as exc:
            raise AIError("Gemini returned an unexpected response") from exc

    def health(self) -> tuple[bool, str]:
        if not self.api_key:
            return False, "No API key configured"
        try:
            self._request(
                "GET",
                f"{self.base_url}/models/{self.model}",
                headers=self._headers(),
                timeout=8.0,
            )
            return True, "Connected to Google Gemini"
        except AIError as exc:
            return False, str(exc)

    def list_models(self) -> list[str]:
        try:
            response = self._request(
                "GET", f"{self.base_url}/models", headers=self._headers(), timeout=10.0
            )
        except AIError:
            return []
        models = []
        for entry in response.json().get("models", []):
            methods = entry.get("supportedGenerationMethods") or []
            if "generateContent" in methods:
                models.append(str(entry.get("name", "")).replace("models/", ""))
        return sorted(models)

    def embed(self, texts: list[str]) -> list[list[float]]:
        requests = [
            {
                "model": f"models/{self.embedding_model}",
                "content": {"parts": [{"text": text[:8000]}]},
            }
            for text in texts
        ]
        response = self._request(
            "POST",
            f"{self.base_url}/models/{self.embedding_model}:batchEmbedContents",
            headers=self._headers(),
            json={"requests": requests},
        )
        return [item["values"] for item in response.json().get("embeddings", [])]


class OllamaProvider(_HTTPProvider):
    supports_embeddings = True

    def __init__(
        self,
        base_url: str,
        model: str,
        timeout: float = 120.0,
        embedding_model: str = "nomic-embed-text",
    ) -> None:
        self.id = "ollama"
        self.label = "Ollama (local)"
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.is_cloud = False
        self.embedding_model = embedding_model

    def chat_json(self, system: str, user: str) -> str:
        payload = {
            "model": self.model,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.1},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        response = self._request(
            "POST", f"{self.base_url}/api/chat", json=payload, timeout=self.timeout
        )
        try:
            return response.json()["message"]["content"]
        except (KeyError, ValueError, TypeError) as exc:
            raise AIError("Ollama returned an unexpected response") from exc

    def health(self) -> tuple[bool, str]:
        try:
            response = self._request("GET", f"{self.base_url}/api/tags", timeout=3.0)
            names = [m.get("name", "") for m in response.json().get("models", [])]
        except AIError:
            return False, "Ollama is not running"
        except ValueError:
            return True, "Ollama is running"
        if self.model not in names and f"{self.model}:latest" not in names:
            return False, f"Ollama is running but {self.model} is not installed"
        return True, f"Ollama ready with {self.model}"

    def list_models(self) -> list[str]:
        try:
            response = self._request("GET", f"{self.base_url}/api/tags", timeout=4.0)
            return sorted(m.get("name", "") for m in response.json().get("models", []))
        except (AIError, ValueError):
            return []

    def embed(self, texts: list[str]) -> list[list[float]]:
        response = self._request(
            "POST",
            f"{self.base_url}/api/embed",
            json={"model": self.embedding_model, "input": texts},
            timeout=self.timeout,
        )
        embeddings = response.json().get("embeddings")
        if not embeddings:
            raise AIError("Ollama did not return embeddings")
        return embeddings


@dataclass(frozen=True)
class ProviderMeta:
    id: str
    label: str
    kind: str
    description: str
    signup_url: str | None
    suggested_models: tuple[str, ...]
    key_setting: str | None
    model_setting: str
    default_model: str


PROVIDER_CATALOG: dict[str, ProviderMeta] = {
    "openrouter": ProviderMeta(
        id="openrouter",
        label="OpenRouter (free models)",
        kind="cloud",
        description=(
            "One free API key unlocks many open-weight models such as Llama, Qwen and Gemma. "
            "Free models are rate limited but cost $0 and need no credit card."
        ),
        signup_url="https://openrouter.ai/keys",
        suggested_models=(
            "meta-llama/llama-3.3-70b-instruct:free",
            "qwen/qwen-2.5-72b-instruct:free",
            "google/gemma-3-12b-it:free",
            "deepseek/deepseek-r1-0528:free",
        ),
        key_setting="ai.key.openrouter",
        model_setting="ai.model.openrouter",
        default_model="meta-llama/llama-3.3-70b-instruct:free",
    ),
    "gemini": ProviderMeta(
        id="gemini",
        label="Google Gemini (free tier)",
        kind="cloud",
        description=(
            "Google AI Studio offers a free tier with generous daily limits. "
            "Create an API key in a couple of clicks, no billing required."
        ),
        signup_url="https://aistudio.google.com/app/apikey",
        suggested_models=("gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"),
        key_setting="ai.key.gemini",
        model_setting="ai.model.gemini",
        default_model="gemini-2.5-flash",
    ),
    "groq": ProviderMeta(
        id="groq",
        label="Groq (free developer tier)",
        kind="cloud",
        description=(
            "Very fast hosted inference for open-weight Llama and Qwen models. "
            "The developer tier is free with daily request limits."
        ),
        signup_url="https://console.groq.com/keys",
        suggested_models=(
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "qwen/qwen3-32b",
        ),
        key_setting="ai.key.groq",
        model_setting="ai.model.groq",
        default_model="llama-3.3-70b-versatile",
    ),
    "huggingface": ProviderMeta(
        id="huggingface",
        label="Hugging Face Inference",
        kind="cloud",
        description=(
            "Runs open models hosted by Hugging Face with a small free monthly credit. "
            "Good for trying community models without local hardware."
        ),
        signup_url="https://huggingface.co/settings/tokens",
        suggested_models=(
            "Qwen/Qwen2.5-7B-Instruct",
            "meta-llama/Llama-3.2-3B-Instruct",
        ),
        key_setting="ai.key.huggingface",
        model_setting="ai.model.huggingface",
        default_model="Qwen/Qwen2.5-7B-Instruct",
    ),
    "pollinations": ProviderMeta(
        id="pollinations",
        label="Pollinations (no signup, free)",
        kind="cloud",
        description=(
            "Zero-setup free text generation. No API key or account is required. Anonymous "
            "usage is limited to about one request every 30 seconds; a free pollen key removes "
            "that limit. Filenames only, never file contents."
        ),
        signup_url="https://enter.pollinations.ai",
        suggested_models=("openai", "openai-fast"),
        key_setting=None,
        model_setting="ai.model.pollinations",
        default_model="openai",
    ),
    "ollama": ProviderMeta(
        id="ollama",
        label="Ollama (100% local)",
        kind="local",
        description=(
            "Runs an open-weight model on your own machine. Fully private, but requires "
            "installing Ollama and downloading a model."
        ),
        signup_url="https://ollama.com/download",
        suggested_models=("qwen2.5:7b", "llama3.2:3b", "phi3:mini", "gemma2:2b"),
        key_setting=None,
        model_setting="ai.model.ollama",
        default_model="qwen2.5:7b",
    ),
}


def build_provider(provider_id: str, settings, *, timeout: float | None = None) -> AIProvider:
    """Instantiate a provider from locally stored settings."""
    from ..database.repository import SettingsRepository

    repo: SettingsRepository = settings
    meta = PROVIDER_CATALOG[provider_id]
    model = repo.get(meta.model_setting) or meta.default_model
    timeout = timeout or float(repo.get_int("ai.timeout_seconds", 60))

    if provider_id == "openrouter":
        return OpenAICompatibleProvider(
            "openrouter",
            "OpenRouter",
            "https://openrouter.ai/api/v1",
            repo.get("ai.key.openrouter") or "",
            model,
            timeout=timeout,
            extra_headers={
                "HTTP-Referer": "https://github.com/lazydesk/lazydesk",
                "X-Title": "LazyDesk",
            },
            free_only=True,
        )
    if provider_id == "groq":
        return OpenAICompatibleProvider(
            "groq",
            "Groq",
            "https://api.groq.com/openai/v1",
            repo.get("ai.key.groq") or "",
            model,
            timeout=timeout,
        )
    if provider_id == "huggingface":
        return OpenAICompatibleProvider(
            "huggingface",
            "Hugging Face",
            "https://router.huggingface.co/v1",
            repo.get("ai.key.huggingface") or "",
            model,
            timeout=timeout,
        )
    if provider_id == "gemini":
        return GeminiProvider(
            repo.get("ai.key.gemini") or "",
            model,
            timeout=timeout,
            embedding_model=repo.get("ai.embedding.model") or "gemini-embedding-001",
        )
    if provider_id == "pollinations":
        return OpenAICompatibleProvider(
            "pollinations",
            "Pollinations",
            "https://text.pollinations.ai",
            "anonymous",
            model,
            timeout=max(timeout, 75.0),
            extra_headers={"Referer": "https://github.com/lazydesk/lazydesk"},
            chat_path="/openai/chat/completions",
            models_path="/models",
        )
    if provider_id == "ollama":
        return OllamaProvider(
            repo.get("ai.ollama_url") or "http://127.0.0.1:11434",
            model,
            timeout=timeout,
            embedding_model=repo.get("ai.embedding.model") or "nomic-embed-text",
        )
    raise AIError(f"Unknown provider: {provider_id}")
