"""Read-only aggregates for the Home dashboard.

Cross-domain by nature: it reads the requests and conversations tables rather
than owning any.

Everything is computed in Postgres and returned as totals. Not a style
preference — the alternative is shipping every request row to the browser and
counting them there, which works at 90 rows and falls over at 90,000. The
response size here is fixed by the shape of the dashboard, not by how much
traffic the business has had.
"""

from datetime import UTC, date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Date, Integer, Numeric, Select, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.domains.agents.models import Agent
from app.domains.analytics.schemas import (
    AgentSummaryStat,
    ClosingTime,
    DateRange,
    HeatmapCell,
    NavCounts,
    RequestAnalytics,
    RequestTotals,
    ResolutionSplit,
    VolumePoint,
)
from app.domains.conversations.models import Conversation, ConversationStatus, Message, MessageDirection
from app.domains.requests.models import Request, RequestStatus
from app.domains.settings.models import get_or_create_workspace_settings

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _local(column):
    """A timestamptz column read in the configured business local time."""
    return func.timezone(settings.business_timezone, column)


def _count_if(condition):
    """COUNT over rows matching a condition, for one-pass status splits.

    Three of these in a single SELECT beats three round trips, and beats a
    GROUP BY that has to be re-densified in Python.
    """
    return func.count(case((condition, 1)))


def _scoped_to_agent(query: Select, agent_id: UUID | None) -> Select:
    """Joins from Request to its parent Conversation and filters to one
    agent — only when a specific agent is selected. The "Overall" view
    (agent_id is None) never pays for the join at all."""
    if agent_id is None:
        return query
    return query.join(Conversation, Conversation.id == Request.conversation_id).where(
        Conversation.agent_id == agent_id
    )


