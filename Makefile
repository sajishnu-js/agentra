# Agentra — one place for the commands you run every day.
#
# Uses `docker compose` when the CLI plugin is installed and falls back to the
# standalone `docker-compose` binary otherwise.
COMPOSE := $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")
PY := backend/.venv/bin/python
PIP := backend/.venv/bin/pip

.PHONY: help up down reset logs api web install migrate revision seed check \
        pg-local-up pg-local-down redis-local-up redis-local-down \
        ingest search bot worker

help:
	@echo "make install   install backend venv + frontend node_modules"
	@echo "make up        start Postgres (pgvector) + Redis"
	@echo "make down      stop containers, keep data"
	@echo "make reset     stop containers and wipe volumes"
	@echo "make logs      tail container logs"
	@echo "make api       run FastAPI on :8000 with reload"
	@echo "make web       run Vite on :5173"
	@echo "make migrate   apply Alembic migrations"
	@echo "make revision  autogenerate a migration (m=\"message\")"
	@echo "make seed      wipe and reload realistic fake data (local only)"
	@echo "make ingest    ingest .docx/.pdf from a folder (dir=..., reset=1)"
	@echo "make search    retrieval test (q=\"your question\")"
	@echo "make bot       run the Telegram long-polling listener"
	@echo "make worker    run the RQ worker (does the real work)"
	@echo "make check     typecheck + build the frontend"
	@echo ""
	@echo "Fallback while Docker is unreachable — local Homebrew Postgres 17:"
	@echo "make pg-local-up    start PG17 on :5433"
	@echo "make pg-local-down  stop it"

install:
	python3.12 -m venv backend/.venv
	$(PIP) install --upgrade pip
	$(PIP) install -r backend/requirements.txt
	cd frontend && npm install
	@test -f backend/.env || cp backend/.env.example backend/.env

up:
	$(COMPOSE) up -d
	@echo "Postgres → localhost:5433   Redis → localhost:6380"

down:
	$(COMPOSE) down

reset:
	$(COMPOSE) down -v

logs:
	$(COMPOSE) logs -f

api:
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

web:
	cd frontend && npm run dev

migrate:
	cd backend && .venv/bin/alembic upgrade head

revision:
	@test -n "$(m)" || (echo 'usage: make revision m="add contacts table"'; exit 1)
	cd backend && .venv/bin/alembic revision --autogenerate -m "$(m)"

seed:
	cd backend && .venv/bin/python -m app.seed

# Knowledge base ingestion. Everything runs locally — no LLM, no API key.
#   make ingest dir=~/Desktop/"chatbot KB"
#   make ingest dir=./docs reset=1      wipe existing documents first
#   make ingest dir=./docs force=1      re-embed even if unchanged
ingest:
	@test -n "$(dir)" || (echo 'usage: make ingest dir=/path/to/folder [reset=1] [force=1]'; exit 1)
	cd backend && .venv/bin/python -m app.ingest "$(abspath $(dir))" \
		$(if $(reset),--reset,) $(if $(force),--force,)

# The live message pipeline. Two processes: `bot` only enqueues, `worker` does
# everything else. Run both, plus `api` and `web` to watch it land.
bot:
	cd backend && .venv/bin/python -m app.telegram_bot

worker:
	cd backend && .venv/bin/python -m app.worker

#   make search q="How much is laser hair removal?"
search:
	@test -n "$(q)" || (echo 'usage: make search q="your question" [limit=5]'; exit 1)
	cd backend && .venv/bin/python -m app.search "$(q)" $(if $(limit),--limit $(limit),)

check:
	cd frontend && npm run build

# --- Local Postgres 17 fallback -------------------------------------------
# Used only while the Docker daemon is unreachable. Same major version and
# port as the pgvector/pgvector:pg17 container, so DATABASE_URL is identical
# either way. Does not touch the Postgres 16 on :5432.
PG17 := /opt/homebrew/opt/postgresql@17/bin
PGDATA := /opt/homebrew/var/postgresql@17

pg-local-up:
	$(PG17)/pg_ctl -D $(PGDATA) -l /opt/homebrew/var/log/postgresql@17.log start || true
	@$(PG17)/psql -h localhost -p 5433 -d agentra -U agentra -tAc \
		"select 'pgvector ' || extversion from pg_extension where extname='vector'"

pg-local-down:
	$(PG17)/pg_ctl -D $(PGDATA) stop

# --- Local Redis fallback ---------------------------------------------------
# Same reason as pg-local-up: the Compose Redis is unreachable. Port 6380 to
# match REDIS_URL and the compose file, and no persistence — a queue that
# survives a restart is not wanted here.
redis-local-up:
	redis-server --port 6380 --daemonize yes --save '' --appendonly no
	@redis-cli -p 6380 ping

redis-local-down:
	-redis-cli -p 6380 shutdown nosave
