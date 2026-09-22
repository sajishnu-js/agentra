import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request as HTTPRequest, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.domains.agents.models import Agent
from app.domains.audit.service import record_audit
from app.domains.auth.dependencies import get_current_user
from app.domains.conversations.models import Conversation
from app.domains.users.models import User
from app.domains.workflows import engine
from app.domains.workflows.catalog import catalog
from app.domains.workflows.models import (
    Workflow,
    WorkflowExecution,
    WorkflowExecutionStatus,
    WorkflowStatus,
    WorkflowVersion,
)
from app.domains.workflows.schemas import (
    ValidationResult,
    WorkflowCreate,
    WorkflowExecutionRead,
    WorkflowRead,
    WorkflowTestRequest,
    WorkflowUpdate,
    WorkflowVersionRead,
)

router = APIRouter(prefix="/workflows", tags=["workflows"])


async def _serialize(db: AsyncSession, workflow: Workflow) -> dict:
    agent = (
        await db.get(Agent, workflow.agent_id) if workflow.agent_id is not None else None
    )
    version_count = await db.scalar(
        select(func.count(WorkflowVersion.id)).where(WorkflowVersion.workflow_id == workflow.id)
    )
    execution_row = (
        await db.execute(
            select(func.count(WorkflowExecution.id), func.max(WorkflowExecution.created_at)).where(
                WorkflowExecution.workflow_id == workflow.id
            )
        )
    ).one()
    return {
        "id": workflow.id,
        "name": workflow.name,
        "description": workflow.description,
        "status": workflow.status,
        "graph": workflow.graph or {"nodes": [], "edges": []},
        "agent_id": workflow.agent_id,
        "agent": agent,
        "schedule_interval_minutes": workflow.schedule_interval_minutes,
        "schedule_next_run_at": workflow.schedule_next_run_at,
        "webhook_token": workflow.webhook_token,
        "created_at": workflow.created_at,
        "version_count": version_count or 0,
        "execution_count": execution_row[0] or 0,
        "last_execution_at": execution_row[1],
    }


async def _get_or_404(db: AsyncSession, workflow_id: UUID) -> Workflow:
    workflow = await db.get(Workflow, workflow_id)
    if workflow is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow not found")
    return workflow


def _apply_schedule(workflow: Workflow) -> None:
    """Keeps the schedule columns in step with whatever `schedule` trigger the
    graph currently has.

    Derived from the graph rather than stored separately so the builder has
    exactly one place to edit an interval — the node's own property panel.
    """
    nodes = engine.trigger_nodes(workflow.graph or {}, "schedule")
    if not nodes:
        workflow.schedule_interval_minutes = None
        workflow.schedule_next_run_at = None
        return
    raw = (nodes[0].get("config") or {}).get("interval_minutes")
    try:
        interval = max(1, int(float(raw)))
    except (TypeError, ValueError):
        interval = 60
    workflow.schedule_interval_minutes = interval
    # Rearmed from now on every save: an interval someone just changed should
    # take effect from the change, not from a next-run time computed under
    # the old one.
    workflow.schedule_next_run_at = datetime.now(UTC) + timedelta(minutes=interval)


@router.get("/catalog")
async def read_catalog() -> dict[str, Any]:
    """Every node type the builder can offer — see catalog.py."""
    return catalog()