@router.get("/requests", response_model=RequestAnalytics)
async def request_analytics(
    days: int = Query(default=14, ge=1, le=365, description="Window ending today"),
    start: date | None = Query(
        default=None, description="Custom range start (business-local date), inclusive."
    ),
    end: date | None = Query(
        default=None, description="Custom range end (business-local date), inclusive."
    ),
    agent_id: UUID | None = Query(
        default=None, description="Scope every figure to one agent's conversations, not all of them."
    ),
    db: AsyncSession = Depends(get_db),
) -> RequestAnalytics:
    """Everything the Home dashboard shows, for the selected window.

    One endpoint rather than six: the dashboard always wants all of it, and six
    requests would mean six round trips and six chances to render a half-loaded
    screen. `agent_id` is what powers the Home page's "Overall / Agent 1..5"
    filter — every figure below is scoped to that one agent's conversations
    when it's set, and to the whole workspace when it isn't.

    `start`/`end` are the dashboard's custom-range picker — an explicit pair
    of business-local dates rather than a rolling window. Either both are
    given or neither is: a lone `start` or `end` has no sensible fallback for
    its missing partner, so that case is rejected rather than guessed at.
    `days` stays the default path for the preset buttons (7/14/30/90), which
    have no use for a specific end date and would otherwise recompute one
    every render just to satisfy this endpoint.
    """
    local_created = _local(Request.created_at)
    local_day = cast(local_created, Date)

    if (start is None) != (end is None):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Provide both start and end, or neither."
        )

    if start is not None and end is not None:
        if end < start:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "end must not be before start")
        # Same 365-day ceiling as the `days` param above — bounds the
        # zero-filled volume series and the two heatmap queries alike.
        if (end - start).days + 1 > 365:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Range cannot exceed 365 days")
        window_start = start
        window_end = end
    else:
        # The window is inclusive of both ends and expressed in
        # business-local dates, so "last 7 days" means seven labelled bars
        # and not six-and-a-bit.
        #
        # "Today" is the business's today, not the server's. date.today()
        # would read the host clock: in a timezone ahead of UTC a UTC server
        # can still think it is yesterday, and the whole window would slide
        # by a day every night.
        window_end = (
            datetime.now(UTC).astimezone(ZoneInfo(settings.business_timezone)).date()
        )
        window_start = window_end - timedelta(days=days - 1)

    days = (window_end - window_start).days + 1
    in_range = local_day.between(window_start, window_end)

    # --- stat cards -------------------------------------------------------
    totals_row = (
        await db.execute(
            _scoped_to_agent(
                select(
                    func.count(Request.id),
                    _count_if(Request.status == RequestStatus.pending),
                    _count_if(Request.status == RequestStatus.completed),
                    _count_if(Request.status == RequestStatus.cancelled),
                ),
                agent_id,
            ).where(in_range)
        )
    ).one()
    totals = RequestTotals(
        total=totals_row[0],
        pending=totals_row[1],
        completed=totals_row[2],
        cancelled=totals_row[3],
    )

    # --- daily volume, split by status ------------------------------------
    volume_rows = await db.execute(
        _scoped_to_agent(
            select(
                local_day.label("day"),
                _count_if(Request.status == RequestStatus.pending),
                _count_if(Request.status == RequestStatus.completed),
                _count_if(Request.status == RequestStatus.cancelled),
            ),
            agent_id,
        )
        .where(in_range)
        .group_by(local_day)
        .order_by(local_day)
    )
    by_day = {row[0]: row for row in volume_rows.all()}

    # Zero-filled: a bar chart that silently drops quiet days reads as "busy
    # every day", and the gap is exactly what a business wants to see.
    volume = []
    for offset in range(days):
        day = window_start + timedelta(days=offset)
        row = by_day.get(day)
        volume.append(
            VolumePoint(
                date=day,
                pending=row[1] if row else 0,
                completed=row[2] if row else 0,
                cancelled=row[3] if row else 0,
            )
        )

    # --- heatmaps ---------------------------------------------------------
    hour = cast(func.extract("hour", local_created), Integer)

    category_rows = await db.execute(
        _scoped_to_agent(
            select(Request.category, hour.label("hour"), func.count(Request.id)), agent_id
        )
        .where(in_range)
        .group_by(Request.category, hour)
        .order_by(Request.category, hour)
    )
    heatmap_by_category = [
        HeatmapCell(row=category.value, hour=hour_value, count=count)
        for category, hour_value, count in category_rows.all()
    ]

    # isodow gives 1=Monday..7=Sunday; shifted to 0=Monday for the frontend.
    weekday = cast(func.extract("isodow", local_created), Integer) - 1
    weekday_rows = await db.execute(
        _scoped_to_agent(
            select(weekday.label("weekday"), hour.label("hour"), func.count(Request.id)), agent_id
        )
        .where(in_range)
        .group_by(weekday, hour)
        .order_by(weekday, hour)
    )
    heatmap_by_weekday = [
        HeatmapCell(row=str(weekday_value), hour=hour_value, count=count)
        for weekday_value, hour_value, count in weekday_rows.all()
    ]

    # --- closing time -----------------------------------------------------
    # Measured on completion date, not creation date: "how fast did we close
    # things this week" is the question, and a request opened in March and
    # closed today belongs in today's number.
    completed_day = cast(_local(Request.completed_at), Date)
    elapsed_hours = cast(
        func.extract("epoch", Request.completed_at - Request.created_at) / 3600.0,
        Numeric,
    )

    closing_row = (
        await db.execute(
            _scoped_to_agent(
                select(
                    func.avg(elapsed_hours),
                    func.percentile_cont(0.5).within_group(elapsed_hours),
                    func.min(elapsed_hours),
                    func.max(elapsed_hours),
                    func.count(Request.id),
                ),
                agent_id,
            ).where(
                Request.completed_at.isnot(None),
                completed_day.between(window_start, window_end),
            )
        )
    ).one()

    unmeasured = await db.scalar(
        _scoped_to_agent(select(func.count(Request.id)), agent_id).where(
            Request.status == RequestStatus.completed,
            Request.completed_at.is_(None),
            in_range,
        )
    )

    def _hours(value) -> float | None:
        return round(float(value), 2) if value is not None else None

    closing_time = ClosingTime(
        average_hours=_hours(closing_row[0]),
        median_hours=_hours(closing_row[1]),
        fastest_hours=_hours(closing_row[2]),
        slowest_hours=_hours(closing_row[3]),
        measured=closing_row[4] or 0,
        unmeasured=unmeasured or 0,
    )

    # --- AI vs human ------------------------------------------------------
    # Grouped on conversations, because that is where assigned_agent_id lives.
    # Auto-assignment fires on handover, so an assignee means a person was
    # pulled in; null means the agent handled the whole thread alone.
    conversation_day = cast(_local(Conversation.created_at), Date)
    resolution_filters = [conversation_day.between(window_start, window_end)]
    if agent_id is not None:
        resolution_filters.append(Conversation.agent_id == agent_id)
    split_row = (
        await db.execute(
            select(
                _count_if(Conversation.assigned_agent_id.is_(None)),
                _count_if(Conversation.assigned_agent_id.isnot(None)),
            ).where(*resolution_filters)
        )
    ).one()
    resolution = ResolutionSplit(
        ai_only=split_row[0],
        human_involved=split_row[1],
        total=split_row[0] + split_row[1],
    )

    return RequestAnalytics(
        range=DateRange(start=window_start, end=window_end, days=days),
        timezone=settings.business_timezone,
        agent_id=agent_id,
        totals=totals,
        volume=volume,
        heatmap_by_category=heatmap_by_category,
        heatmap_by_weekday=heatmap_by_weekday,
        closing_time=closing_time,
        resolution=resolution,
    )


