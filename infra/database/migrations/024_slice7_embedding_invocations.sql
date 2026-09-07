-- Slice 7: embedding invocation accounting.
--
-- Embedding usage is accounted in its own ledger rather than the LLM-specific
-- ai_runtime.llm_invocations table (which requires mission/execution/llm_call
-- fields that do not apply to embeddings). Tenant-scoped with FORCE RLS.

CREATE TABLE IF NOT EXISTS embedding.invocations (
    invocation_id        TEXT PRIMARY KEY,
    tenant_id            TEXT NOT NULL,
    provider_id          TEXT NOT NULL,
    embedding_profile_id TEXT NOT NULL,
    vector_space         TEXT NOT NULL,
    model_id             TEXT NOT NULL,
    model_version        TEXT NOT NULL,
    dimensions           INTEGER NOT NULL,
    vector_count         INTEGER NOT NULL,
    status               TEXT NOT NULL,                 -- SUCCEEDED|FAILED
    input_tokens         INTEGER,
    cost_usd             NUMERIC,
    latency_ms           INTEGER,
    correlation_id       TEXT,
    idempotency_key      TEXT,
    recorded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS embedding_invocations_lookup
    ON embedding.invocations (tenant_id, recorded_at);

ALTER TABLE embedding.invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE embedding.invocations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS embedding_invocations_tenant_isolation ON embedding.invocations;
CREATE POLICY embedding_invocations_tenant_isolation ON embedding.invocations
    FOR ALL TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

GRANT SELECT, INSERT ON embedding.invocations TO projectx_app;
