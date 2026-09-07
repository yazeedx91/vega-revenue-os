-- Slice 7: Durable Memory (R20) + shared embedding profile registry.
--
-- embedding.embedding_profiles — global/system registry of EXACT vector spaces.
--   A profile pins provider + model + model_version + dimensions + distance.
--   It is the authoritative identity of a vector space: query embeddings and
--   stored embeddings must always belong to the SAME active profile. There is
--   NO cross-provider/cross-model fallback — identical dimensionality does NOT
--   imply a compatible vector space.
--
-- memory.entries            — immutable, versioned durable memory (canonical
--                             scrubbed content only; never raw CoT/unsafe text).
-- memory.memory_embeddings  — per-profile vectors, physically separated so a
--                             profile migration never rewrites prior vectors.
-- memory.write_requests     — write-policy audit; stores the candidate HASH and
--                             decision, never the raw candidate content.
--
-- Vector storage strategy (Strategy A): the embeddings column is an untyped
-- `vector` so multiple dimensions can coexist across profiles. Each ACTIVE
-- profile gets its own partial HNSW index that casts to its exact dimension
-- (`embedding::vector(<dim>)`) restricted by `WHERE embedding_profile_id = ...`.
-- A row whose stored dimension does not match its profile fails the index cast
-- on write, so an incompatible vector can never be persisted under a profile.
--
-- Security: ENABLE + FORCE RLS on every tenant table. Tenant isolation is
-- enforced by `tenant_id = current_setting('app.current_tenant', TRUE)`.
-- Workspace isolation is a defense-in-depth predicate applied in the
-- application layer from TRUSTED membership (never caller-supplied ids).
-- embedding_profiles is a global registry: readable by all tenants, writable
-- ONLY by the privileged migration/admin identity (projectx_app has SELECT
-- but no INSERT/UPDATE/DELETE).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS embedding;
CREATE SCHEMA IF NOT EXISTS memory;

-- ---------------------------------------------------------------------------
-- embedding.embedding_profiles (global vector-space registry)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS embedding.embedding_profiles (
    embedding_profile_id TEXT PRIMARY KEY,
    provider_id          TEXT NOT NULL,
    model_id             TEXT NOT NULL,
    model_version        TEXT NOT NULL,
    dimensions           INTEGER NOT NULL,
    distance_metric      TEXT NOT NULL DEFAULT 'cosine',  -- cosine|l2|ip
    -- Canonical vector-space identity. Two profiles are compatible ONLY when
    -- every component matches; dimension equality alone is NOT compatibility.
    vector_space         TEXT NOT NULL,                   -- e.g. openai:text-embedding-3-small:v1:1536:cosine
    lifecycle            TEXT NOT NULL DEFAULT 'DRAFT',   -- DRAFT|INDEXING|READY|ACTIVE|DRAINING|RETIRED
    is_active            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    promoted_at          TIMESTAMPTZ,
    retired_at           TIMESTAMPTZ
);

-- At most one ACTIVE profile for the deployment (the single live vector space).
CREATE UNIQUE INDEX IF NOT EXISTS embedding_profiles_single_active
    ON embedding.embedding_profiles (is_active)
    WHERE is_active;

-- Vector-space identity is unique: the same provider/model/version/dim/metric
-- cannot be registered under two profile ids.
CREATE UNIQUE INDEX IF NOT EXISTS embedding_profiles_vector_space_unique
    ON embedding.embedding_profiles (vector_space);