@router.get("/agents-summary", response_model=list[AgentSummaryStat])
async def agents_summary(
    days: int = Query(default=14, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Per-agent activity for the Home page's "Overall" view — a real,
    from-the-database comparison across all agents (conversations, messages
    in each direction, request outcomes, and how often a reply was actually
    grounded in the knowledge base), not a simulated leaderboard.
    """
    window_end = datetime.now(UTC).astimezone(ZoneInfo(settings.business_timezone)).date()
    window_start = window_end - timedelta(days=days - 1)
    conversation_day = cast(_local(Conversation.created_at), Date)
    in_range = conversation_day.between(window_start, window_end)

    agents = (await db.execute(select(Agent).order_by(Agent.created_at))).scalars().all()

    stats: list[dict] = []
    for agent in agents:
        conversation_ids_subquery = (
            select(Conversation.id).where(Conversation.agent_id == agent.id, in_range).subquery()
        )

        conversations = await db.scalar(
            select(func.count()).select_from(conversation_ids_subquery)
        )

        # jsonb_array_length errors on a non-array JSONB value, and SQL's AND
        # is not guaranteed to short-circuit — a plan that evaluates this
        # side of the AND before the direction check would still blow up on
        # an incoming message's NULL. Gating it behind its own CASE (whose
        # branches Postgres *does* evaluate in order) means the length call
        # never runs on a value that hasn't already been confirmed to be a
        # JSON array.
        citation_count = case(
            (func.jsonb_typeof(Message.kb_chunks_used) == "array", func.jsonb_array_length(Message.kb_chunks_used)),
            else_=0,
        )
        message_row = (
            await db.execute(
                select(
                    _count_if(Message.direction == MessageDirection.incoming),
                    _count_if(Message.direction == MessageDirection.outgoing),
                    _count_if(
                        (Message.direction == MessageDirection.outgoing) & (citation_count > 0)
                    ),
                ).where(Message.conversation_id.in_(select(conversation_ids_subquery.c.id)))
            )
        ).one()
        messages_in, messages_out, cited_out = message_row

        request_row = (
            await db.execute(
                select(
                    func.count(Request.id),
                    _count_if(Request.status == RequestStatus.pending),
                    _count_if(Request.status == RequestStatus.completed),
                ).where(Request.conversation_id.in_(select(conversation_ids_subquery.c.id)))
            )
        ).one()

        stats.append(
            {
                "agent_id": agent.id,
                "agent_name": agent.name,
                "icon": agent.icon,
                "conversations": conversations or 0,
                "messages_in": messages_in or 0,
                "messages_out": messages_out or 0,
                "requests_total": request_row[0] or 0,
                "requests_pending": request_row[1] or 0,
                "requests_completed": request_row[2] or 0,
                "kb_citation_rate": round((cited_out or 0) / messages_out, 3) if messages_out else 0.0,
            }
        )

    return stats


@router.get("/nav-counts", response_model=NavCounts)
async def nav_counts(db: AsyncSession = Depends(get_db)) -> NavCounts:
    """Counts for the sidebar badges.

    Two COUNTs rather than making the sidebar fetch both full collections and
    measure their length.
    """
    pending = await db.scalar(
        select(func.count(Request.id)).where(Request.status == RequestStatus.pending)
    )
    open_conversations = await db.scalar(
        select(func.count(Conversation.id)).where(
            Conversation.status == ConversationStatus.open
        )
    )
    workspace = await get_or_create_workspace_settings(db)
    return NavCounts(
        pending_requests=pending or 0,
        open_conversations=open_conversations or 0,
        notify_new_request=workspace.notify_new_request,
    )
