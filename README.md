# Agentra

A self-hosted AI agent platform — Respond.io-shaped, but running on
your own infrastructure.

Built to be run by one person: two processes and two containers, no Kubernetes,
no microservices, no service mesh.

---

## Live demo

**[View the deployed UI →](https://agentra-six.vercel.app)**

The deployed site is **frontend-only**. There is no FastAPI process, no Postgres
and no Redis behind it — the backend needs a persistent worker, a pgvector
database and a ~2.2 GB embedding model, none of which fit a static host.

So that the UI is still explorable rather than a wall of failed requests, the
deployed build swaps the API client for a snapshot of real API responses
(`frontend/src/demo/`). The fixtures were captured from the running local API
against the seeded database, so every payload has the exact shape the real
endpoint returns. Writes are kept in memory and reset on reload.

What that means for anyone reading this:

- **Real** — every screen, the design system, the 3D landing scene, routing,
  state handling, loading and empty states, the workflow canvas.
- **Canned** — AI replies, retrieval results, and anything requiring the model
  or the database.

To see the whole system actually working — Telegram in, RAG-grounded Gemini
out — run it locally with the Quick start below.

---

## Status

**Phase 1 — shell and design system.** Done. Navigation, theming and the glass
component layer are real and working.

**Phase 2 — schema.** Done. Eleven tables as SQLAlchemy models, two Alembic
migrations, pgvector with an HNSW cosine index, and a seed script.

**Phase 3 — screens.** Done. All seven screens read from FastAPI, which reads
from Postgres. There is no hardcoded data in the frontend and `mock/data.ts` is
gone.

**Phase 4 — knowledge base ingestion.** Done. `.docx` and `.pdf` files are
parsed, chunked, embedded locally and stored in `kb_chunks`, with a CLI to
ingest a folder and another to test retrieval by hand.

**Phase 5 — the live message pipeline.** Done. Telegram in, RAG-grounded Gemini
out, logged to Postgres and visible in the dashboard within seconds. Channel and
LLM are both behind interfaces, so WhatsApp or a local model is a new class
rather than an orchestrator change.

**Phase 6 — Settings & workspace management.** Done. Session-based sign-in
(no password — see "Auth and team management" below), roles, a full staff
admin screen, agent ownership, workspace/security/notification/AI-default
settings, and an audit log covering all of it.

Still missing: WhatsApp and automatic Request creation on handoff. Staff
reply and request assignment both now work from the dashboard.

---

## Stack

| Layer    | Choice                                                     |
| -------- | ---------------------------------------------------------- |
| Frontend | React 19 + Vite + TypeScript, Tailwind CSS v4, shadcn/ui   |
| Backend  | FastAPI, modular monolith, SQLAlchemy 2 async              |
| Database | PostgreSQL 17 + pgvector                                   |
| Cache    | Redis 7                                                    |
| Local    | Docker Compose for Postgres + Redis only                   |

The API and the web app run natively on the host. Only the stateful pieces are
containerised, so reloads stay instant and there is one less layer between you
and a stack trace.

---

## Getting started

Prerequisites: Node 20+, Python 3.12, and a Postgres 17 with pgvector.

```bash
make install   # backend venv + frontend node_modules + backend/.env
make up        # Postgres on :5433, Redis on :6380   (see caveat below)
make migrate   # apply both migrations
make seed      # realistic fake rows
make api       # FastAPI on :8000   (leave running)
make web       # Vite on :5173      (second terminal)
```

Then open <http://localhost:5173>. API docs are at
<http://localhost:8000/docs>, and <http://localhost:8000/health/ready> reports
Postgres, pgvector and Redis.

Ports are deliberately non-default (5433 / 6380) so nothing collides with a
Postgres or Redis you already run.

### The database on this machine

`make up` does not work here yet. `docker-compose up -d` fails with
`permission denied ... /var/run/docker.sock`, because that socket is a symlink
to `/Users/sammy/.docker/run/docker.sock` — Docker Desktop is running under a
different macOS account. Start Docker Desktop while logged in as **saji** and
`make up` works; nothing in the repo needs changing.

Until then this project runs against a local Homebrew Postgres 17 instead:

```bash
brew install postgresql@17 pgvector      # already done
make pg-local-up                         # starts PG17 on :5433
make pg-local-down                       # stops it
```

That deliberately matches the `pgvector/pgvector:pg17` image the Compose file
uses — same major version, same port, same `DATABASE_URL` — so switching back
to Docker needs no config change. Homebrew's pgvector bottle only builds for
Postgres 17 and 18, so this could not reuse the Postgres 16 already on :5432;
that instance is untouched and still serving its own databases.

**A fresh database needs pgvector installed into `template1` first.** Homebrew's
pgvector is not marked `trusted`, so only a superuser can
`CREATE EXTENSION vector` — and the `agentra` role is not one. The initial
migration opens with `CREATE EXTENSION IF NOT EXISTS vector`, so creating a new
database as `agentra` and running `make migrate` fails with "permission denied
to create extension". Installing it into `template1` once means every database
created afterwards inherits it:

```bash
psql -h localhost -p 5433 -d template1 -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

This does not affect the Docker path: there `POSTGRES_USER=agentra` is the
cluster superuser, and `docker/postgres/init.sql` creates the extension anyway.

`pgvector` ships in its own keg rather than inside the Postgres one, so its
files are symlinked into PG17's `extension` and `lib` directories. If a
`brew upgrade` ever breaks `CREATE EXTENSION vector`, re-link them:

```bash
ln -sf /opt/homebrew/opt/pgvector/share/postgresql@17/extension/vector*  \
       /opt/homebrew/share/postgresql@17/extension/
ln -sf /opt/homebrew/opt/pgvector/lib/postgresql@17/vector.dylib  \
       /opt/homebrew/lib/postgresql@17/
```

**Redis is not running.** It only exists in the Compose file, so
`/health/ready` reports `degraded` until Docker works. Nothing uses Redis yet —
it is there for background jobs and WebSocket fan-out later — so this does not
affect any screen.

Also note this machine has the standalone `docker-compose` binary but not the
`docker compose` CLI plugin. `make up` detects which one you have.

---

## Layout

```
backend/
  app/
    main.py              app factory, CORS, /health and /health/ready
    api.py               mounts every domain router under /api/v1
    models.py            imports all ORM models so Alembic can see them
    core/
      config.py          pydantic-settings, reads backend/.env
      database.py        async engine, session dependency, Base, TimestampMixin
      redis.py           shared Redis client
    seed.py              realistic fake rows, refuses to run outside local
    ingest.py            CLI: ingest a folder of .docx/.pdf
    search.py            CLI: retrieval test, no LLM involved
    telegram_bot.py      CLI: Telegram long polling, enqueues only
    worker.py            CLI: RQ worker, runs the orchestrator
    orchestrator.py      the message pipeline; names no channel and no model
    channels/
      base.py            ChannelAdapter + InternalMessage
      telegram.py        TelegramAdapter (long polling)
    handover/
      keywords.py        THE FILE TO EDIT — trigger terms, EN + AR
      policy.py          matching, Arabic normalisation, thresholds
    core/
      security.py        bcrypt hashing, JWT issue/verify
      auth.py            current_user / admin_user dependencies
    llm/
      base.py            LLMProvider + ContextChunk + ExtractedRequest
      gemini.py          GeminiProvider (google-genai), both calls
      echo.py            EchoProvider — no API key, no spend
      registry.py        provider selection from LLM_PROVIDER
      prompts/
        reply.py         answer a patient, grounded in retrieved docs
        extraction.py    classify a turn into a request — separate job
    jobs/
      connection.py      Redis + RQ queue
      session.py         per-job engine (see the pipeline notes)
      tasks.py           RQ entry points
    domains/             one folder per domain — models, schemas, router
      agents/            AI agent config; no table yet, on purpose
      contacts/
      conversations/     Conversation + Message
        assignment.py    pick_assignee — the swappable routing rule
      knowledge_base/    KBDocument + KBChunk, with the pgvector column
        parsing.py       unstructured, .docx and .pdf
        chunking.py      300-word windows, 50-word overlap
        embedding.py     sentence-transformers, local, 1024d
        ingest.py        folder -> documents -> chunks -> embeddings
        retrieval.py     cosine search over kb_chunks
      requests/          the Requests Hub queue
        service.py       dedupe groups, escalation, category coercion
      users/             staff accounts, workload counts
      auth/              login, /me, change-password
      settings/
        business_hours.py  THE FILE TO EDIT — clinic opening hours
  alembic/               async migration environment
    versions/            the initial schema migration
frontend/
  src/
    index.css            THE DESIGN SYSTEM — read this first
    theme/               ThemeProvider, light/dark state
    lib/
      api.ts             the only place that calls fetch
      types.ts           response types, mirroring the Pydantic schemas
      format.ts          dates, relative times, the reply-window rule
    hooks/useApi.ts      GET + loading + error
    components/
      ui/                shadcn/ui primitives, themed
      layout/            AppShell, Sidebar, Topbar, ThemeToggle
      charts/            Recharts stacked volume chart, CSS-grid heatmap
      ClosingTimePanel.tsx  closing time + AI/human split
      StatusPill.tsx     glowing status and priority pills
      StateBlock.tsx     shared loading / error / empty states
    pages/               one file per sidebar destination
docker/postgres/init.sql CREATE EXTENSION vector
```

### Why a modular monolith

Every domain is a folder, not a service. They share one process, one database
and one deployment. Cross-domain foreign keys are allowed and used (a
conversation points at a contact and an agent). Adding a domain means creating
a folder and adding one line to `app/api.py`.

If a domain ever genuinely needs to scale on its own, the folder boundary is
where you would cut. Until then, staying in one process is what makes this
maintainable by one developer.

---

## The design system

`frontend/src/index.css` is the single source of truth for every colour, blur,
radius and shadow. Components never hardcode a colour — they reference tokens,
which is what makes the light/dark toggle work without duplicating a single
component.

The file has five layers:

1. `:root` — light-mode token values
2. `.dark` — dark-mode values, same token names
3. `@theme inline` — exposes tokens to Tailwind (`bg-glass`, `text-brand-text`, …)
4. `@layer base` — element defaults and the ambient page gradient
5. `@layer components` — the `.glass`, `.glass-strong`, `.glass-inset` recipes

Token names follow shadcn/ui conventions (`--background`, `--primary`,
`--muted-foreground`, `--sidebar-*`), so anything you add later with
`npx shadcn add <component>` inherits this theme with no edits. `--glass-*` and
`--brand-*` are Agentra's additions on top.

### Theme

**Dark** — a deep navy-black page (`#070b14`, between the two ends of the range
you specified), panels made of an 8% blue-white film over that navy, blurred,
with a 1px light hairline border and a soft shadow. Off-white primary text,
muted slate-blue secondary.

