"""Ingest a folder of .docx and .pdf documents into the knowledge base.

    python -m app.ingest ~/Desktop/"chatbot KB"
    python -m app.ingest ./docs --reset          # clear existing docs first
    python -m app.ingest ./docs --force          # re-embed even if unchanged
    python -m app.ingest ./docs --no-recursive

No LLM and no external API. The embedding model runs locally; the first run
downloads roughly 2.2 GB of weights into ~/.cache/huggingface.

--reset is the one to use before ingesting real documents over a seeded
database: `make seed` writes random vectors, which would otherwise turn up in
search results and make retrieval quality impossible to judge.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path
from uuid import UUID

from sqlalchemy import select

# Registers every ORM model, so SQLAlchemy can configure the whole mapper
# graph. Only knowledge_base is touched here today, but the moment any
# domain gains a cross-domain relationship this becomes load-bearing, and
# the failure it prevents reads like an unrelated bug.
import app.models  # noqa: F401
from app.core.database import SessionLocal, engine
from app.domains.knowledge_base.embedding import model_description
from app.domains.knowledge_base.ingest import (
    FileResult,
    Outcome,
    ingest_folder,
    reset_documents,
)
from app.domains.knowledge_base.chunking import CHUNK_OVERLAP_WORDS, CHUNK_WORDS
from app.domains.knowledge_base.models import KnowledgeBase

SYMBOLS = {
    Outcome.ingested: "+",
    Outcome.updated: "~",
    Outcome.unchanged: "=",
    Outcome.skipped: ".",
    Outcome.empty: "!",
    Outcome.failed: "x",
}


def report_line(result: FileResult) -> str:
    symbol = SYMBOLS[result.outcome]
    name = result.path.name
    if result.outcome in (Outcome.ingested, Outcome.updated):
        return (
            f" {symbol} {name}\n"
            f"     {result.word_count:,} words → {result.chunk_count} chunks"
            f"  [{result.language or 'unknown'}]"
        )
    return f" {symbol} {name}\n     {result.outcome.value}: {result.detail}"


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("folder", type=Path, help="folder containing .docx / .pdf files")
    parser.add_argument(
        "--kb",
        type=UUID,
        default=None,
        help=(
            "id of the knowledge base to ingest into (required — omit it to "
            "see the available knowledge bases)"
        ),
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="delete all existing documents and chunks first",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="re-parse and re-embed even if the file content has not changed",
    )
    parser.add_argument(
        "--no-recursive", action="store_true", help="do not descend into subfolders"
    )
    args = parser.parse_args()

    if args.kb is None:
        async with SessionLocal() as session:
            result = await session.execute(
                select(KnowledgeBase).order_by(KnowledgeBase.name)
            )
            knowledge_bases = list(result.scalars())
        print("error: --kb is required. Available knowledge bases:", file=sys.stderr)
        if not knowledge_bases:
            print("  (none — create one first, e.g. via POST /knowledge-base/collections)",
                  file=sys.stderr)
        for kb in knowledge_bases:
            print(f"  {kb.id}  {kb.name}", file=sys.stderr)
        return 1

    folder = args.folder.expanduser().resolve()
    if not folder.is_dir():
        print(f"error: {folder} is not a directory", file=sys.stderr)
        return 1

    print(f"Folder   {folder}")
    print(f"Chunking {CHUNK_WORDS} words, {CHUNK_OVERLAP_WORDS} overlap")

    # Loading the model can take a while and downloads on first run, so say so
    # before going quiet.
    print("Model    loading…", end="\r", flush=True)
    print(f"Model    {model_description()}")
    print()

    started = time.monotonic()
    async with SessionLocal() as session:
        if args.reset:
            removed = await reset_documents(session, knowledge_base_id=args.kb)
            print(f"Reset: removed {removed} existing document(s) and their chunks\n")

        report = await ingest_folder(
            session,
            folder,
            knowledge_base_id=args.kb,
            force=args.force,
            recursive=not args.no_recursive,
            on_progress=lambda result: print(report_line(result), flush=True),
        )

    elapsed = time.monotonic() - started

    print()
    print(
        f"Done in {elapsed:.1f}s — "
        f"{len(report.of(Outcome.ingested))} ingested, "
        f"{len(report.of(Outcome.updated))} updated, "
        f"{len(report.of(Outcome.unchanged))} unchanged, "
        f"{len(report.of(Outcome.skipped))} skipped, "
        f"{len(report.of(Outcome.empty))} empty, "
        f"{len(report.of(Outcome.failed))} failed"
    )
    print(f"{report.total_chunks} chunks embedded and stored")

    await engine.dispose()
    return 1 if report.of(Outcome.failed) else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
