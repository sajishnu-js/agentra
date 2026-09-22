"""AI agent configuration.

Note the overloaded word: a `users` row with role `agent` is a human. This
table is the AI agents that answer on their own.
"""

import enum
from uuid import UUID

from sqlalchemy import Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import ARRAY, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.config import settings
from app.core.database import Base, CreatedAtMixin, UUIDMixin


class AgentStatus(str, enum.Enum):
    active = "active"
    paused = "paused"
    draft = "draft"


class Agent(Base, UUIDMixin, CreatedAtMixin):
    __tablename__ = "agents"
    __table_args__ = (
        # Each knowledge base belongs to exactly one agent — enforced here,
        # not just by convention, so a future PATCH can't accidentally point
        # two agents at the same KB. NULL is exempt (Postgres allows any
        # number of NULLs under a unique constraint), which matches
        # knowledge_base_id's own nullability below.
        UniqueConstraint("knowledge_base_id", name="uq_agents_knowledge_base_id"),
    )

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[AgentStatus] = mapped_column(
        Enum(AgentStatus, name="agent_status", native_enum=False, create_constraint=True),
        default=AgentStatus.draft,
        nullable=False,
    )
    # Defaults to the configured Gemini model rather than a hardcoded name:
    # this is the only LLM backend this app talks to (see app/llm/registry.py),
    # and a stale hardcoded model name would silently 404 every generation
    # call once an agent's model actually reaches the API (see orchestrator.py).
    model: Mapped[str] = mapped_column(
        String(120), default=lambda: settings.gemini_model, nullable=False
    )
    system_prompt: Mapped[str] = mapped_column(Text, default="", nullable=False)
    temperature: Mapped[float] = mapped_column(Float, default=0.2, nullable=False)

    # Nullable: not every agent needs a knowledge base scoped to it, and
    # existing agents predate this column.
    knowledge_base_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("knowledge_bases.id"),
        nullable=True,
        index=True,
    )

    # Which fixed lookup key (frontend/src/lib/agentIcons.ts) renders this
    # agent's card icon — same pattern as KnowledgeBase.icon.
    icon: Mapped[str] = mapped_column(String(40), default="Bot", nullable=False)

    # Safety rules, kept separate from system_prompt (the persona) rather
    # than folded into it — see llm/gemini.py for why: this is composed in
    # as its own block, after PERSONA, so a guardrail reads as a rule rather
    # than getting lost in tone-setting prose.
    guardrails: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Capability tags shown in the UI and folded into the composed prompt so
    # the model knows what it's expected to handle (e.g. "this agent reads
    # photos"). Deliberately NOT a live tool-calling/function-execution list —
    # this app has no such framework (see llm/gemini.py's
    # automatic_function_calling=disable) and building one is a separate,
    # much larger project than agent configuration.
    tools_enabled: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=sa_text("'{}'::text[]")
    )

    # Tone/format/length guidance — composed in after GUARDRAILS, before the
    # fixed self-assessment instruction. Separate from system_prompt so
    # "who this agent is" and "how it should sound" can be edited
    # independently.
    response_behaviour: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Overrides the global bilingual holding_reply() (handover/policy.py) on
    # this agent's handover path when set. NULL means "use the app default",
    # not "send nothing" — see orchestrator.py.
    fallback_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # How many prior messages to include as conversation history when
    # generating a reply (see orchestrator._recent_history). 0 preserves the
    # original behaviour: no history, each message answered in isolation.
    context_history_limit: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )

    # Per-agent ceiling on the Gemini call's max_output_tokens, replacing the
    # single hardcoded 2048 every agent used to share.
    max_output_tokens: Mapped[int] = mapped_column(
        Integer, default=2048, nullable=False
    )

    # Which staff member administratively owns this agent (Settings → Agent
    # Assignment). Independent of Conversation.assigned_agent_id, which is a
    # human claiming one thread — this is "who's responsible for this AI
    # agent's configuration." SET NULL: losing the owner unassigns, it does
    # not block deleting the user.
    owner_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