**Light** — a very light blue-gray page (`#f4f6fb`), panels of 66% white,
blurred, where a shadow rather than a border carries the depth. Dark navy
primary text, gray-blue secondary.

Both modes use the same electric blue, stepped per mode for contrast:

| Use                          | Light     | Dark      |
| ---------------------------- | --------- | --------- |
| Filled buttons, unread badge | `#2563eb` | `#2563eb` |
| Focus ring, active indicator | `#2563eb` | `#3b82f6` |
| Accent text and icons        | `#1d4ed8` | `#60a5fa` |

`#3b82f6` with white text on top is only 3.7:1, which fails WCAG AA. So filled
surfaces use `#2563eb` (5.2:1 with white) and `#3b82f6` is kept for rings,
glows and active indicators, where it sits against the page rather than under
text. Both are the same blue family.

### Charts

`--chart-1` … `--chart-5` are a fixed-order categorical palette, assigned by
slot and never cycled. Both modes were checked with a validator against their
own panel surface — lightness band, chroma floor, protan/deutan separation,
normal-vision separation and 3:1 contrast all pass. The dark set is re-stepped
for the dark surface rather than brightened; a straight flip pushes four of the
five out of the lightness band.

Re-run the validator before changing a slot.

The daily volume chart is Recharts: bars capped at 24px, stacked by status with
a legend, rounded only at the top of the stack, and quiet days zero-filled by
the API so the axis cannot lie. Long windows thin their own axis labels via
`minTickGap` rather than printing 90 overlapping dates.

