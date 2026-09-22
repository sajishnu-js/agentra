"""Provider selection, by name, from settings.

The orchestrator asks for "the provider" and never names one.
"""

from __future__ import annotations

from functools import lru_cache

from app.core.config import settings
from app.llm.base import LLMProvider


@lru_cache(maxsize=None)
def get_provider(name: str | None = None) -> LLMProvider:
    """Build (once per process) the configured provider."""
    chosen = (name or settings.llm_provider).lower()

    if chosen == "gemini":
        from app.llm.gemini import GeminiProvider

        return GeminiProvider()
    if chosen == "echo":
        from app.llm.echo import EchoProvider

        return EchoProvider()

    raise ValueError(
        f"Unknown LLM_PROVIDER {chosen!r}. Supported: 'gemini', 'echo'."
    )
