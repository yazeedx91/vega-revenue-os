-- Slice 7: Durable Knowledge / Retrieval (R21).
--
-- Multi-level model with real foreign keys and lineage:
--   knowledge.sources          — logical knowledge source (tenant or GLOBAL).
--   knowledge.source_versions  — immutable version of a source (checksum/dedup).
--   knowledge.chunks           — scrubbed canonical chunks (FTS + provenance).
--   knowledge.chunk_embeddings — per-profile vectors (Strategy A, like memory).
--   knowledge.ingestion_runs   — durable ingestion lineage/idempotency record.
--
-- GLOBAL KNOWLEDGE RLS (explicit read-only semantics):
--   SELECT  -> tenant's own rows OR authorized global rows (tenant_id IS NULL).
--   INSERT  -> current-tenant rows only; tenant_id IS NULL is REJECTED.
--   UPDATE  -> current-tenant rows only; cannot read/write global rows.
--   DELETE  -> current-tenant rows only; cannot touch global rows.
-- projectx_app can therefore NEVER create, mutate, or delete global knowledge.
-- Global rows are written only by the privileged migration/admin identity.
--
-- Security: ENABLE + FORCE RLS on every table. Tenant isolation via
-- `tenant_id = current_setting('app.current_tenant', TRUE)`; workspace/ACL is a
-- defense-in-depth predicate applied in the application layer from TRUSTED
-- membership, never from caller-supplied ids.

CREATE SCHEMA IF NOT EXISTS knowledge;

-- ---------------------------------------------------------------------------
-- knowledge.sources
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge.sources (
    source_id    TEXT PRIMARY KEY,
    tenant_id    TEXT,                                  -- NULL = global/system source
    workspace_id TEXT,
    kind         TEXT NOT NULL,                         -- DOCUMENT|URL|FILE|NOTE|...
    title        TEXT NOT NULL,
    uri          TEXT,
    status       TEXT NOT NULL DEFAULT 'ACTIVE',        -- ACTIVE|ARCHIVED|DELETED
    sensitivity  TEXT NOT NULL DEFAULT 'INTERNAL',
    acl          JSONB NOT NULL DEFAULT '{}',           -- access scope descriptor
    current_version_id TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by   TEXT,
    deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS knowledge_sources_lookup
    ON knowledge.sources (tenant_id, workspace_id, status);

ALTER TABLE knowledge.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.sources FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_sources_select ON knowledge.sources;
CREATE POLICY knowledge_sources_select ON knowledge.sources
    FOR SELECT TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE) OR tenant_id IS NULL);

DROP POLICY IF EXISTS knowledge_sources_insert ON knowledge.sources;
CREATE POLICY knowledge_sources_insert ON knowledge.sources
    FOR INSERT TO projectx_app
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

DROP POLICY IF EXISTS knowledge_sources_update ON knowledge.sources;
CREATE POLICY knowledge_sources_update ON knowledge.sources
    FOR UPDATE TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

DROP POLICY IF EXISTS knowledge_sources_delete ON knowledge.sources;
CREATE POLICY knowledge_sources_delete ON knowledge.sources
    FOR DELETE TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE));

-- ---------------------------------------------------------------------------
-- knowledge.source_versions (immutable version + checksum/dedup)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge.source_versions (
    source_version_id TEXT PRIMARY KEY,
    source_id     TEXT NOT NULL REFERENCES knowledge.sources(source_id) ON DELETE CASCADE,
    tenant_id     TEXT,                                  -- denormalized for RLS
    version       INTEGER NOT NULL,
    content_hash  TEXT NOT NULL,                         -- checksum for dedup
    status        TEXT NOT NULL DEFAULT 'ACTIVE',        -- ACTIVE|SUPERSEDED
    ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ingestion_run_id TEXT,
    metadata      JSONB NOT NULL DEFAULT '{}',
    UNIQUE (source_id, version)
);

-- Dedup: a source cannot have two versions with the same content_hash.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_source_versions_dedup
    ON knowledge.source_versions (source_id, content_hash);

ALTER TABLE knowledge.source_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.source_versions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_source_versions_select ON knowledge.source_versions;
CREATE POLICY knowledge_source_versions_select ON knowledge.source_versions
    FOR SELECT TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE) OR tenant_id IS NULL);

DROP POLICY IF EXISTS knowledge_source_versions_insert ON knowledge.source_versions;
CREATE POLICY knowledge_source_versions_insert ON knowledge.source_versions
    FOR INSERT TO projectx_app
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

DROP POLICY IF EXISTS knowledge_source_versions_update ON knowledge.source_versions;
CREATE POLICY knowledge_source_versions_update ON knowledge.source_versions
    FOR UPDATE TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

DROP POLICY IF EXISTS knowledge_source_versions_delete ON knowledge.source_versions;
CREATE POLICY knowledge_source_versions_delete ON knowledge.source_versions
    FOR DELETE TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE));

-- ---------------------------------------------------------------------------
-- knowledge.chunks (scrubbed canonical content + FTS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge.chunks (
    chunk_id         TEXT PRIMARY KEY,
    source_version_id TEXT NOT NULL REFERENCES knowledge.source_versions(source_version_id) ON DELETE CASCADE,
    source_id        TEXT NOT NULL,
    tenant_id        TEXT,
    workspace_id     TEXT,
    seq              INTEGER NOT NULL,
    content          TEXT NOT NULL,                        -- scrubbed canonical ONLY
    content_hash     TEXT NOT NULL,
    content_tsv      TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    sensitivity      TEXT NOT NULL DEFAULT 'INTERNAL',
    acl              JSONB NOT NULL DEFAULT '{}',
    status           TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_version_id, seq)
);