**The heatmap is a CSS grid, not Recharts.** Recharts has no heatmap
primitive, and the usual workaround — a `ScatterChart` with fixed-size square
marks — cannot size its cells to the plot area, so the grid never tiles and
reads as a dot matrix. A grid of real elements also gets per-cell labels,
keyboard focus and responsive sizing for free. It encodes sequentially: one
hue at five opacity steps, light to dark.

Both charts set `isAnimationActive={false}` where relevant — the grow-from-zero
animation leaves the chart empty on first paint, which is visible in
screenshots and pointless on a dashboard.

### Light/dark toggle

`ThemeProvider` holds the active theme in React state and mirrors it onto
`<html>` as a `dark` class. Not persisted yet, as agreed — adding
`localStorage` later means changing only the `useState` initialiser and the
setter, both in `frontend/src/theme/ThemeProvider.tsx`.

---

## How the frontend gets data

Every screen reads through `lib/api.ts`, which fetches relative `/api/v1`
paths. Vite proxies those to `:8000` in dev, so there is no base URL to
configure and no CORS in the browser. `hooks/useApi.ts` wraps a GET with
loading and error state.

`useApi` is deliberately ~40 lines and dependency-free. Swap it for TanStack
Query when screens start needing background polling and cache invalidation
after writes — the message thread is the obvious first one. What it returns is
close enough that components will not need rewriting.

Endpoints the screens use:

| Screen          | Endpoint                                              |
| --------------- | ----------------------------------------------------- |
| Home            | `/analytics/requests?days=N` (7 / 14 / 30 / 90)       |
| Sidebar badges  | `/analytics/nav-counts`                               |
| Conversations   | `/conversations`, `/conversations/{id}`, `…/messages` |
| Knowledge Base  | `/knowledge-base/tables`, `…/tables/{slug}`, `…/documents` |
| Requests Hub    | `/requests?status=…`                                  |
| Agents          | `/agents`                                             |
| Inboxes         | `/inboxes`                                            |
| Profile         | `/users/me` (GET, PATCH)                              |

Analytics are computed in Postgres and bucketed in `Asia/Dubai`, not UTC —
"when do requests come in" only means something in clinic local time.

The bundle is ~762 kB (233 kB gzipped), and Recharts is most of it. If that
starts to matter, lazy-load the Home route; nothing else imports Recharts.

## Knowledge base ingestion

Parse → chunk → embed → store. Entirely local: the only network access is the
one-off model download.

```bash
make ingest dir=~/Desktop/"chatbot KB"          # ingest a folder
make ingest dir=./docs reset=1                  # wipe existing documents first
make ingest dir=./docs force=1                  # re-embed even if unchanged
make search q="How much is laser hair removal?" # retrieval test
make search q="هل تقبلون تأمين دامان؟" limit=10
```

Or directly: `python -m app.ingest <folder>` and `python -m app.search "<q>"`.

### The pipeline

| Step  | Where                                    | What                                        |
| ----- | ---------------------------------------- | ------------------------------------------- |
| Parse | `knowledge_base/parsing.py`              | `unstructured`, `.docx` and `.pdf` only     |
| Chunk | `knowledge_base/chunking.py`             | 300-word windows, 50-word overlap           |
| Embed | `knowledge_base/embedding.py`            | `BAAI/bge-m3`, 1024d, local                 |
| Store | `knowledge_base/ingest.py`               | one transaction per document                |
| Search| `knowledge_base/retrieval.py`            | cosine `<=>` against the HNSW index         |

`app/ingest.py` and `app/search.py` are thin CLI wrappers over those, in the
same `python -m app.<name>` style as `app.seed`.

### Choices worth knowing