-- Forward-only lifecycle + immutable vector-space identity once INDEXING.
CREATE OR REPLACE FUNCTION embedding.enforce_profile_invariants()
RETURNS trigger AS $$
BEGIN
    IF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN
        IF NOT (
            (OLD.lifecycle = 'DRAFT'    AND NEW.lifecycle = 'INDEXING') OR
            (OLD.lifecycle = 'INDEXING' AND NEW.lifecycle = 'READY')    OR
            (OLD.lifecycle = 'READY'    AND NEW.lifecycle = 'ACTIVE')   OR
            (OLD.lifecycle = 'ACTIVE'   AND NEW.lifecycle = 'DRAINING') OR
            (OLD.lifecycle = 'DRAINING' AND NEW.lifecycle = 'RETIRED')
        ) THEN
            RAISE EXCEPTION 'invalid embedding profile lifecycle transition % -> %', OLD.lifecycle, NEW.lifecycle
                USING ERRCODE = 'raise_exception';
        END IF;
    END IF;

    -- Once a profile has left DRAFT its vector-space identity is immutable.
    IF OLD.lifecycle <> 'DRAFT' THEN
        IF NEW.provider_id   IS DISTINCT FROM OLD.provider_id
        OR NEW.model_id      IS DISTINCT FROM OLD.model_id
        OR NEW.model_version IS DISTINCT FROM OLD.model_version
        OR NEW.dimensions    IS DISTINCT FROM OLD.dimensions
        OR NEW.distance_metric IS DISTINCT FROM OLD.distance_metric
        OR NEW.vector_space  IS DISTINCT FROM OLD.vector_space THEN
            RAISE EXCEPTION 'embedding profile vector-space identity is immutable once lifecycle is %', OLD.lifecycle
                USING ERRCODE = 'raise_exception';
        END IF;
    END IF;

    -- is_active mirrors lifecycle = ACTIVE.
    IF NEW.lifecycle = 'ACTIVE' THEN
        NEW.is_active := TRUE;
        NEW.promoted_at := COALESCE(NEW.promoted_at, NOW());
    ELSE
        NEW.is_active := FALSE;
    END IF;
    IF NEW.lifecycle = 'RETIRED' THEN
        NEW.retired_at := COALESCE(NEW.retired_at, NOW());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS embedding_profiles_invariants ON embedding.embedding_profiles;
CREATE TRIGGER embedding_profiles_invariants
    BEFORE UPDATE ON embedding.embedding_profiles
    FOR EACH ROW EXECUTE FUNCTION embedding.enforce_profile_invariants();

ALTER TABLE embedding.embedding_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE embedding.embedding_profiles FORCE ROW LEVEL SECURITY;

-- Global registry: every tenant may READ the active profile, but projectx_app
-- can NEVER create, mutate, or delete profiles (admin/migration identity only).
DROP POLICY IF EXISTS embedding_profiles_read ON embedding.embedding_profiles;
CREATE POLICY embedding_profiles_read ON embedding.embedding_profiles
    FOR SELECT TO projectx_app
    USING (TRUE);
-- No INSERT/UPDATE/DELETE policy for projectx_app => writes are denied.

-- ---------------------------------------------------------------------------
-- memory.entries (immutable, versioned durable memory)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory.entries (
    memory_id        TEXT NOT NULL,
    tenant_id        TEXT NOT NULL,
    workspace_id     TEXT,                                  -- NULL = tenant scope
    agent_id         TEXT,                                  -- NULL = not agent-bound
    type             TEXT NOT NULL,                         -- EPISODIC|SEMANTIC|PROCEDURAL
    subject_kind     TEXT,                                  -- AGENT|MISSION|ENTITY|CONVERSATION|...
    subject_id       TEXT,
    content          TEXT NOT NULL,                         -- scrubbed canonical content ONLY
    content_hash     TEXT NOT NULL,
    content_tsv      TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    version          INTEGER NOT NULL,
    status           TEXT NOT NULL DEFAULT 'ACTIVE',        -- ACTIVE|SUPERSEDED|RETRACTED|EXPIRED
    sensitivity      TEXT NOT NULL DEFAULT 'INTERNAL',      -- PUBLIC|INTERNAL|CONFIDENTIAL|RESTRICTED
    confidence       NUMERIC,
    provenance       JSONB NOT NULL DEFAULT '{}',
    source_execution_id   TEXT,
    source_correlation_id TEXT,
    observed_at      TIMESTAMPTZ,
    expires_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by       TEXT,
    supersedes       TEXT,                                  -- prior memory_id superseded by this version
    PRIMARY KEY (tenant_id, memory_id, version)
);

