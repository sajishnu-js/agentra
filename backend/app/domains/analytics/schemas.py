from datetime import date
from uuid import UUID

from pydantic import BaseModel


class RequestTotals(BaseModel):
    total: int
    pending: int
    completed: int
    cancelled: int


class VolumePoint(BaseModel):
    """One day, split by status, so the bars can stack."""

    date: date
    pending: int
    completed: int
    cancelled: int

    @property
    def total(self) -> int:
        return self.pending + self.completed + self.cancelled


class HeatmapCell(BaseModel):
    """One bucket of an hour-of-day grid.

    `row` is whichever dimension the grid is grouped by — a request category,
    or a weekday index as a string. Kept as a plain string so one component can
    render either without knowing which it has.
    """

    row: str
    hour: int  # 0-23, business local time
    count: int


class ClosingTime(BaseModel):
    """How long completed requests took to close."""

    #: None when nothing in range has been completed, which is different from
    #: zero and must not be rendered as "0h".
    average_hours: float | None
    median_hours: float | None
    fastest_hours: float | None
    slowest_hours: float | None
    #: How many completed requests this was measured from. Surfaced because a
    #: mean over three rows deserves less trust than one over three hundred.
    measured: int
    #: Completed requests in range with no completed_at — closed before the
    #: column existed, so unmeasurable.
    unmeasured: int


class ResolutionSplit(BaseModel):
    """Conversations the AI handled alone versus ones a person touched.

    The signal is conversations.assigned_agent_id: auto-assignment fires on
    handover, so an assignee means a person was pulled in.
    """

    ai_only: int
    human_involved: int
    total: int


class DateRange(BaseModel):
    start: date
    end: date
    days: int


class RequestAnalytics(BaseModel):
    range: DateRange
    timezone: str
    #: None for the "Overall" view; the specific agent's id when the Home
    #: page's visualisation filter is scoped to one of the 5 agents.
    agent_id: UUID | None = None
    totals: RequestTotals
    volume: list[VolumePoint]
    heatmap_by_category: list[HeatmapCell]
    heatmap_by_weekday: list[HeatmapCell]
    closing_time: ClosingTime
    resolution: ResolutionSplit


class AgentSummaryStat(BaseModel):
    """One agent's activity for the "Overall" view's per-agent comparison —
    everything computed from real conversations/messages/requests, nothing
    simulated."""

    agent_id: UUID
    agent_name: str
    icon: str
    conversations: int
    messages_in: int
    messages_out: int
    requests_total: int
    requests_pending: int
    requests_completed: int
    #: Share (0-1) of this agent's outgoing messages that cited at least one
    #: knowledge base chunk — a real grounding-rate signal, not a vanity metric.
    kb_citation_rate: float


class NavCounts(BaseModel):
    """Badge counts for the sidebar, plus whatever the Topbar's notification
    bell needs — folded in here rather than a separate call so a non-admin
    role (which can't read /settings/workspace) still learns whether new-
    request alerts are on."""

    pending_requests: int
    open_conversations: int
    notify_new_request: bool