**`BAAI/bge-m3`, and the prefix trap.** It is 1024-dimension, so it drops
straight into the existing column with no migration, handles Arabic and English
in one model, and takes an 8192-token window. `multilingual-e5-large` also
works — set `EMBEDDING_MODEL` — but E5 was trained with `query:` and `passage:`
prefixes and loses real accuracy without them, while bge-m3 was trained with
none and would be hurt by adding them. `embedding.py` picks the right behaviour
from the model name, so switching models does not silently degrade retrieval.

The first run downloads ~2.2 GB to `~/.cache/huggingface`. On Apple Silicon it
picks `mps` automatically; 173 chunks embed in about 20 seconds.

**Vectors are normalised at both ends.** `normalize_embeddings=True` on ingest
*and* on query, which is what makes `similarity = 1 - distance` true. If only
one side were normalised every score would be quietly wrong, so this is
verified: all stored vectors have an L2 norm of exactly 1.0.

**Retrieval uses `<=>`, and that is load-bearing.** `EXPLAIN` confirms `<=>`
gives `Index Scan using ix_kb_chunks_embedding_cosine`, while `<->` falls back
to a sequential scan even with `enable_seqscan = off`. The HNSW index is built
for cosine and cannot serve L2.

**Re-ingestion is cheap.** Each document stores its absolute `source_path`
(unique) and a SHA-256 `content_hash`, so a second pass over the same folder
skips unchanged files instead of re-embedding them — 9 seconds against 92 on
the first run. `--force` overrides it.

**`--reset` before ingesting real documents.** `make seed` writes *random*
vectors into `kb_chunks` to exercise the column. Left in place they show up in
search results and make retrieval quality impossible to judge, so clear them
first.

**Scanned PDFs are reported, not silently skipped.** Parsing uses
`strategy="fast"`, which reads the embedded text layer and needs no OCR
dependencies. A PDF with no text layer comes back as `empty` with an
explanation rather than storing nothing. Handling those needs
`strategy="hi_res"`, tesseract, and the unstructured inference extras.

Anything that is not `.docx` or `.pdf` is reported as skipped. The CSVs in the
`chatbot KB` folder — doctors, prices, insurance, treatments — are a better fit
for the structured `kb_tables` grids than for chunked prose, which is the
obvious next thing to build.

## The message pipeline

```
Telegram ──> app.telegram_bot ──> Redis (RQ) ──> app.worker ──> orchestrator
                (normalize +                                        │
                 enqueue only)                                      ├─ find/create contact + conversation
                                                                    ├─ log inbound message
                                                                    ├─ embed the question (bge-m3, local)
                                                                    ├─ top-k kb_chunks via pgvector <=>
                                                                    ├─ GeminiProvider.generate_reply(...)
                                                                    ├─ log reply + kb_chunks_used
                                                                    └─ TelegramAdapter.send(...)
```

Four processes, run in four terminals:

```bash
make api      # :8000  reads
make web      # :5173  dashboard
make bot      # Telegram long polling — enqueues and nothing else
make worker   # does everything above
```

`make bot` needs a token. Create one by messaging **@BotFather** in Telegram,
then put it in `backend/.env` as `TELEGRAM_BOT_TOKEN=`.

### The two seams

| Seam           | Interface                  | Now                              | Later                        |
| -------------- | -------------------------- | -------------------------------- | ---------------------------- |
| Channel        | `app/channels/base.py`     | `TelegramAdapter` (long polling) | `WhatsAppAdapter` (webhook)  |
| Model          | `app/llm/base.py`          | `GeminiProvider`, `EchoProvider` | a local model                |

Everything between them speaks `InternalMessage` and `ContextChunk`.
`app/orchestrator.py` names no channel and no model — it asks `get_adapter()`
for one and `get_provider()` for the other. `EchoProvider` exists to prove that:
set `LLM_PROVIDER=echo` and the whole pipeline runs with no API key and no
token spend.

### Choices worth knowing

**The bot process does almost nothing.** It normalizes the update, puts a job
on Redis and returns. Embedding, retrieval and the model call all happen in the
worker, so a slow model or a database hiccup can never stop the bot reading its
inbox.

**`google-genai`, not `google-generativeai`.** The older package is marked
"Development Status :: 7 - Inactive" and its own README is titled
"[Deprecated]" — Google replaced it with the unified SDK for Gemini 2.x and up.
Building on the retired one would have meant a rewrite. Nothing outside
`app/llm/gemini.py` can tell.

**Idempotency distinguishes "seen" from "answered".** The inbound message is
committed before any slow work, so a failing embed or model call cannot lose
what the patient said. That means a retried job finds its own inbound row —
and skipping on that alone would be a bug, because a transient Gemini 503 would
leave the patient permanently unanswered. A retry is only a no-op once a reply
actually exists. Verified in both directions.

**The message dedupe index is partial, and inbound only.**

```sql
CREATE UNIQUE INDEX uq_messages_inbound_external_id ON messages
  (conversation_id, external_id) WHERE direction = 'incoming';
```

Covering outbound messages too meant that a reply successfully delivered to a
patient could fail to be recorded — an answer the patient has and the dashboard
does not. Outbound ids are the channel's to guarantee, not ours to enforce.

**Workers get their own engine per job.** An RQ job is a synchronous function,
so the natural way to call async code is `asyncio.run()` — a new event loop each
time. asyncpg connections are bound to the loop that opened them, so a pooled
connection from the API's module-level engine would belong to a dead loop and
fail in a way that looks like a driver bug. `app/jobs/session.py` builds a
`NullPool` engine per job and disposes it.

