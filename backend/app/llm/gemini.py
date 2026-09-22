"""Gemini, via the google-genai SDK.

A note on the SDK: the brief asked for `google-generativeai`, but that package
is now marked "Development Status :: 7 - Inactive" and its own README is titled
"[Deprecated]" — Google replaced it with the unified `google-genai` SDK for
Gemini 2.x and up. Building on the retired one would mean a rewrite later, so
this uses the supported SDK. Nothing outside this file knows the difference,
which is the point of LLMProvider.
"""

from __future__ import annotations

import logging

from pydantic import BaseModel

from app.core.config import settings
from app.llm.base import (
    Confidence,
    ContextChunk,
    ExtractedRequest,
    LLMProvider,
    LLMReply,
)
from app.llm.prompts.extraction import (
    EXTRACTION_INSTRUCTION,
    build_extraction_prompt,
)
from app.llm.prompts.reply import (
    SELF_ASSESSMENT_INSTRUCTION,
    SYSTEM_INSTRUCTION,
    build_context_block,
    build_history_block,
)

log = logging.getLogger(__name__)


class _GeminiAnswer(BaseModel):
    """The shape Gemini is constrained to return.

    Passed as a response schema rather than parsed out of prose, so a
    malformed self-assessment is not something that can happen.
    """

    reply: str
    context_sufficient: bool
    confidence: Confidence


class _GeminiExtraction(BaseModel):
    """Schema for the classification call.

    Separate from _GeminiAnswer above: different call, different job, different
    shape. Sharing one schema would force one prompt to do both.
    """

    is_actionable: bool
    category: str | None = None
    title: str | None = None
    priority: str | None = None
    rationale: str | None = None


class GeminiNotConfigured(RuntimeError):
    pass


class GeminiProvider(LLMProvider):
    name = "gemini"

    def __init__(self, api_key: str | None = None, model: str | None = None) -> None:
        key = api_key or settings.gemini_api_key
        if not key:
            raise GeminiNotConfigured(
                "GEMINI_API_KEY is not set. Put it in backend/.env."
            )
        self._model = model or settings.gemini_model

        from google import genai

        self._client = genai.Client(api_key=key)

    async def generate_reply(
        self,
        context_chunks: list[ContextChunk],
        user_message: str,
        *,
        system_prompt: str | None = None,
        model: str | None = None,
        temperature: float = 0.2,
        history: list[tuple[str, str]] | None = None,
        guardrails: str | None = None,
        response_behaviour: str | None = None,
        max_output_tokens: int = 2048,
    ) -> LLMReply:
        from google.genai import types

        context_block = build_context_block(
            [(chunk.document_title, chunk.content) for chunk in context_chunks]
        )

        # History goes before the KB context, same reasoning as the context
        # block itself: it changes on every message, so it lives in the user
        # turn, not the (stable, reviewable) system instruction. Omitted
        # entirely rather than an empty header when there is none, so an
        # agent with context_history_limit=0 sends a byte-for-byte identical
        # prompt to before this existed.
        history_block = f"{build_history_block(history)}\n\n" if history else ""
        prompt = f"{history_block}{context_block}\n\nCUSTOMER MESSAGE\n{user_message}"

        # An agent's system_prompt/guardrails/response_behaviour are layered
        # on top of the fixed rules, never a replacement for them: GROUNDING
        # and SAFETY above are what stop a reply from inventing a price or
        # claiming to have taken an action, and no per-agent config should be
        # able to switch that off. SELF_ASSESSMENT_INSTRUCTION stays last
        # regardless, since the response_schema below depends on the model
        # actually following it.
        instruction = SYSTEM_INSTRUCTION
        if system_prompt:
            instruction = f"{instruction}\n\nPERSONA\n{system_prompt}"
        if guardrails:
            instruction = f"{instruction}\n\nGUARDRAILS\n{guardrails}"
        if response_behaviour:
            instruction = f"{instruction}\n\nRESPONSE STYLE\n{response_behaviour}"
        instruction = f"{instruction}\n\n{SELF_ASSESSMENT_INSTRUCTION}"

        response = await self._client.aio.models.generate_content(
            model=model or self._model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=instruction,
                # Low but not zero by default: the wording should vary a
                # little between customers, the facts should not. An agent
                # may tune this; see the docstring on the base class.
                temperature=temperature,
                # Generous by default (2048). Gemini 3.x spends "thinking"
                # tokens out of this same budget — measured at 170-200 for a
                # two-sentence reply — so a low ceiling truncated Arabic
                # answers mid-word. No thinking_config is set:
                # thinking_budget=0 is rejected outright by 3.x, and
                # thinking_level is a 3.x-only field that would break if
                # gemini_model were pointed at a 2.5 model. A high ceiling is
                # the portable fix; the prompt is what keeps replies short.
                # An agent may still lower this via max_output_tokens.
                max_output_tokens=max_output_tokens,
                # Schema-constrained output. The self-assessment cannot come
                # back malformed, and no sentinel token can leak into the text
                # the customer sees.
                response_mime_type="application/json",
                response_schema=_GeminiAnswer,
                # No tools are passed, so automatic function calling has
                # nothing to do. Disabling it removes a warning the SDK emits
                # on every generate_content call.
                automatic_function_calling=types.AutomaticFunctionCallingConfig(
                    disable=True
                ),
            ),
        )

        answer = response.parsed
        if answer is None or not (answer.reply or "").strip():
            # An empty completion is not something to pass on silently — a
            # safety block or a token limit both land here. Raising lets the
            # orchestrator take the llm_error handover path.
            finish = (
                getattr(response.candidates[0], "finish_reason", "unknown")
                if response.candidates
                else "no candidates"
            )
            log.warning("gemini returned no usable answer (finish reason: %s)", finish)
            raise RuntimeError(f"Gemini returned no usable answer ({finish})")

        return LLMReply(
            text=answer.reply.strip(),
            confidence=answer.confidence,
            context_sufficient=answer.context_sufficient,
            model=model or self._model,
        )

    async def extract_request(
        self, history: list[tuple[str, str]], latest_message: str
    ) -> ExtractedRequest | None:
        """Second, independent call: classification only, no reply generated."""
        from google.genai import types

        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=build_extraction_prompt(history, latest_message),
            config=types.GenerateContentConfig(
                system_instruction=EXTRACTION_INSTRUCTION,
                # Lower than the reply call. Classification should be as close
                # to deterministic as the model allows — the same message ought
                # to land in the same category twice.
                temperature=0.0,
                max_output_tokens=1024,
                response_mime_type="application/json",
                response_schema=_GeminiExtraction,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(
                    disable=True
                ),
            ),
        )

        parsed = response.parsed
        if parsed is None:
            log.warning("extraction returned no parseable result")
            return None

        if not parsed.is_actionable:
            return None

        if not (parsed.title or "").strip():
            # Actionable but unnamed is not useful in a queue, and a blank
            # title would violate the NOT NULL on requests.title.
            log.warning("extraction marked actionable with no title; discarding")
            return None

        return ExtractedRequest(
            category=(parsed.category or "other").strip(),
            title=parsed.title.strip(),
            priority=(parsed.priority or "normal").strip(),
            rationale=(parsed.rationale or None),
        )
