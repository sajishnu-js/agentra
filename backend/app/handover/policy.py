"""Handover matching and thresholds.

Two layers, checked in order:

  1. Hard keyword rules. Cheap, deterministic, and run before any LLM call —
     if one fires, the model is never asked.
  2. The model's own self-assessment. Only consulted when no keyword matched.

The provider reports how confident it was; this module decides whether that is
good enough to send. Keeping that decision here rather than in the provider
means the policy is the same whichever model is behind it.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from app.core.config import settings
from app.domains.conversations.models import HandoverReason
from app.handover.keywords import KEYWORD_CATEGORIES
from app.llm.base import Confidence

# --- Arabic normalisation ---------------------------------------------------
# Customers type Arabic inconsistently: with and without diacritics, with any
# of the alef forms, sometimes with tatweel stretching. Normalising both the
# message and the keyword list means a term in the list matches the same term
# typed by a customer, and neither has to be spelled the way the other was.

# Tashkeel (harakat) and the superscript alef.
_TASHKEEL = re.compile(r"[ً-ْٰـ]")

_ARABIC_FOLDING = str.maketrans(
    {
        "أ": "ا",  # أ -> ا
        "إ": "ا",  # إ -> ا
        "آ": "ا",  # آ -> ا
        "ٱ": "ا",  # ٱ -> ا
        "ى": "ي",  # ى -> ي
        "ة": "ه",  # ة -> ه
    }
)


def normalize(text: str) -> str:
    """Lowercase, strip Arabic diacritics, fold alef/yeh/teh-marbuta variants."""
    folded = unicodedata.normalize("NFKC", text).lower()
    folded = _TASHKEEL.sub("", folded)
    folded = folded.translate(_ARABIC_FOLDING)
    # Collapse whitespace so phrase matching is not defeated by line breaks.
    return re.sub(r"\s+", " ", folded).strip()


_ARABIC_LETTER = re.compile(r"[\u0600-\u06ff]")

# Arabic is inflected, so a whole-word match is too strict: the list holds
# "طارئ" but a customer writes "طارئة". Naive substring matching is far too
# loose in the other direction — a short root can appear inside many unrelated
# words, because ال is the definite article and single letters are common
# initials.
#
# So: allow an optional leading definite article, and a small closed set of
# inflection endings. Both bounded, both anchored to word boundaries. This
# catches ordinary inflection without turning every ال-word into a match.
_AR_PREFIX = r"(?:ال)?"
_AR_SUFFIX = r"(?:ات|ين|ون|ها|نا|ه|ي|ك)?"


def _compile(term: str) -> re.Pattern[str]:
    """Build the matcher for one term.

    A phrase (anything with a space) matches as a substring. A single word
    matches whole-word, with Arabic additionally tolerating the definite
    article and common inflection endings.
    """
    normalized = normalize(term)
    if " " in normalized:
        return re.compile(re.escape(normalized))

    escaped = re.escape(normalized)
    if _ARABIC_LETTER.search(normalized):
        return re.compile(rf"\b{_AR_PREFIX}{escaped}{_AR_SUFFIX}\b")
    # Word boundaries work as-is for Latin script: "pain" will not fire on
    # "painting".
    return re.compile(rf"\b{escaped}\b")


# Compiled once at import. 217 patterns against one short message is trivial,
# but recompiling per message would not be.
_COMPILED: dict[str, list[tuple[str, re.Pattern[str]]]] = {
    category: [(term, _compile(term)) for term in terms]
    for category, terms in KEYWORD_CATEGORIES.items()
}


@dataclass
class KeywordMatch:
    #: Categories that fired, in the order they are declared.
    categories: list[str] = field(default_factory=list)
    #: The specific terms that matched, for the audit trail.
    terms: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return bool(self.categories)

    def describe(self) -> str:
        """A line a staff member can read in the dashboard."""
        parts = [
            f"{category}: "
            + ", ".join(term for term in self.terms if term in KEYWORD_CATEGORIES[category])
            for category in self.categories
        ]
        return "; ".join(parts)


def match_keywords(text: str) -> KeywordMatch:
    """Which hard rules, if any, this message trips."""
    if not text or not text.strip():
        return KeywordMatch()

    haystack = normalize(text)
    result = KeywordMatch()

    for category, patterns in _COMPILED.items():
        hits = [term for term, pattern in patterns if pattern.search(haystack)]
        if hits:
            result.categories.append(category)
            result.terms.extend(hits)
    return result


# --- AI self-assessment ----------------------------------------------------

#: Ordered worst to best, so a threshold can be compared numerically.
_CONFIDENCE_RANK = {Confidence.low: 0, Confidence.medium: 1, Confidence.high: 2}


def confidence_is_sufficient(
    confidence: Confidence, context_sufficient: bool
) -> bool:
    """Whether the model's own assessment clears the configured bar.

    Both signals have to hold. A model can be confident about the wrong thing —
    if it says the context did not cover the question, that is decisive
    regardless of how sure it sounded.
    """
    if not context_sufficient:
        return False

    minimum = Confidence(settings.ai_min_confidence)
    return _CONFIDENCE_RANK[confidence] >= _CONFIDENCE_RANK[minimum]


@dataclass
class HandoverDecision:
    """Whether a person is needed, and why."""

    needed: bool
    reason: HandoverReason | None = None
    detail: str | None = None

    @classmethod
    def none(cls) -> HandoverDecision:
        return cls(needed=False)

    @classmethod
    def from_keywords(cls, match: KeywordMatch) -> HandoverDecision:
        return cls(
            needed=True,
            reason=HandoverReason.keyword,
            detail=match.describe(),
        )

    @classmethod
    def from_confidence(
        cls, confidence: Confidence, context_sufficient: bool
    ) -> HandoverDecision:
        return cls(
            needed=True,
            reason=HandoverReason.ai_uncertain,
            detail=(
                f"confidence={confidence.value}, "
                f"context_sufficient={str(context_sufficient).lower()}, "
                f"threshold={settings.ai_min_confidence}"
            ),
        )

    @classmethod
    def from_llm_error(cls, error: str) -> HandoverDecision:
        return cls(
            needed=True,
            reason=HandoverReason.llm_error,
            detail=error[:500],
        )


# --- Holding replies -------------------------------------------------------
# Sent when a person is needed. Short on purpose: it should set an expectation
# and nothing else. Language comes from the same detector the ingestion
# pipeline uses, so no model call is needed to pick one.

HOLDING_REPLY = {
    "en": "Thanks for reaching out — a team member will follow up with you shortly.",
    "ar": "شكراً لتواصلك معنا — سيتابع أحد أفراد الفريق معك قريباً.",
}


def holding_reply(language: str | None) -> str:
    return HOLDING_REPLY.get(language or "en", HOLDING_REPLY["en"])
