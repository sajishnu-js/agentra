"""No-code automation: a graph of trigger/condition/action nodes, stored as
JSON and walked by app.domains.workflows.engine.

The graph shape (nodes/edges, positions, per-node config) is intentionally
untyped at the database layer — it is exactly what the frontend's
@xyflow/react canvas produces, validated at the API boundary (see
schemas.WorkflowGraph) rather than modelled as relational rows. A workflow
edited every few seconds while someone drags nodes around is a document, not
a set of entities with their own lifecycle.
"""

import enum
from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, CreatedAtMixin, UUIDMixin

if TYPE_CHECKING:
    pass


class WorkflowStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    paused = "paused"


class WorkflowExecutionStatus(str, enum.Enum):
    running = "running"
    #: Paused at a `delay` node — see engine.py's `advance`. Resumed by the
    #: scheduler loop once `resume_at` has passed.
    waiting_delay = "waiting_delay"
    #: Paused at an `approval` node, waiting on a Requests Hub ticket. Resumed
    #: by the request_status_changed trigger hook (requests/router.py).
    waiting_approval = "waiting_approval"
    success = "success"
    failed = "failed"


class StepStatus(str, enum.Enum):
    success = "success"
    failed = "failed"
    skipped = "skipped"


class Workflow(Base, UUIDMixin, CreatedAtMixin):
    __tablename__ = "workflows"

    name: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[WorkflowStatus] = mapped_column(
        Enum(WorkflowStatus, name="workflow_status", native_enum=False, create_constraint=True),
        default=WorkflowStatus.draft,
        nullable=False,
        index=True,
    )

    # {"nodes": [...], "edges": [...]} — see schemas.WorkflowGraph for the
    # shape actually enforced at the API boundary.
    graph: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # The agent this workflow is scoped to, for the Agent <-> Workflow
    # integration (a "Workflow" button on an agent opens straight into its
    # own workflows; conditions/actions can also target agents generically
    # via node config regardless of this field). Nullable: a workflow can
    # also be workspace-wide, tied to no single agent.
    agent_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("agents.id", ondelete="SET NULL"), index=True
    )

    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    # Simple recurring schedule for a `schedule` trigger node — one workflow,
    # one interval, rather than per-node cron expressions: this app has no
    # cron-parsing dependency, and "every N minutes" covers everything a
    # no-code automation builder actually needs (see engine.py's scheduler
    # tick for how this is consumed and advanced).
    schedule_interval_minutes: Mapped[int | None] = mapped_column(Integer)
    schedule_next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # A per-workflow shared secret for the `webhook` trigger's inbound URL
    # (/api/v1/workflows/{id}/trigger/{token}) — generated once on creation,
    # rotatable from the builder. Not a signature scheme like the channel
    # webhooks in app/webhooks/router.py: this is a caller-supplied
    # automation endpoint, not a platform with its own signing convention, so
    # "the URL itself is the secret" is the right amount of security for it.
    webhook_token: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)

    versions: Mapped[list["WorkflowVersion"]] = relationship(
        back_populates="workflow", cascade="all, delete-orphan", lazy="raise"
    )
    executions: Mapped[list["WorkflowExecution"]] = relationship(
        back_populates="workflow", cascade="all, delete-orphan", lazy="raise"
    )


class WorkflowVersion(Base, UUIDMixin, CreatedAtMixin):
    """An immutable snapshot of a workflow's graph, taken on every explicit
    Save — the "versioning" half of the builder. Restoring an old version is
    just copying its graph back onto Workflow.graph and saving a fresh
    snapshot on top, so history only ever grows forward."""

    __tablename__ = "workflow_versions"

    workflow_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    graph: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    workflow: Mapped[Workflow] = relationship(back_populates="versions", lazy="raise")


class WorkflowExecution(Base, UUIDMixin, CreatedAtMixin):
    """One run of a workflow, from a single trigger firing to success,
    failure, or a durable pause. See engine.py for how a run advances node by
    node and how a paused one resumes."""

    __tablename__ = "workflow_executions"

    workflow_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[WorkflowExecutionStatus] = mapped_column(
        Enum(
            WorkflowExecutionStatus,
            name="workflow_execution_status",
            native_enum=False,
            create_constraint=True,
        ),
        default=WorkflowExecutionStatus.running,
        nullable=False,
        index=True,
    )
    trigger_type: Mapped[str] = mapped_column(String(60), nullable=False)
    # The event context the trigger fired with (conversation/contact/message/
    # request fields — see engine.build_context) — replayed into every
    # condition and action this run evaluates, including after a resume.
    trigger_context: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # Which trigger node this run started from, and which node runs next —
    # the latter is what makes pausing and resuming possible: a resume is
    # just calling advance() again starting from this id.
    trigger_node_id: Mapped[str] = mapped_column(String(60), nullable=False)
    current_node_id: Mapped[str | None] = mapped_column(String(60))

    # Only meaningful while status is waiting_delay / waiting_approval.
    resume_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    pending_approval_request_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("requests.id", ondelete="SET NULL")
    )
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    conversation_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("conversations.id", ondelete="SET NULL"), index=True
    )
    error: Mapped[str | None] = mapped_column(Text)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    workflow: Mapped[Workflow] = relationship(back_populates="executions", lazy="raise")
    steps: Mapped[list["WorkflowExecutionStep"]] = relationship(
        back_populates="execution",
        cascade="all, delete-orphan",
        order_by="WorkflowExecutionStep.started_at",
        lazy="raise",
    )


class WorkflowExecutionStep(Base, UUIDMixin):
    """One node's turn within a run — the "execution history, logs" the
    builder shows per-run. No CreatedAtMixin: started_at is the meaningful
    timestamp here, not row-creation time, and the two would otherwise be
    redundant on every row."""

    __tablename__ = "workflow_execution_steps"

    execution_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("workflow_executions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    node_id: Mapped[str] = mapped_column(String(60), nullable=False)
    node_type: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[StepStatus] = mapped_column(
        Enum(StepStatus, name="workflow_step_status", native_enum=False, create_constraint=True),
        nullable=False,
    )
    detail: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=sa_text("now()"), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    execution: Mapped[WorkflowExecution] = relationship(back_populates="steps", lazy="raise")
