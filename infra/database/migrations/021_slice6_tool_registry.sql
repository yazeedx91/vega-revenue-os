-- Slice 6: production tool registry (R13) + governed tool execution (R14).
--
-- tool_definitions        — immutable, versioned tool contracts (surrogate PK).
-- tool_invocations        — durable logical execution/audit record.
-- tool_invocation_attempts— durable per-physical-attempt accounting (tri-state).
--
-- Security: ENABLE + FORCE RLS on all tables. Global tool definitions
-- (tenant_id IS NULL) are tenant-readable but NOT tenant-mutable. Contract
-- fields and lifecycle transitions are enforced by DB triggers so direct
-- application SQL cannot bypass the repository.

CREATE SCHEMA IF NOT EXISTS tool_registry;

-- ---------------------------------------------------------------------------
-- tool_definitions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_registry.tool_definitions (
    tool_definition_id   TEXT PRIMARY KEY,
    tool_id              TEXT NOT NULL,
    version              TEXT NOT NULL,
    tenant_id            TEXT,                 -- NULL = global definition
    description          TEXT NOT NULL DEFAULT '',
    input_schema         JSONB,
    output_schema        JSONB,
    required_capabilities TEXT[] NOT NULL DEFAULT '{}',
    risk_category        TEXT NOT NULL,
    side_effect_class    TEXT NOT NULL,        -- READ_ONLY|REVERSIBLE_WRITE|IRREVERSIBLE_EXTERNAL
    required_approval    BOOLEAN NOT NULL DEFAULT FALSE,
    provider_id          TEXT NOT NULL,
    enabled              BOOLEAN NOT NULL DEFAULT TRUE,
    timeout_seconds      INTEGER NOT NULL DEFAULT 30,
    max_retries          INTEGER NOT NULL DEFAULT 0,
    idempotency_required BOOLEAN NOT NULL DEFAULT FALSE,
    cost_metadata        JSONB NOT NULL DEFAULT '{}',
    config               JSONB NOT NULL DEFAULT '{}',
    lifecycle            TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT|ACTIVE|DEPRECATED|RETIRED
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Scope/version uniqueness via partial unique indexes (PK columns cannot be NULL).
CREATE UNIQUE INDEX IF NOT EXISTS tool_definitions_global_unique
    ON tool_registry.tool_definitions (tool_id, version)
    WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tool_definitions_tenant_unique
    ON tool_registry.tool_definitions (tenant_id, tool_id, version)
    WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tool_definitions_lookup
    ON tool_registry.tool_definitions (tool_id, tenant_id, lifecycle);

-- Immutability of contract fields once ACTIVE + forward-only lifecycle.
CREATE OR REPLACE FUNCTION tool_registry.enforce_tool_definition_invariants()
RETURNS trigger AS $$
BEGIN
    -- Forward-only lifecycle: DRAFT→ACTIVE→DEPRECATED→RETIRED.
    IF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN
        IF NOT (
            (OLD.lifecycle = 'DRAFT'      AND NEW.lifecycle = 'ACTIVE')     OR
            (OLD.lifecycle = 'ACTIVE'     AND NEW.lifecycle = 'DEPRECATED') OR
            (OLD.lifecycle = 'DEPRECATED' AND NEW.lifecycle = 'RETIRED')
        ) THEN
            RAISE EXCEPTION 'invalid tool lifecycle transition % -> %', OLD.lifecycle, NEW.lifecycle
                USING ERRCODE = 'raise_exception';
        END IF;
    END IF;

    -- Immutable identity + contract fields once the row has left DRAFT.
    IF OLD.lifecycle <> 'DRAFT' THEN
        IF NEW.tool_id              IS DISTINCT FROM OLD.tool_id
        OR NEW.version              IS DISTINCT FROM OLD.version
        OR NEW.tenant_id            IS DISTINCT FROM OLD.tenant_id
        OR NEW.required_capabilities IS DISTINCT FROM OLD.required_capabilities
        OR NEW.input_schema         IS DISTINCT FROM OLD.input_schema
        OR NEW.output_schema        IS DISTINCT FROM OLD.output_schema
        OR NEW.risk_category        IS DISTINCT FROM OLD.risk_category
        OR NEW.side_effect_class    IS DISTINCT FROM OLD.side_effect_class
        OR NEW.provider_id          IS DISTINCT FROM OLD.provider_id
        OR NEW.required_approval    IS DISTINCT FROM OLD.required_approval
        OR NEW.idempotency_required IS DISTINCT FROM OLD.idempotency_required
        OR NEW.timeout_seconds      IS DISTINCT FROM OLD.timeout_seconds
        OR NEW.max_retries          IS DISTINCT FROM OLD.max_retries
        OR NEW.config               IS DISTINCT FROM OLD.config THEN
            RAISE EXCEPTION 'tool definition contract fields are immutable once lifecycle is %', OLD.lifecycle
                USING ERRCODE = 'raise_exception';
        END IF;
    END IF;

    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tool_definitions_invariants ON tool_registry.tool_definitions;
CREATE TRIGGER tool_definitions_invariants
    BEFORE UPDATE ON tool_registry.tool_definitions
    FOR EACH ROW EXECUTE FUNCTION tool_registry.enforce_tool_definition_invariants();

ALTER TABLE tool_registry.tool_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_registry.tool_definitions FORCE ROW LEVEL SECURITY;

-- Global rows (tenant_id IS NULL) are readable by every tenant; only a
-- tenant's own rows are mutable by the application role. Global definitions
-- are written by the privileged migration/admin identity (bypasses RLS).
DROP POLICY IF EXISTS tool_definitions_tenant_isolation ON tool_registry.tool_definitions;
CREATE POLICY tool_definitions_tenant_isolation ON tool_registry.tool_definitions
    FOR ALL TO projectx_app
    USING (
        tenant_id IS NULL
        OR tenant_id = current_setting('app.current_tenant', TRUE)
    )
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant', TRUE)
    );

