from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.core.config import settings
from app.domains.agents.models import AgentStatus


class AgentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None = None
    status: AgentStatus
    model: str
    system_prompt: str
    temperature: float
    knowledge_base_id: UUID | None = None
    icon: str
    guardrails: str
    tools_enabled: list[str]
    response_behaviour: str
    fallback_message: str | None = None
    context_history_limit: int
    max_output_tokens: int
    owner_user_id: UUID | None = None
    created_at: datetime


# Bounds shared by AgentCreate and AgentUpdate. These are not cosmetic:
# `name` mirrors the String(120) column, and without it an over-long name
# reaches Postgres and surfaces as a 500 instead of a 422. `temperature` and
# `max_output_tokens` are passed straight to the Gemini call, so an
# out-of-range value is accepted here but fails on every single generation
# afterwards — the agent looks saved and is quietly broken. Same style of
# constraint the settings domain already uses (settings/schemas.py).
#
# Kept as kwarg dicts rather than shared Field() objects because the two
# schemas need different defaults: required on create, `None` (meaning
# "unchanged") on the partial update.
_NAME_BOUNDS = {"min_length": 1, "max_length": 120}
_MODEL_BOUNDS = {"min_length": 1, "max_length": 120}
_ICON_BOUNDS = {"min_length": 1, "max_length": 40}
_TEMPERATURE_BOUNDS = {"ge": 0, "le": 2}
_CONTEXT_LIMIT_BOUNDS = {"ge": 0, "le": 50}
# Floor of 256, not 64: every reply is a structured JSON object (reply +
# confidence + context_sufficient, see _GeminiAnswer), so the envelope alone
# costs tokens before a single word of the answer. Below ~256 the model hits
# MAX_TOKENS and returns nothing usable — which is a guaranteed failure, not
# a tight budget. Arabic makes this sharper: it tokenizes far less densely
# than English, so a limit that just about works in English silently breaks
# every Arabic reply for these deliberately bilingual agents.
_MAX_TOKENS_BOUNDS = {"ge": 256, "le": 8192}


class AgentCreate(BaseModel):
    name: str = Field(**_NAME_BOUNDS)
    description: str | None = None
    status: AgentStatus = AgentStatus.draft
    # Matches the Agent model column's own default (agents/models.py) — this
    # is the only LLM backend the app talks to (app/llm/registry.py), so a
    # stale hardcoded model name here would silently 404 every generation
    # call the moment an agent created through this endpoint actually answers.
    model: str = Field(default_factory=lambda: settings.gemini_model, **_MODEL_BOUNDS)
    system_prompt: str = ""
    temperature: float = Field(default=0.2, **_TEMPERATURE_BOUNDS)
    # Required, not optional: every agent gets exactly one dedicated
    # knowledge base, chosen at creation time — see agents/router.py for the
    # existence + uniqueness checks backing the DB-level constraint.
    knowledge_base_id: UUID
    icon: str = Field(default="Bot", **_ICON_BOUNDS)
    guardrails: str = ""
    tools_enabled: list[str] = Field(default_factory=list)
    response_behaviour: str = ""
    fallback_message: str | None = None
    context_history_limit: int = Field(default=0, **_CONTEXT_LIMIT_BOUNDS)
    max_output_tokens: int = Field(default=2048, **_MAX_TOKENS_BOUNDS)
    owner_user_id: UUID | None = None


class AgentUpdate(BaseModel):
    """Partial update — every field optional, only what is set gets applied."""

    name: str | None = Field(default=None, **_NAME_BOUNDS)
    description: str | None = None
    status: AgentStatus | None = None
    model: str | None = Field(default=None, **_MODEL_BOUNDS)
    system_prompt: str | None = None
    temperature: float | None = Field(default=None, **_TEMPERATURE_BOUNDS)
    knowledge_base_id: UUID | None = None
    icon: str | None = Field(default=None, **_ICON_BOUNDS)
    guardrails: str | None = None
    tools_enabled: list[str] | None = None
    response_behaviour: str | None = None
    fallback_message: str | None = None
    context_history_limit: int | None = Field(default=None, **_CONTEXT_LIMIT_BOUNDS)
    max_output_tokens: int | None = Field(default=None, **_MAX_TOKENS_BOUNDS)
    owner_user_id: UUID | None = None


class AgentTestConfig(BaseModel):
    """The draft configuration under test — mirrors the fields that actually
    reach generate_reply, not the full Agent row (name/description/status/
    icon don't affect a reply, so the test endpoint doesn't need them)."""

    system_prompt: str = ""
    guardrails: str = ""
    response_behaviour: str = ""
    # Same bounds as the persisted agent — this config reaches generate_reply
    # directly, so an out-of-range value fails the provider call rather than
    # returning a useful test result.
    temperature: float = Field(default=0.2, **_TEMPERATURE_BOUNDS)
    model: str = Field(default_factory=lambda: settings.gemini_model, **_MODEL_BOUNDS)
    knowledge_base_id: UUID | None = None
    context_history_limit: int = Field(default=0, **_CONTEXT_LIMIT_BOUNDS)
    max_output_tokens: int = Field(default=2048, **_MAX_TOKENS_BOUNDS)


class AgentTestTurn(BaseModel):
    """One prior turn in this test session — held in the frontend only,
    never persisted, since a test run writes nothing to the database."""

    role: str  # "customer" | "business" — matches orchestrator.py's own convention
    text: str


class AgentTestRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4096)
    history: list[AgentTestTurn] = Field(default_factory=list)
    config: AgentTestConfig


class AgentTestResponse(BaseModel):
    reply: str
    confidence: str
    context_sufficient: bool
    model: str
    sources: list[dict] | None = None