@router.get("", response_model=list[WorkflowRead])
async def list_workflows(
    agent_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    stmt = select(Workflow).order_by(Workflow.created_at.desc())
    if agent_id is not None:
        stmt = stmt.where(Workflow.agent_id == agent_id)
    result = await db.execute(stmt)
    return [await _serialize(db, workflow) for workflow in result.scalars()]


@router.post("", response_model=WorkflowRead, status_code=status.HTTP_201_CREATED)
async def create_workflow(
    payload: WorkflowCreate,
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if payload.agent_id is not None and await db.get(Agent, payload.agent_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agent not found")

    workflow = Workflow(
        name=payload.name.strip(),
        description=(payload.description or "").strip() or None,
        status=WorkflowStatus.draft,
        graph=payload.graph.model_dump(),
        agent_id=payload.agent_id,
        created_by_user_id=actor.id,
        webhook_token=secrets.token_urlsafe(24),
    )
    _apply_schedule(workflow)
    db.add(workflow)
    await db.flush()
    await record_audit(
        db, actor=actor, action="create", entity_type="workflow",
        entity_id=workflow.id, summary=f"{actor.name} created workflow {workflow.name}",
    )
    return await _serialize(db, workflow)


@router.get("/{workflow_id}", response_model=WorkflowRead)
async def read_workflow(workflow_id: UUID, db: AsyncSession = Depends(get_db)) -> dict:
    return await _serialize(db, await _get_or_404(db, workflow_id))


@router.patch("/{workflow_id}", response_model=WorkflowRead)
async def update_workflow(
    workflow_id: UUID,
    payload: WorkflowUpdate,
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    workflow = await _get_or_404(db, workflow_id)
    sent = payload.model_dump(exclude_unset=True)
    changes: list[str] = []

    if "name" in sent and sent["name"]:
        workflow.name = sent["name"].strip()
        changes.append("name")
    if "description" in sent:
        workflow.description = (sent["description"] or "").strip() or None
        changes.append("description")
    if "agent_id" in sent:
        if sent["agent_id"] is not None and await db.get(Agent, sent["agent_id"]) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Agent not found")
        workflow.agent_id = sent["agent_id"]
        changes.append("agent")

    if "status" in sent and sent["status"] is not None:
        new_status = sent["status"]
        if new_status is WorkflowStatus.active:
            # Activating is the one transition that must not accept a broken
            # graph: a workflow that can't run is worse live than in draft,
            # because it looks armed.
            blocking = [
                issue for issue in engine.validate_graph(workflow.graph or {})
                if issue["level"] == "error"
            ]
            if blocking:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"Fix {len(blocking)} problem(s) before enabling: {blocking[0]['message']}",
                )
        workflow.status = new_status
        changes.append(f"status → {new_status.value}")

    if "graph" in sent and payload.graph is not None:
        graph = payload.graph.model_dump()
        # A version per save, so the builder's history is the edit history —
        # snapshotting the *outgoing* graph means version N is what the
        # workflow looked like before save N+1, and restoring is symmetric.
        previous = workflow.graph or {}
        if previous.get("nodes"):
            next_number = (
                await db.scalar(
                    select(func.max(WorkflowVersion.version_number)).where(
                        WorkflowVersion.workflow_id == workflow.id
                    )
                )
                or 0
            ) + 1
            db.add(
                WorkflowVersion(
                    workflow_id=workflow.id,
                    version_number=next_number,
                    graph=previous,
                    created_by_user_id=actor.id,
                )
            )
        workflow.graph = graph
        _apply_schedule(workflow)
        changes.append("graph")

    await db.flush()
    if changes:
        await record_audit(
            db, actor=actor, action="update", entity_type="workflow",
            entity_id=workflow.id,
            summary=f"{actor.name} updated {', '.join(changes)} on workflow {workflow.name}",
        )
    return await _serialize(db, workflow)


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(
    workflow_id: UUID,
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    workflow = await _get_or_404(db, workflow_id)
    await record_audit(
        db, actor=actor, action="delete", entity_type="workflow",
        entity_id=workflow.id, summary=f"{actor.name} deleted workflow {workflow.name}",
    )
    # Eager-loads the two lazy="raise" collections the ORM's delete-orphan
    # cascade would otherwise try to read unloaded — same reasoning as
    # delete_conversation in the conversations router.
    result = await db.execute(
        select(Workflow)
        .options(selectinload(Workflow.versions), selectinload(Workflow.executions))
        .where(Workflow.id == workflow_id)
    )
    await db.delete(result.scalar_one())
    await db.flush()


@router.post("/{workflow_id}/duplicate", response_model=WorkflowRead, status_code=status.HTTP_201_CREATED)
async def duplicate_workflow(
    workflow_id: UUID,
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Copies the graph and the agent link, but never the status (a clone
    starts in draft, never live), the webhook token (a copy must not answer
    on the original's URL), or the run history."""
    source = await _get_or_404(db, workflow_id)

    candidate = f"{source.name} (Copy)"
    suffix = 2
    while await db.scalar(select(Workflow.id).where(Workflow.name == candidate).limit(1)):
        candidate = f"{source.name} (Copy {suffix})"
        suffix += 1

    clone = Workflow(
        name=candidate[:150],
        description=source.description,
        status=WorkflowStatus.draft,
        graph=source.graph,
        agent_id=source.agent_id,
        created_by_user_id=actor.id,
        webhook_token=secrets.token_urlsafe(24),
    )
    _apply_schedule(clone)
    db.add(clone)
    await db.flush()
    await record_audit(
        db, actor=actor, action="create", entity_type="workflow",
        entity_id=clone.id, summary=f"{actor.name} duplicated workflow {source.name}",
    )
    return await _serialize(db, clone)


@router.post("/{workflow_id}/validate", response_model=ValidationResult)
async def validate_workflow(workflow_id: UUID, db: AsyncSession = Depends(get_db)) -> dict:
    workflow = await _get_or_404(db, workflow_id)
    issues = engine.validate_graph(workflow.graph or {})
    return {"valid": not any(issue["level"] == "error" for issue in issues), "issues": issues}


@router.post("/{workflow_id}/test", response_model=WorkflowExecutionRead)
async def test_workflow(
    workflow_id: UUID,
    payload: WorkflowTestRequest,
    db: AsyncSession = Depends(get_db),
) -> WorkflowExecution:
    """Runs the workflow for real, right now, from its first trigger node.

    Deliberately not a dry run: the point of testing an automation is to see
    what it actually does. Runs regardless of status, so a draft can be
    proven before it goes live.
    """
    workflow = await _get_or_404(db, workflow_id)
    nodes = [n for n in (workflow.graph or {}).get("nodes", []) if n.get("kind") == "trigger"]
    if not nodes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This workflow has no trigger to start from.")

    conversation = None
    if payload.conversation_id is not None:
        conversation = await db.get(Conversation, payload.conversation_id)
        if conversation is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")

    context = await engine.build_context(db, conversation=conversation, payload=payload.payload)
    execution = await engine.start_run(
        db, workflow, nodes[0], context,
        conversation_id=conversation.id if conversation else None,
    )
    await db.flush()
    return await _load_execution(db, execution.id)


@router.get("/{workflow_id}/executions", response_model=list[WorkflowExecutionRead])
async def list_executions(
    workflow_id: UUID,
    limit: int = Query(default=25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> list[WorkflowExecution]:
    await _get_or_404(db, workflow_id)
    result = await db.execute(
        select(WorkflowExecution)
        .options(selectinload(WorkflowExecution.steps))
        .where(WorkflowExecution.workflow_id == workflow_id)
        .order_by(WorkflowExecution.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars())


async def _load_execution(db: AsyncSession, execution_id: UUID) -> WorkflowExecution:
    result = await db.execute(
        select(WorkflowExecution)
        .options(selectinload(WorkflowExecution.steps))
        .where(WorkflowExecution.id == execution_id)
    )
    execution = result.scalar_one_or_none()
    if execution is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Execution not found")
    return execution


@router.get("/{workflow_id}/executions/{execution_id}", response_model=WorkflowExecutionRead)
async def read_execution(
    workflow_id: UUID, execution_id: UUID, db: AsyncSession = Depends(get_db)
) -> WorkflowExecution:
    execution = await _load_execution(db, execution_id)
    if execution.workflow_id != workflow_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Execution not found")
    return execution


@router.post("/{workflow_id}/executions/{execution_id}/retry", response_model=WorkflowExecutionRead)
async def retry_execution(
    workflow_id: UUID, execution_id: UUID, db: AsyncSession = Depends(get_db)
) -> WorkflowExecution:
    """Re-runs a failed execution from the node it stopped on, keeping its
    original trigger context — the same resume path the scheduler's automatic
    backoff uses, just invoked by hand."""
    workflow = await _get_or_404(db, workflow_id)
    execution = await _load_execution(db, execution_id)
    if execution.workflow_id != workflow_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Execution not found")
    if execution.status is not WorkflowExecutionStatus.failed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only a failed run can be retried.")
    if execution.current_node_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This run has no node to resume from.")

    execution.status = WorkflowExecutionStatus.running
    execution.retry_count += 1
    execution.error = None
    execution.finished_at = None
    execution.resume_at = None
    await engine.advance(db, workflow, execution, execution.current_node_id)
    await db.flush()
    return await _load_execution(db, execution_id)


@router.get("/{workflow_id}/versions", response_model=list[WorkflowVersionRead])
async def list_versions(
    workflow_id: UUID, db: AsyncSession = Depends(get_db)
) -> list[WorkflowVersion]:
    await _get_or_404(db, workflow_id)
    result = await db.execute(
        select(WorkflowVersion)
        .where(WorkflowVersion.workflow_id == workflow_id)
        .order_by(WorkflowVersion.version_number.desc())
    )
    return list(result.scalars())


@router.post("/{workflow_id}/versions/{version_id}/restore", response_model=WorkflowRead)
async def restore_version(
    workflow_id: UUID,
    version_id: UUID,
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    workflow = await _get_or_404(db, workflow_id)
    version = await db.get(WorkflowVersion, version_id)
    if version is None or version.workflow_id != workflow_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")

    # The current graph is snapshotted first, so restoring is itself undoable
    # — history only grows forward, it is never rewritten.
    next_number = (
        await db.scalar(
            select(func.max(WorkflowVersion.version_number)).where(
                WorkflowVersion.workflow_id == workflow.id
            )
        )
        or 0
    ) + 1
    db.add(
        WorkflowVersion(
            workflow_id=workflow.id,
            version_number=next_number,
            graph=workflow.graph or {},
            created_by_user_id=actor.id,
        )
    )
    workflow.graph = version.graph
    _apply_schedule(workflow)
    await db.flush()
    await record_audit(
        db, actor=actor, action="update", entity_type="workflow", entity_id=workflow.id,
        summary=f"{actor.name} restored workflow {workflow.name} to version {version.version_number}",
    )
    return await _serialize(db, workflow)


@router.post("/{workflow_id}/rotate-webhook", response_model=WorkflowRead)
async def rotate_webhook(
    workflow_id: UUID,
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    workflow = await _get_or_404(db, workflow_id)
    workflow.webhook_token = secrets.token_urlsafe(24)
    await db.flush()
    await record_audit(
        db, actor=actor, action="update", entity_type="workflow", entity_id=workflow.id,
        summary=f"{actor.name} rotated the webhook URL for workflow {workflow.name}",
    )
    return await _serialize(db, workflow)