CREATE INDEX IF NOT EXISTS knowledge_chunks_lookup
    ON knowledge.chunks (tenant_id, source_id, status);

CREATE INDEX IF NOT EXISTS knowledge_chunks_tsv
    ON knowledge.chunks USING GIN (content_tsv);

ALTER TABLE knowledge.chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.chunks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_chunks_select ON knowledge.chunks;
CREATE POLICY knowledge_chunks_select ON knowledge.chunks
    FOR SELECT TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE) OR tenant_id IS NULL);

DROP POLICY IF EXISTS knowledge_chunks_insert ON knowledge.chunks;
CREATE POLICY knowledge_chunks_insert ON knowledge.chunks
    FOR INSERT TO projectx_app
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

DROP POLICY IF EXISTS knowledge_chunks_update ON knowledge.chunks;
CREATE POLICY knowledge_chunks_update ON knowledge.chunks
    FOR UPDATE TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

DROP POLICY IF EXISTS knowledge_chunks_delete ON knowledge.chunks;
CREATE POLICY knowledge_chunks_delete ON knowledge.chunks
    FOR DELETE TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE));

-- ---------------------------------------------------------------------------
-- knowledge.chunk_embeddings (per-profile vectors, Strategy A)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge.chunk_embeddings (
    chunk_id             TEXT NOT NULL REFERENCES knowledge.chunks(chunk_id) ON DELETE CASCADE,
    embedding_profile_id TEXT NOT NULL,
    tenant_id            TEXT,
    embedding            vector,                           -- untyped; per-profile partial index casts
    embedding_dim        INTEGER NOT NULL,
    content_hash         TEXT NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chunk_id, embedding_profile_id),
    CONSTRAINT chunk_embeddings_dim_match
        CHECK (embedding IS NULL OR vector_dims(embedding) = embedding_dim)
);

CREATE INDEX IF NOT EXISTS knowledge_chunk_embeddings_profile
    ON knowledge.chunk_embeddings (embedding_profile_id, tenant_id);

ALTER TABLE knowledge.chunk_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.chunk_embeddings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_chunk_embeddings_select ON knowledge.chunk_embeddings;
CREATE POLICY knowledge_chunk_embeddings_select ON knowledge.chunk_embeddings
    FOR SELECT TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE) OR tenant_id IS NULL);

DROP POLICY IF EXISTS knowledge_chunk_embeddings_insert ON knowledge.chunk_embeddings;
CREATE POLICY knowledge_chunk_embeddings_insert ON knowledge.chunk_embeddings
    FOR INSERT TO projectx_app
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

DROP POLICY IF EXISTS knowledge_chunk_embeddings_delete ON knowledge.chunk_embeddings;
CREATE POLICY knowledge_chunk_embeddings_delete ON knowledge.chunk_embeddings
    FOR DELETE TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE));

-- Create the per-profile partial HNSW index for chunk embeddings. Called by the
-- privileged identity when a profile is promoted to READY/ACTIVE.
CREATE OR REPLACE FUNCTION knowledge.ensure_chunk_embedding_index(p_profile_id TEXT, p_dim INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    idx_name TEXT := 'chunk_emb_' || replace(p_profile_id, '-', '_') || '_hnsw';
BEGIN
    EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON knowledge.chunk_embeddings USING hnsw ((embedding::vector(%s)) vector_cosine_ops) WHERE embedding_profile_id = %L',
        idx_name, p_dim, p_profile_id
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- knowledge.ingestion_runs (durable lineage + idempotency)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge.ingestion_runs (
    ingestion_run_id TEXT PRIMARY KEY,
    tenant_id        TEXT,
    source_id        TEXT NOT NULL,
    source_version_id TEXT,
    idempotency_key  TEXT,
    status           TEXT NOT NULL DEFAULT 'RUNNING',      -- RUNNING|COMPLETED|FAILED|PARTIAL
    trigger_kind     TEXT,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at     TIMESTAMPTZ,
    error            JSONB,
    stats            JSONB NOT NULL DEFAULT '{}',
    correlation_id   TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_ingestion_runs_idem
    ON knowledge.ingestion_runs (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

ALTER TABLE knowledge.ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.ingestion_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_ingestion_runs_select ON knowledge.ingestion_runs;
CREATE POLICY knowledge_ingestion_runs_select ON knowledge.ingestion_runs
    FOR SELECT TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE) OR tenant_id IS NULL);

DROP POLICY IF EXISTS knowledge_ingestion_runs_insert ON knowledge.ingestion_runs;
CREATE POLICY knowledge_ingestion_runs_insert ON knowledge.ingestion_runs
    FOR INSERT TO projectx_app
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

DROP POLICY IF EXISTS knowledge_ingestion_runs_update ON knowledge.ingestion_runs;
CREATE POLICY knowledge_ingestion_runs_update ON knowledge.ingestion_runs
    FOR UPDATE TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA knowledge TO projectx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA knowledge TO projectx_app;