-- ---------------------------------------------------------------------------
-- tool_invocations (durable logical execution/audit record)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_registry.tool_invocations (
    tool_call_id       TEXT PRIMARY KEY,
    tool_definition_id TEXT NOT NULL,
    tool_id            TEXT NOT NULL,
    version            TEXT NOT NULL,
    provider_id        TEXT NOT NULL,
    tenant_id          TEXT NOT NULL,
    mission_id         TEXT,
    execution_id       TEXT,
    task_id            TEXT,
    agent_id           TEXT,
    correlation_id     TEXT NOT NULL,
    action             TEXT,
    idempotency_key    TEXT,
    decision           TEXT,
    status             TEXT NOT NULL,          -- SUCCESS|...|OUTCOME_UNKNOWN|FAILED
    audit_id           TEXT,
    started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at       TIMESTAMPTZ,
    error              JSONB,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Defensive consistency invariant for the tool/action-scoped idempotency
-- identity. The AUTHORITATIVE claim lives in IIdempotencyStore; this unique
-- index is a defensive backstop, not a second authority.
CREATE UNIQUE INDEX IF NOT EXISTS tool_invocations_idempotency_unique
    ON tool_registry.tool_invocations (tenant_id, tool_id, action, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS tool_invocations_lookup
    ON tool_registry.tool_invocations (tenant_id, execution_id, tool_id);

ALTER TABLE tool_registry.tool_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_registry.tool_invocations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tool_invocations_tenant_isolation ON tool_registry.tool_invocations;
CREATE POLICY tool_invocations_tenant_isolation ON tool_registry.tool_invocations
    FOR ALL TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

-- ---------------------------------------------------------------------------
-- tool_invocation_attempts (durable per-physical-attempt accounting)
-- ---------------------------------------------------------------------------
-- Tri-state crash-safety: a pre-provider attempt is STARTED with
-- submitted/result_known NULL. `submitted=false` may only be persisted once
-- non-submission is positively known; an incomplete attempt is UNKNOWN, never
-- a fabricated safe failure.
CREATE TABLE IF NOT EXISTS tool_registry.tool_invocation_attempts (
    tenant_id            TEXT NOT NULL,
    tool_call_id         TEXT NOT NULL,
    attempt              INTEGER NOT NULL,
    tool_definition_id   TEXT NOT NULL,
    provider_id          TEXT NOT NULL,
    attempt_status       TEXT NOT NULL DEFAULT 'STARTED', -- STARTED|COMPLETED|FAILED|OUTCOME_UNKNOWN
    submitted            BOOLEAN,                          -- NULL until known
    result_known         BOOLEAN,                          -- NULL until known
    failure_classification TEXT,
    retryable            BOOLEAN,
    provider_request_id  TEXT,
    started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, tool_call_id, attempt)
);

ALTER TABLE tool_registry.tool_invocation_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_registry.tool_invocation_attempts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tool_invocation_attempts_tenant_isolation ON tool_registry.tool_invocation_attempts;
CREATE POLICY tool_invocation_attempts_tenant_isolation ON tool_registry.tool_invocation_attempts
    FOR ALL TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

-- ---------------------------------------------------------------------------
-- Grants (least-privilege DML for the application role)
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA tool_registry TO projectx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tool_registry TO projectx_app;
