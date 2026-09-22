"""The LLM abstraction.

The orchestrator calls generate_reply and knows nothing else. Swapping Gemini
for a local model later means writing one class — no orchestrator change.

A provider reports how well it thinks it did; it does not decide what to do
about that. The threshold lives in app/handover/policy.py, so the same policy
applies whichever model is behind this interface.
"""

from __future__ import annotations

import enum
from abc import ABC, abstractmethod
from dataclasses import dataclass


class Confidence(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"


@dataclass
class ContextChunk:
    """One retrieved knowledge base chunk, with enough identity to audit it."""

    chunk_id: str
    kb_document_id: str
    document_title: str
    content: str
    similarity: float


@dataclass
class ExtractedRequest:
    """An actionable request found in a conversation turn.

    Category is a plain string here, not the RequestCategory enum: this is the
    LLM boundary, and a model returning something outside the taxonomy should
    be handled by the caller rather than blowing up at parse time.
    """

    category: str
    title: str
    priority: str
    #: The model's own words on why it classified this way. Logged, not shown
    #: to customers, and useful when tuning the prompt.
    rationale: str | None = None


@dataclass
class LLMReply:
    #: The draft answer. May never be sent, if confidence is too low.
    text: str
    #: How sure the model is that its answer is correct and complete.
    confidence: Confidence
    #: Whether the retrieved context actually covered the question. Separate
    #: from confidence on purpose: a model can sound sure about something the
    #: context never said.
    context_sufficient: bool
    model: str


class LLMProvider(ABC):
    """One implementation per model backend."""

    #: Identifier stored alongside generated messages.
    name: str

    @abstractmethod
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
        """Answer `user_message` using only `context_chunks`.

        `system_prompt`, `model`, `temperature`, `guardrails`,
        `response_behaviour` and `max_output_tokens` come from the routed
        Agent (see orchestrator._resolve_agent); all default to this
        provider's own baseline behaviour when the caller has none — an
        unrouted conversation must answer exactly as it did before agents
        existed, not fail or go silent. `history` is (speaker, text)
        oldest-first, empty unless the agent's context_history_limit is > 0.
        """

    @abstractmethod
    async def extract_request(
        self, history: list[tuple[str, str]], latest_message: str
    ) -> ExtractedRequest | None:
        """Classify a turn into an actionable request, or None.

        A separate call with a separate prompt — this one does not answer the
        customer, and generate_reply does not classify. Returning None is the
        common case: most messages are questions, not work.
        """
