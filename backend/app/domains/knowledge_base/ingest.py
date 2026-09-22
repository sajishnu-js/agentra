"""Folder → parsed text → word chunks → embeddings → kb_chunks.

Each document is one transaction: either the document row and every one of its
chunks land, or nothing does. A half-embedded document is worse than an absent
one, because retrieval would quietly return part of it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.knowledge_base.chunking import (
    CHUNK_OVERLAP_WORDS,
    CHUNK_WORDS,
    chunk_text,
)
from app.domains.knowledge_base.embedding import embed_passages
from app.domains.knowledge_base.models import KBChunk, KBDocument
from app.domains.knowledge_base.parsing import is_supported, parse_file

log = logging.getLogger(__name__)


class Outcome(str, Enum):
    ingested = "ingested"
    updated = "updated"
    unchanged = "unchanged"
    skipped = "skipped"
    empty = "empty"
    failed = "failed"


@dataclass
class FileResult:
    path: Path
    outcome: Outcome
    chunk_count: int = 0
    word_count: int = 0
    language: str | None = None
    detail: str = ""


@dataclass
class IngestReport:
    results: list[FileResult] = field(default_factory=list)

    def of(self, outcome: Outcome) -> list[FileResult]:
        return [result for result in self.results if result.outcome is outcome]

    @property
    def total_chunks(self) -> int:
        return sum(result.chunk_count for result in self.results)


async def replace_chunks(
    session: AsyncSession, document: KBDocument, texts: list[str]
) -> int:
    """Embed `texts` and make them the document's only chunks."""
    await session.execute(delete(KBChunk).where(KBChunk.kb_document_id == document.id))

    vectors = embed_passages(texts)
    for index, (text, vector) in enumerate(zip(texts, vectors, strict=True)):
        session.add(
            KBChunk(
                kb_document_id=document.id,
                content=text,
                chunk_index=index,
                embedding=vector,
            )
        )
    return len(texts)


async def ingest_file(
    session: AsyncSession,
    path: Path,
    *,
    knowledge_base_id: UUID,
    force: bool = False,
) -> FileResult:
    """Ingest one file, or report why it was not ingested.

    `knowledge_base_id` stamps newly created documents. A document that
    already exists (re-ingested, updated content) keeps whatever knowledge
    base it already belongs to — re-running ingest never silently moves a
    document to a different knowledge base.
    """
    path = path.resolve()

    if not is_supported(path):
        return FileResult(
            path=path,
            outcome=Outcome.skipped,
            detail=f"{path.suffix or 'no extension'} is not .docx or .pdf",
        )

    try:
        parsed = parse_file(path)
    except Exception as error:  # noqa: BLE001 — reported per file, never fatal
        log.exception("failed to parse %s", path)
        return FileResult(path=path, outcome=Outcome.failed, detail=str(error))

    existing = await session.scalar(
        select(KBDocument).where(KBDocument.source_path == str(path))
    )

    if not parsed.text.strip():
        return FileResult(
            path=path,
            outcome=Outcome.empty,
            detail=(
                "no text layer — a scanned PDF needs OCR (strategy='hi_res'), "
                "which this pipeline does not install"
            ),
        )

    # Unchanged content, and we already have chunks for it: nothing to redo.
    if (
        existing is not None
        and not force
        and existing.content_hash == parsed.content_hash
    ):
        has_chunks = await session.scalar(
            select(KBChunk.id).where(KBChunk.kb_document_id == existing.id).limit(1)
        )
        if has_chunks is not None:
            return FileResult(
                path=path,
                outcome=Outcome.unchanged,
                language=existing.language,
                detail="content hash matches",
            )

    chunks = chunk_text(parsed.text, size=CHUNK_WORDS, overlap=CHUNK_OVERLAP_WORDS)
    if not chunks:
        return FileResult(path=path, outcome=Outcome.empty, detail="no words after parsing")

    texts = [chunk.text for chunk in chunks]
    word_count = len(parsed.text.split())

    if existing is None:
        document = KBDocument(
            knowledge_base_id=knowledge_base_id,
            title=parsed.title,
            source_type=parsed.source_type,
            language=parsed.language,
            source_path=str(path),
            content_hash=parsed.content_hash,
        )
        session.add(document)
        await session.flush()
        outcome = Outcome.ingested
    else:
        document = existing
        document.title = parsed.title
        document.source_type = parsed.source_type
        document.language = parsed.language
        document.content_hash = parsed.content_hash
        outcome = Outcome.updated

    written = await replace_chunks(session, document, texts)
    await session.commit()

    return FileResult(
        path=path,
        outcome=outcome,
        chunk_count=written,
        word_count=word_count,
        language=parsed.language,
    )


def discover(folder: Path, recursive: bool = True) -> list[Path]:
    """Every file in `folder`, supported or not, so skips can be reported."""
    pattern = "**/*" if recursive else "*"
    return sorted(
        path
        for path in folder.glob(pattern)
        # Ignore dotfiles: .DS_Store shows up in every macOS folder.
        if path.is_file() and not path.name.startswith(".")
    )


async def ingest_folder(
    session: AsyncSession,
    folder: Path,
    *,
    knowledge_base_id: UUID,
    force: bool = False,
    recursive: bool = True,
    on_progress=None,
) -> IngestReport:
    """Ingest every supported document in a folder."""
    if not folder.is_dir():
        raise NotADirectoryError(f"{folder} is not a directory")

    report = IngestReport()
    for path in discover(folder, recursive=recursive):
        result = await ingest_file(
            session, path, knowledge_base_id=knowledge_base_id, force=force
        )
        report.results.append(result)
        if on_progress is not None:
            on_progress(result)
    return report


async def reset_documents(session: AsyncSession, knowledge_base_id: UUID) -> int:
    """Delete every document in one knowledge base and, by cascade, its chunks.

    Scoped to a single KB — used before ingesting real files over the top of
    seeded ones in that KB. Unscoped would silently wipe every *other*
    knowledge base's documents too, which is surprising for an operator who
    only meant to refresh the one they passed via --kb.
    """
    deleted = await session.execute(
        delete(KBDocument).where(KBDocument.knowledge_base_id == knowledge_base_id)
    )
    await session.commit()
    return deleted.rowcount or 0