**`SimpleWorker`, not the default forking worker.** A fork per job would reload
the 2.2 GB embedding model every time.

**An LLM failure answers anyway.** Quota exhausted, a 503, a revoked key — none
of those should leave a patient with silence. The orchestrator catches it, sends
a short "a team member will follow up" in the language already detected on the
contact, and marks the conversation `pending` so it surfaces for a human.

**Gemini free tier is 20 requests/day** on `gemini-3.6-flash`, which is hit
almost immediately in testing. The 429 is what motivated the fallback above.
A paid key is needed before this faces real patients.

**Thinking tokens count against `max_output_tokens`.** At 600 the Arabic replies
truncated mid-word, because Gemini 3.x spends 170-200 tokens thinking before it
writes. The ceiling is 2048 and no `thinking_config` is set: `thinking_budget=0`
is rejected outright by 3.x, and `thinking_level` is a 3.x-only field that would
break if `GEMINI_MODEL` pointed at a 2.5 model. The prompt keeps replies short,
not the token limit.

**The dashboard polls.** The worker writes from outside the browser, so the
thread refreshes every 4s, the list every 8s, the sidebar counts every 15s.
Refreshes are silent — no spinner, and a failed poll keeps the data already on
screen. This is the point at which TanStack Query starts to earn its place.

## Human handover

Two layers, checked in order. Either one stops the AI reply reaching the patient
and flags the thread for a person.

```
inbound message
   │
   ├─ 1. hard keyword rules ──── match? ──> pending, reason=keyword
   │      (no model call at all)             holding reply, model never invoked
   │
   └─ 2. no match: retrieve + ask the model
          │
          ├─ confidence below threshold ──> pending, reason=ai_uncertain
          │    or context_sufficient=false    draft withheld, holding reply
          │
          ├─ provider unreachable ─────────> pending, reason=llm_error
          │                                   holding reply
          │
          └─ confident and grounded ───────> send the AI reply (Phase 5 behaviour)
```

### Layer 1: keyword rules

`backend/app/handover/keywords.py` is **the file to edit**. It holds nothing but
lists of trigger terms per category — symptoms, emergency, medication,
complaints — in English and Arabic. Matching lives in `policy.py`; the
orchestrator never sees the lists.

Checked before retrieval and before the model. If a patient is describing a
symptom or asking about medication, no amount of model confidence makes it
appropriate to answer, so the model is not asked. A keyword hit records
`chunks_used=0` and `model=None`, which is how you can tell from the job result
that the AI really was skipped.

**Arabic matching is not naive substring matching.** Text is normalised first
(diacritics and tatweel stripped, أ إ آ ٱ → ا, ى → ي, ة → ه), so "ألم" in the
list matches "الم" as typed. Single words match whole-word; Arabic additionally
tolerates the definite article and a closed set of endings
(ات ين ون ها نا ه ي ك), so "طارئ" catches "طارئة". That bound matters: allowing
arbitrary suffixes would make "الم" (pain) fire on "المواعيد" (the
appointments), and unbounded substring matching would make the queue useless.

Broken plurals still need their own entry — "آلام" cannot be derived from "ألم"
by any suffix rule, because Arabic rewrites the middle of the word.

The list deliberately excludes obvious-looking medical words that are ordinary
enquiries at a cosmetic clinic: `injection` is botox, `scar` is scar revision,
`laser` is a treatment. Including them would hand over routine price questions
and train staff to ignore the queue.

### Layer 2: the model's self-assessment

`GeminiProvider` returns schema-constrained JSON, not prose with a sentinel
token in it:

```json
{ "reply": "...", "context_sufficient": true, "confidence": "high" }
```

Two separate signals on purpose — a model can sound confident about something
the context never said, so `context_sufficient=false` is decisive regardless of
`confidence`. `AI_MIN_CONFIDENCE` (default `medium`) sets the bar.

The provider reports; it does not decide. The threshold lives in
`app/handover/policy.py`, so the same policy applies to whatever model is behind
the interface. A withheld draft is still logged — it is usually most of a usable
answer for the staff member picking the thread up.

### Recorded on the conversation

| Column            | Holds                                                       |
| ----------------- | ----------------------------------------------------------- |
| `handover_reason` | `keyword` / `ai_uncertain` / `llm_error` / `manual`         |
| `handover_detail` | which terms matched, or the confidence the model reported    |
| `handover_at`     | when it was raised, so the queue can be aged                 |

The dashboard tints pending rows amber, gives them an amber edge marker and a
reason badge, and shows the detail verbatim in the thread header and detail
panel. `keyword` is red and `ai_uncertain` amber, because they need different
reactions: one means a patient described a symptom, the other means the agent
was unsure about a routine question.

A confident answer clears the flag, so one earlier medical question does not
leave a thread marked forever.

### Tuning

Both knobs are environment variables, and neither needs a code change:

```bash
AI_MIN_CONFIDENCE=high          # stricter — only fully grounded answers go out
KEYWORD_HANDOVER_ENABLED=false  # measure the model without the keyword layer
```

The keyword list is the thing that will actually need work. Add terms as real
messages arrive — a false handover costs a staff member seconds, a missed one
means a patient with a real symptom talking to a bot.

## Request extraction

A second model call per turn, with its own prompt, whose only job is
classification. It does not answer the patient and the reply call does not
classify — `app/llm/prompts/` holds one module per job for exactly that reason.