-- A memory has at most one ACTIVE (current) version.
CREATE UNIQUE INDEX IF NOT EXISTS memory_entries_single_active
    ON memory.entries (tenant_id, memory_id)
    WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS memory_entries_lookup
    ON memory.entries (tenant_id, agent_id, type, status);

CREATE INDEX IF NOT EXISTS memory_entries_workspace
    ON memory.entries (tenant_id, workspace_id, status);

CREATE INDEX IF NOT EXISTS memory_entries_tsv
    ON memory.entries USING GIN (content_tsv);

ALTER TABLE memory.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory.entries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_entries_tenant_isolation ON memory.entries;
CREATE POLICY memory_entries_tenant_isolation ON memory.entries
    FOR ALL TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

-- ---------------------------------------------------------------------------
-- memory.memory_embeddings (per-profile vectors, physically separated)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory.memory_embeddings (
    tenant_id            TEXT NOT NULL,
    memory_id            TEXT NOT NULL,
    version              INTEGER NOT NULL,
    embedding_profile_id TEXT NOT NULL,
    embedding            vector,                            -- untyped; per-profile partial index casts
    embedding_dim        INTEGER NOT NULL,
    content_hash         TEXT NOT NULL,                     -- dedup: same profile+content_hash
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, memory_id, version, embedding_profile_id),
    FOREIGN KEY (tenant_id, memory_id, version)
        REFERENCES memory.entries (tenant_id, memory_id, version) ON DELETE CASCADE,
    -- Stored vector dimension must match the declared profile dimension column.
    CONSTRAINT memory_embeddings_dim_match
        CHECK (embedding IS NULL OR vector_dims(embedding) = embedding_dim)
);

CREATE INDEX IF NOT EXISTS memory_embeddings_profile
    ON memory.memory_embeddings (embedding_profile_id, tenant_id);

ALTER TABLE memory.memory_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory.memory_embeddings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_embeddings_tenant_isolation ON memory.memory_embeddings;
CREATE POLICY memory_embeddings_tenant_isolation ON memory.memory_embeddings
    FOR ALL TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

-- Create the per-profile partial HNSW index for memory embeddings. Called by
-- the privileged identity when a profile is promoted to READY/ACTIVE. The cast
-- `embedding::vector(p_dim)` makes the index physically reject any stored
-- vector whose dimension differs from the profile's.
CREATE OR REPLACE FUNCTION memory.ensure_embedding_index(p_profile_id TEXT, p_dim INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    idx_name TEXT := 'mem_emb_' || replace(p_profile_id, '-', '_') || '_hnsw';
BEGIN
    EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON memory.memory_embeddings USING hnsw ((embedding::vector(%s)) vector_cosine_ops) WHERE embedding_profile_id = %L',
        idx_name, p_dim, p_profile_id
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- memory.write_requests (write-policy audit; candidate HASH only, never raw)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory.write_requests (
    write_request_id TEXT PRIMARY KEY,
    tenant_id        TEXT NOT NULL,
    idempotency_key  TEXT,
    agent_id         TEXT,
    workspace_id     TEXT,
    type             TEXT,
    decision         TEXT NOT NULL,                          -- ACCEPTED|REJECTED|QUARANTINED
    rejection_reason TEXT,
    content_hash     TEXT,                                   -- hash of candidate, never raw content
    memory_id        TEXT,                                   -- resulting memory when accepted
    version          INTEGER,
    correlation_id   TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Defensive idempotency backstop (authoritative claim lives in IIdempotencyStore).
CREATE UNIQUE INDEX IF NOT EXISTS memory_write_requests_idem
    ON memory.write_requests (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

ALTER TABLE memory.write_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory.write_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_write_requests_tenant_isolation ON memory.write_requests;
CREATE POLICY memory_write_requests_tenant_isolation ON memory.write_requests
    FOR ALL TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

-- ---------------------------------------------------------------------------
-- Grants (least-privilege DML for the application role)
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA embedding TO projectx_app;
GRANT USAGE ON SCHEMA memory TO projectx_app;
GRANT SELECT ON embedding.embedding_profiles TO projectx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA memory TO projectx_app;
