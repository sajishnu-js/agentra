"""Cosine similarity search over kb_chunks.

Read-only and LLM-free. This exists so retrieval quality can be judged by a
person before anything generates an answer from it.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.knowledge_base.embedding import embed_query
from app.domains.knowledge_base.models import KBChunk, KBDocument


@dataclass
class SearchHit:
    rank: int
    similarity: float
    chunk_id: UUID
    chunk_index: int
    content: str
    document_title: str
    document_source_type: str
    document_language: str | None


async def search(
    session: AsyncSession,
    question: str,
    limit: int = 5,
    knowledge_base_id: UUID | None = None,
) -> list[SearchHit]:
    """Top `limit` chunks for a question, closest first.

    When `knowledge_base_id` is given, results are restricted to documents in
    that knowledge base — an additional filter on KBDocument, not on the
    vector column, so the `<=>` ordering and the HNSW index are unaffected.
    """
    query_vector = embed_query(question)

    # cosine_distance emits the `<=>` operator, which is what
    # ix_kb_chunks_embedding_cosine is built for. Using `<->` here would
    # silently sequential-scan.
    distance = KBChunk.embedding.cosine_distance(query_vector).label("distance")

    query = (
        select(KBChunk, KBDocument, distance)
        .join(KBDocument, KBDocument.id == KBChunk.kb_document_id)
        .where(KBChunk.embedding.isnot(None))
    )
    if knowledge_base_id is not None:
        query = query.where(KBDocument.knowledge_base_id == knowledge_base_id)
    query = query.order_by(distance).limit(limit)

    result = await session.execute(query)

    return [
        SearchHit(
            rank=rank,
            # Vectors are normalised at both ends, so cosine distance is in
            # [0, 2] and similarity is simply 1 - distance.
            similarity=1.0 - float(chunk_distance),
            chunk_id=chunk.id,
            chunk_index=chunk.chunk_index,
            content=chunk.content,
            document_title=document.title,
            document_source_type=document.source_type.value,
            document_language=document.language,
        )
        for rank, (chunk, document, chunk_distance) in enumerate(result.all(), start=1)
    ]


async def searchable_chunk_count(session: AsyncSession) -> int:
    """How many chunks actually have an embedding."""
    from sqlalchemy import func

    return (
        await session.scalar(
            select(func.count(KBChunk.id)).where(KBChunk.embedding.isnot(None))
        )
    ) or 0