```
turn completes (reply sent, handover recorded)
      │
      └─ extract_request(history, latest message)     ← separate prompt, temp 0.0
             │
             ├─ is_actionable = false ──> nothing. The common case.
             │
             └─ true ──> category + title + priority
                          │
                          ├─ open request for equivalent work? ──> dedupe
                          │      └─ higher priority? ──> escalate the existing row
                          │
                          └─ otherwise ──> insert, status = pending
```

Runs **after** the patient has been replied to, on its own database session. It
fires regardless of handover outcome — a keyword handover for "I want to speak
to a person" should absolutely produce a request.

### Choices worth knowing

**Extraction is isolated from the turn, deliberately.** It opens its own
session and takes a conversation id rather than a live ORM object. Rolling back
a shared session here would expire the caller's already-committed objects, and
the next attribute access would raise `MissingGreenlet` — turning a failed
classification into a failed conversation turn, which is exactly backwards. RQ
would then retry a message the patient has already been answered. A missed
request row is a nuisance; that is not.

**Dedupe is by equivalence group, not exact category.** A patient who asks to
book, then to move it, then to cancel it has not created three pieces of work.
`appointment / reschedule / cancellation` are one group and
`human_request / callback` are another; `insurance` and `complaint` stand alone.
The groups are in `app/domains/requests/service.py`.

**A duplicate can still escalate.** If the new message is more urgent than the
open request, the existing row's priority is raised rather than a second row
being created. That is the one case where a repeat message carries real
information.

**Unknown categories become `other`, they do not raise.** A model inventing a
category should produce a slightly mislabelled row for a human to fix, not a
failed turn. `Booking_exception` — one of the example names in the brief — lands
here; the existing `reschedule` and `cancellation` are more specific and are
what the prompt actually asks for.

**Titles are always English, even for Arabic messages.** The queue is read by
staff. An Arabic cancellation comes out as "Cancel appointment on Thursday".

**`human_request` was added to the taxonomy.** It is distinct from `callback`:
someone can want a person on chat without wanting to be phoned. Adding it meant
a hand-written migration, because `alembic/env.py` filters enum CHECK
constraints out of autogenerate — and that migration has to resize the column as
well as swap the constraint. `Enum(native_enum=False)` renders as VARCHAR sized
to the longest member, so a 13-character value does not fit the VARCHAR(12) that
"cancellation" produced. That failure appears at insert time, long after the
migration looks like it worked.

**Extraction doubles per-turn model usage.** With the free tier's 20 requests
per day per model, that is roughly ten patient messages before everything falls
back to a handover. `REQUEST_EXTRACTION_ENABLED=false` halves it.

### The Requests Hub

Reads live from Postgres, defaults to the Pending filter, and polls every 15s
because the extraction step writes from outside the browser. Staff can mark a
request completed or cancelled, and reopen it — `PATCH /api/v1/requests/{id}`,
status only. Category, priority and title are the model's classification;
correcting those is a separate feature, and folding it into "mark this done"
would make the audit trail ambiguous.

## Auth and team management

### Signing in

A password+JWT version of this existed once and was deliberately removed
(see migration `24e47bc3d88b` — "Auth has been removed from the application
entirely"). What's here now is lighter on purpose: a known workspace email is
enough to open a session. No password, no JWT — an opaque token in a
`sessions` row, checked on every request.

```
POST /api/v1/auth/sessions        ->  { token, user, permissions }   (sign in)
GET  /api/v1/auth/me              ->  restores a session on page reload
GET  /api/v1/auth/sessions        ->  every device you're signed in on
DELETE /api/v1/auth/sessions/current  ->  sign out this device
DELETE /api/v1/auth/sessions/{id}     ->  sign out one other device
DELETE /api/v1/auth/sessions          ->  sign out every other device
```

Seeded staff: sign in as `riley.adams@example.com` for an admin, or
`jordan.blake@example.com` / `sam.ellis@example.com` / `casey.fox@example.com`
for an agent — same seed, no password prompt.

### Roles

| Area                                        | admin | agent |
| ------------------------------------------- | ----- | ----- |
| Conversations, Requests Hub, Inboxes, Home  | yes   | yes   |
| Assigning conversations, tagging            | yes   | yes   |
| Agents config, Knowledge Base               | yes   | **no** |
| Settings (Users, Workspace, Security, ...)  | yes   | **no** (Profile/Appearance/Sessions stay self-service) |

Enforced server-side by a dependency on every endpoint (`get_current_user` /
`require_admin`, see `app/domains/auth/dependencies.py`), not by hiding nav
items. The sidebar and the Settings nav also hide admin destinations from
agents, but only so they don't offer a link that would bounce straight back —
the route guard and the API are what actually stop them. `GET /agents` and
`GET /users/assignable` are the two deliberate exceptions: they stay open to
both roles because Inboxes' routing picker and every assignment picker (open
to both roles) need them — "Agents config... admin-only" is about editing an
agent, not hiding that agents exist.

### Choices worth knowing

**No password, on purpose, twice.** It was built once, then removed because
this is a self-hosted internal tool run by one team on trusted
infrastructure, not a system a hostile party can reach. Rebuilding it a third
time without being asked would reverse a decision that's already been made
deliberately — see the migration message above.

**Session tokens live in localStorage, attached as `Authorization: Bearer`.**
Same tradeoff a cookie-based session would face (XSS vs. CSRF) with none of
the CSRF surface, since there's no ambient credential a cross-site request
could ride along on.

