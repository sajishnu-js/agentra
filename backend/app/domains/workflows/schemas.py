from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.domains.workflows.catalog import ACTIONS, FLOW_NODES, TRIGGERS
from app.domains.workflows.models import (
    StepStatus,
    WorkflowExecutionStatus,
    WorkflowStatus,
)

NodeKind = Literal["trigger", "condition", "action", "delay", "approval"]


class NodePosition(BaseModel):
    """Canvas coordinates, straight from @xyflow/react. Stored and returned
    untouched — the engine never reads them."""

    x: float
    y: float


class WorkflowNode(BaseModel):
    id: str = Field(min_length=1, max_length=60)
    kind: NodeKind
    #: The catalog key within the kind — e.g. kind="action", type="add_tag".
    #: Empty for condition nodes, whose behaviour comes entirely from `config`.
    type: str = Field(default="", max_length=60)
    position: NodePosition
    config: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _type_is_known(self) -> "WorkflowNode":
        """A node type the engine has no branch for would fail silently at run
        time — rejected here instead, where the builder can show it."""
        if self.kind == "trigger" and self.type not in TRIGGERS:
            raise ValueError(f"Unknown trigger type {self.type!r}")
        if self.kind == "action" and self.type not in ACTIONS:
            raise ValueError(f"Unknown action type {self.type!r}")
        if self.kind in ("delay", "approval") and self.kind not in FLOW_NODES:
            raise ValueError(f"Unknown flow node {self.kind!r}")
        return self


class WorkflowEdge(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    source: str = Field(min_length=1, max_length=60)
    target: str = Field(min_length=1, max_length=60)
    #: Which output of the source node this leaves from. "true"/"false" for a
    #: condition, None for everything else (which has exactly one output).
    branch: Literal["true", "false"] | None = None


class WorkflowGraph(BaseModel):
    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)

    @model_validator(mode="after")
    def _edges_reference_real_nodes(self) -> "WorkflowGraph":
        ids = {node.id for node in self.nodes}
        if len(ids) != len(self.nodes):
            raise ValueError("Node ids must be unique")
        for edge in self.edges:
            if edge.source not in ids or edge.target not in ids:
                raise ValueError(f"Edge {edge.id} points at a node that doesn't exist")
        return self


class WorkflowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    description: str | None = None
    agent_id: UUID | None = None
    graph: WorkflowGraph = Field(default_factory=WorkflowGraph)


class WorkflowUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    description: str | None = None
    status: WorkflowStatus | None = None
    agent_id: UUID | None = None
    graph: WorkflowGraph | None = None


class WorkflowAgentSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str


class WorkflowRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None
    status: WorkflowStatus
    graph: dict
    agent_id: UUID | None
    agent: WorkflowAgentSummary | None = None
    schedule_interval_minutes: int | None
    schedule_next_run_at: datetime | None
    webhook_token: str | None
    created_at: datetime
    version_count: int = 0
    execution_count: int = 0
    last_execution_at: datetime | None = None


class WorkflowVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    version_number: int
    graph: dict
    created_at: datetime


class WorkflowStepRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    node_id: str
    node_type: str
    status: StepStatus
    detail: str | None
    started_at: datetime
    finished_at: datetime | None


class WorkflowExecutionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workflow_id: UUID
    status: WorkflowExecutionStatus
    trigger_type: str
    trigger_context: dict
    conversation_id: UUID | None
    resume_at: datetime | None
    retry_count: int
    error: str | None
    created_at: datetime
    finished_at: datetime | None
    steps: list[WorkflowStepRead] = Field(default_factory=list)


class ValidationIssue(BaseModel):
    #: "error" blocks activation; "warning" is advisory only.
    level: Literal["error", "warning"]
    message: str
    node_id: str | None = None


class ValidationResult(BaseModel):
    valid: bool
    issues: list[ValidationIssue]


class WorkflowTestRequest(BaseModel):
    """A manual run against a real conversation, or against none at all.

    `conversation_id` is what makes a test meaningful: actions like
    send_message and add_tag need a thread to act on. Without one the run
    still executes, and those actions record a skipped step explaining why —
    which is itself useful feedback while building.
    """

    conversation_id: UUID | None = None
    #: Optional stand-in for a `webhook` trigger's payload, so a
    #: webhook-triggered workflow can be tested without an external caller.
    payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("payload")
    @classmethod
    def _payload_is_small(cls, value: dict) -> dict:
        if len(str(value)) > 20_000:
            raise ValueError("Test payload is too large")
        return value
