"""One global search box, across the handful of things worth jumping to
directly. Deliberately a union of a few cheap ILIKE queries rather than a
real search index (Postgres full-text, a vector index) — the record counts
in this app are small, and a fuzzy/ranked search engine is a separate,
much larger feature than "the top bar's search box should do something
real" calls for.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.agents.models import Agent
from app.domains.contacts.models import Contact
from app.domains.conversations.models import Conversation
from app.domains.knowledge_base.models import KnowledgeBase
from app.domains.requests.models import Request
from app.domains.search.schemas import SearchResult

router = APIRouter(prefix="/search", tags=["search"])

_PER_TYPE_LIMIT = 5


@router.get("", response_model=list[SearchResult])
async def search(q: str = Query(min_length=1), db: AsyncSession = Depends(get_db)) -> list[dict]:
    pattern = f"%{q.strip()}%"
    results: list[dict] = []

    conversations = await db.execute(
        select(Conversation.id, Contact.name)
        .join(Contact, Contact.id == Conversation.contact_id)
        .where(Contact.name.ilike(pattern))
        .limit(_PER_TYPE_LIMIT)
    )
    results += [
        {
            "type": "conversation",
            "id": conversation_id,
            "title": name,
            "subtitle": "Conversation",
            "link": f"/app/conversations/{conversation_id}",
        }
        for conversation_id, name in conversations.all()
    ]

    agents = await db.execute(
        select(Agent.id, Agent.name).where(Agent.name.ilike(pattern)).limit(_PER_TYPE_LIMIT)
    )
    results += [
        {
            "type": "agent",
            "id": agent_id,
            "title": name,
            "subtitle": "Agent",
            "link": f"/app/agents/{agent_id}",
        }
        for agent_id, name in agents.all()
    ]

    knowledge_bases = await db.execute(
        select(KnowledgeBase.id, KnowledgeBase.name)
        .where(KnowledgeBase.name.ilike(pattern))
        .limit(_PER_TYPE_LIMIT)
    )
    results += [
        {
            "type": "knowledge_base",
            "id": kb_id,
            "title": name,
            "subtitle": "Knowledge base",
            "link": "/app/knowledge-base",
        }
        for kb_id, name in knowledge_bases.all()
    ]

    requests = await db.execute(
        select(Request.id, Request.title).where(Request.title.ilike(pattern)).limit(_PER_TYPE_LIMIT)
    )
    results += [
        {
            "type": "request",
            "id": request_id,
            "title": title,
            "subtitle": "Request",
            "link": "/app/requests",
        }
        for request_id, title in requests.all()
    ]

    return results