**Idle timeout, not a fixed lifetime.** A session expires after
`session_idle_timeout_minutes` (Settings → Security, default 30 days) of no
activity, checked against `last_seen_at` rather than `created_at` — an
active user is never logged out mid-use.

**Deactivating someone takes effect on their next request, not their next
sign-in.** `get_current_user` re-reads `is_active` from the database every
time; there's no token to wait out.

**The last active admin can't be demoted, deactivated or deleted.** Checked
explicitly in `users/router.py` before every one of those three operations —
otherwise the workspace could lock itself out of its own admin tier with no
way back in short of a database edit.

### Assignment

`app/domains/conversations/assignment.py` — `pick_assignee` is the whole seam.
Today it returns the active agent with the fewest open or pending
conversations, ties broken on name so the choice is stable and testable.
Swapping it for department routing, skills matching or shift awareness means
rewriting that one function.

Two properties to keep in whatever replaces it: returning `None` must be safe
(nobody available at 3am is normal, and an unassigned thread is still visible),
and it must not raise into the caller — a failed assignment should never cost a
patient their reply.

Auto-assign fires when a conversation moves to `pending` via the Phase 6
handover, and never reassigns a thread someone has already picked up. Admins
count as assignable: at this size the admin answers patients too. Agents with
zero conversations are included, which a plain `GROUP BY` over conversations
would have missed — and those are exactly the ones to assign to.

Manual assignment is `PATCH /api/v1/conversations/{id}` with
`assigned_agent_id`, and the picker shows each person's current load so "who is
free" is answerable without leaving the screen.

### Tags

A `text[]` column on conversations with a GIN index, not a tags table. Tags
here are labels, not entities: nothing hangs off a tag, and the only query is
"which conversations have this one", which `@>` answers directly. When tags
need colours, owners or descriptions, that is when they earn a table.

Normalised server-side — lowercased, trimmed, deduplicated — so the filter list
does not fill up with `Billing`, `billing ` and `BILLING`.

### Business hours

`app/domains/settings/business_hours.py` — **the file to edit.** A config
module rather than a settings table: these change once a year, they are the
same for everyone, and a table would mean a screen, a migration and a cache.
The hours match the clinic's own knowledge base, so the dashboard and the agent
cannot disagree about them.

Computed server-side and returned with the clinic's local time, so a staff
member checking from London sees the clinic's clock rather than their own.
Informational only — nothing is blocked outside hours.

## Home analytics

One endpoint, `GET /api/v1/analytics/requests?days=N`, returns everything the
dashboard shows.

**One request rather than six.** The dashboard always wants all of it, and six
endpoints would mean six round trips and six chances to render a half-loaded
screen.

**Everything is aggregated in Postgres.** Not a style preference: the
alternative is shipping every request row to the browser and counting them
there, which works at 90 rows and falls over at 90,000. The response size here
is fixed by the shape of the dashboard, not by how much traffic the clinic has
had. The three status splits are `COUNT(CASE WHEN ...)` in a single pass rather
than three round trips or a `GROUP BY` that has to be re-densified in Python.

| Element | Aggregation |
| --- | --- |
| Stat cards | `COUNT(*)` plus three conditional counts over `requests` in range |
| Volume chart | `GROUP BY date_trunc(day)` with a conditional count per status |
| Heatmap | `GROUP BY category, hour` — and `GROUP BY weekday, hour` for the toggle |
| Closing time | `avg`/`percentile_cont`/`min`/`max` over `completed_at - created_at` |
| AI vs human | conditional counts on `conversations.assigned_agent_id IS NULL` |

### Choices worth knowing

**"Today" is the clinic's today.** The window is computed in `Asia/Dubai`, not
from the host clock. `date.today()` on a UTC server thinks it is still
yesterday at 02:00 in Dubai, and the whole window would slide by a day every
night.

**Quiet days are zero-filled.** A bar chart that silently drops empty days
reads as "busy every day", and for a clinic the gap is exactly the thing worth
seeing. The API returns one point per day in range, always.

**The range picker is presets, not a calendar.** Every question this dashboard
answers is "how are we doing lately", which is a rolling window rather than an
arbitrary pair of dates. The endpoint takes a plain `days` parameter, so a
custom range is a small addition if it is ever actually wanted.

**`completed_at` is derived from the status transition, never set by a caller.**
Marking a request completed stamps it; reopening clears it, so a request that
bounces between states cannot report a closing time measured from an earlier
attempt.

**The closing-time panel says how many rows it measured.** Requests completed
before the column existed have no timestamp, and the panel reports them
separately rather than quietly averaging over a subset and presenting it as the
whole. A mean over three rows deserves less trust than one over three hundred,
and the panel makes that visible. `average_hours` is `null` rather than `0`
when nothing has been completed — those are different facts.

The seed sets fixture `completed_at` values on its completed rows, but the
migration does **not** back-fill. Inventing timestamps in a migration would
make the panel report a number that means nothing.

**The volume chart uses status colours, not the categorical palette.** Pending,
completed and cancelled are states, and states get the reserved status colours
so they mean the same thing here as they do on the pills in the Requests Hub. A
legend is present because there are three series, so identity is never
colour-alone. Only the topmost stacked segment is rounded, so the stack reads as
one bar rather than three stacked pills.

**The heatmap kept its weekday view.** The brief asked for hour-by-category, and
that is the default. Grouping by weekday was already working and answers a
different question, so the endpoint returns both and the panel has a toggle —
one extra `GROUP BY` rather than deleting a useful view.

