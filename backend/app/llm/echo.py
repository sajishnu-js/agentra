"""A provider that calls nothing.

Exists so the pipeline can be exercised end to end — keyword rules, queue,
worker, retrieval, database writes, channel send — without an API key and
without spending tokens. Set LLM_PROVIDER=echo.

It is also the smallest possible proof that LLMProvider is a real seam: this
and GeminiProvider are interchangeable, and the orchestrator cannot tell which
one it has.
"""

from __future__ import annotations

from app.llm.base import (
    Confidence,
    ContextChunk,
    ExtractedRequest,
    LLMProvider,
    LLMReply,
)

# Mirrors roughly where bge-m3 lands on this corpus, so the echo provider
# exercises both the confident and the uncertain branch depending on the
# question rather than always taking one.
_HIGH_CONFIDENCE_SIMILARITY = 0.48


class EchoProvider(LLMProvider):
    name = "echo"

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
        # Ignored: this provider calls no model, so there is nothing for an
        # agent's persona, model choice, temperature, history, guardrails,
        # response behaviour or token ceiling to influence.
        if not context_chunks:
            return LLMReply(
                text="[echo] No knowledge base context matched.",
                confidence=Confidence.low,
                context_sufficient=False,
                model="echo",
            )

        top = context_chunks[0]
        strong = top.similarity >= _HIGH_CONFIDENCE_SIMILARITY
        return LLMReply(
            text=(
                f"[echo] You asked: {user_message!r}. Closest match was "
                f"{top.document_title!r} at similarity {top.similarity:.3f} "
                f"({len(context_chunks)} chunks retrieved)."
            ),
            confidence=Confidence.high if strong else Confidence.low,
            context_sufficient=strong,
            model="echo",
        )

    async def extract_request(
        self, history: list[tuple[str, str]], latest_message: str
    ) -> ExtractedRequest | None:
        """A crude keyword stand-in for the classification call.

        Enough to exercise the storage, dedupe and UI paths without an API key.
        Deliberately dumber than the real thing — it is not trying to be a
        classifier, only to produce one of each outcome predictably.
        """
        lowered = latest_message.lower()

        # Most specific first: "cancel my order" must not fall into the
        # generic order rule just because it contains the word.
        rules = [
            (("cancel",), "cancellation"),
            (("reschedule", "move my", "change my order"), "reschedule"),
            (("call me", "callback", "call back", "phone me"), "callback"),
            (("refund", "complaint", "unhappy"), "complaint"),
            (("human", "person", "real agent", "staff member"), "human_request"),
            (("book", "order", "availability"), "order"),
        ]
        for needles, category in rules:
            if any(needle in lowered for needle in needles):
                return ExtractedRequest(
                    category=category,
                    title=f"[echo] {category.replace('_', ' ')}: {latest_message[:50]}",
                    priority="normal",
                    rationale="echo provider keyword stand-in",
                )
        return None
