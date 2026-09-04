-- Slice 5 LLM runtime persistence
-- Provides safe reasoning artifact and invocation accounting tables.

CREATE SCHEMA IF NOT EXISTS ai_runtime;

CREATE TABLE IF NOT EXISTS ai_runtime.reasoning_artifacts (
    tenant_id TEXT NOT NULL,
    mission_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    agent_version TEXT,
    capability TEXT,
    correlation_id TEXT NOT NULL,
    idempotency_key TEXT,
    rationale TEXT NOT NULL,
    conclusion TEXT NOT NULL,
    confidence NUMERIC NOT NULL,
    evidence JSONB NOT NULL DEFAULT '[]',
    required_approvals JSONB,
    proposed_actions JSONB,
    assumptions JSONB,
    model_usage JSONB NOT NULL,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    provider_request_id TEXT NOT NULL,
    latency_ms INTEGER NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, execution_id, provider_request_id, recorded_at)
);

ALTER TABLE ai_runtime.reasoning_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_runtime.reasoning_artifacts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_reasoning_artifacts ON ai_runtime.reasoning_artifacts;
CREATE POLICY tenant_isolation_reasoning_artifacts
    ON ai_runtime.reasoning_artifacts
    USING (tenant_id = current_setting('app.current_tenant', TRUE));

CREATE TABLE IF NOT EXISTS ai_runtime.llm_invocations (
    tenant_id TEXT NOT NULL,
    mission_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    provider_request_id TEXT NOT NULL,
    capability TEXT,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,
    cost_usd NUMERIC NOT NULL,
    latency_ms INTEGER NOT NULL,
    correlation_id TEXT NOT NULL,
    idempotency_key TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, execution_id, provider_request_id, recorded_at)
);

ALTER TABLE ai_runtime.llm_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_runtime.llm_invocations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_llm_invocations ON ai_runtime.llm_invocations;
CREATE POLICY tenant_isolation_llm_invocations
    ON ai_runtime.llm_invocations
    USING (tenant_id = current_setting('app.current_tenant', TRUE));

GRANT USAGE ON SCHEMA ai_runtime TO projectx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ai_runtime TO projectx_app;
