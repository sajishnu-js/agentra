-- Runs once, on first container start, against the POSTGRES_DB database.
-- Enables pgvector so knowledge_base embeddings work out of the box.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