**The AI-versus-human split counts conversations, not requests**, because
`assigned_agent_id` lives on conversations. Auto-assignment fires on handover,
so an assignee means a person was pulled in and a null means the agent saw the
thread through alone.

## Database

Seven tables. Every one has a UUID `id` first and a `created_at` last
(`kb_documents` uses `uploaded_at` instead).

| Table           | Holds                                                       |
| --------------- | ----------------------------------------------------------- |
| `users`         | Workspace staff, `role` admin or agent                      |
| `contacts`      | People messaging in, with `external_id` per channel         |
| `conversations` | One thread per contact, plus `last_incoming_at`             |
| `messages`      | Inbound and outbound, `kb_chunks_used` for AI audit         |
| `kb_documents`  | Ingested files, with `source_path` + `content_hash`         |
| `kb_chunks`     | Chunked text plus the 1024-dim embedding                    |
| `kb_tables`     | Structured categories — Doctors, Treatments, FAQs, Insurance |
| `kb_table_rows` | Rows of those categories, as JSONB                          |
| `requests`      | The Requests Hub queue, with `completed_at` for closing time |
| `agents`        | AI agent config — prompt, model, status                     |
| `inboxes`       | Connected channel accounts                                  |

```
users ──< conversations >── contacts
              │
              ├──< messages
              └──< requests

kb_documents ──< kb_chunks
kb_tables ──< kb_table_rows

agents      (standalone)
inboxes     (standalone)
```

Run it:

```bash
make up                          # Postgres + Redis
make migrate                     # apply the initial schema
make seed                        # realistic fake rows, local only
```

### Choices worth knowing

**Enums are VARCHAR + CHECK, not native Postgres enums.** Every status,
channel and category column is a `sa.Enum(..., native_enum=False,
create_constraint=True)`, which lands as a `VARCHAR` with a `CHECK ... IN
(...)` constraint. Native PG enums cannot have values removed and are awkward
to add to; swapping a CHECK constraint is a three-line migration. The Python
`enum` classes still give type safety in the app layer.

Note that `create_constraint=True` is not the default in SQLAlchemy — without
it you silently get a bare `VARCHAR` with nothing enforcing the values.

**pgvector is enabled in the migration, not only in Docker.**
`docker/postgres/init.sql` runs `CREATE EXTENSION` on first container start,
which covers local development but nothing else. The initial migration opens
with the same statement so any database — CI, staging, a restored dump — gets
the extension before `kb_chunks` is created.

**The vector index is HNSW with `vector_cosine_ops`.**

```sql
CREATE INDEX ix_kb_chunks_embedding_cosine ON kb_chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
```

HNSW rather than IVFFlat because IVFFlat wants representative rows before its
lists are built, and this table starts empty. `vector_cosine_ops` matches the
`<=>` cosine-distance operator, so retrieval must use `<=>` for the index to
be used at all — `<->` (L2) will silently sequential-scan.

**The embedding model is configurable, its width is not.** `EMBEDDING_MODEL`
and `EMBEDDING_DEVICE` are environment variables, because swapping models or
pinning a device changes nothing about the schema. The dimension is different:

**Embedding width is a constant, not an environment variable.**
`EMBEDDING_DIMENSIONS = 1024` lives in
`app/domains/knowledge_base/models.py`. It is baked into the column type, so
it cannot differ between machines without the schema differing too. Changing
it means editing that line and generating a migration that rewrites the column
and rebuilds the index.

**No `updated_at`.** Nothing needs it yet. Adding one is a single column on
`CreatedAtMixin` plus one autogenerated migration.

**`assigned_agent_id` points at `users.id`.** "Agent" is the staff-facing word
for a human handling conversations. The AI agents on the Agents screen are a
different thing, in the `agents` table.

**`kb_tables` is generic rather than four bespoke tables.** Doctors,
Treatments, FAQs and Insurance are editable content, not code — staff will add
"Packages" or "Locations" without wanting a migration, and every category
renders through the same grid. The tradeoff is real: no per-column types, no
constraints, and no foreign key from a row to anything else. When a category
needs to be queried or joined rather than displayed, it has earned its own
table.

**Enum CHECK constraints are excluded from autogenerate.** SQLAlchemy tags the
constraints its `Enum` type generates with a `_create_rule`, and Alembic's
check-constraint comparison ignores metadata constraints that have one. Left
alone it therefore sees each constraint in the database, fails to find it in
the models, and proposes dropping it — quietly removing the validation on every
status column. `alembic/env.py` filters them out by name via `include_name`,
which leaves comparison working for any CHECK constraint written by hand.

---

## Next phases

1. Load the `chatbot KB` CSVs into `kb_tables` so the structured grids show
   real doctors, prices and insurance rather than seeded examples.
2. Upload from the Knowledge Base screen, so ingestion is not CLI-only.
3. Paragraph-aware chunking — a 300-word window currently straddles unrelated
   sections of the 41,000-word categorised KB, which is visible in retrieval.
4. A paid Gemini key — the free tier's 20 requests/day is not a clinic.
5. WhatsAppAdapter, which needs a real webhook and makes the 24-hour reply
   window in the UI functional rather than decorative.
6. Notification *delivery* — Settings → Notifications persists real
   preferences today, but only `notify_new_request` drives anything visible
   (the Topbar bell). The other three are ready for an email/push mechanism
   that doesn't exist yet.
