-- Phase 14 initial persistence schema
-- PostgreSQL 15+
-- Tenant-scoped tables with row-level security policies.

CREATE SCHEMA IF NOT EXISTS outreach;
CREATE SCHEMA IF NOT EXISTS conversation;
CREATE SCHEMA IF NOT EXISTS mission;
CREATE SCHEMA IF NOT EXISTS intelligence;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS idempotency;

-- Application role used by services/tests so row-level security is enforced.
-- The integration superuser (projectx) is only for schema setup/migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'projectx_app') THEN
    CREATE ROLE projectx_app WITH LOGIN PASSWORD 'projectx_app';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA outreach, conversation, mission, intelligence, audit, idempotency TO projectx_app;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Tenant configuration
CREATE TABLE outreach.tenant_email_config (
    tenant_id TEXT NOT NULL,
    provider_id TEXT NOT NULL DEFAULT 'graph-email',
    channel TEXT NOT NULL DEFAULT 'email',
    from_address TEXT NOT NULL,
    reply_to_address TEXT,
    graph_tenant_id TEXT,
    graph_client_id TEXT,
    graph_client_secret_reference TEXT, -- Key Vault reference name
    graph_certificate_reference TEXT,
    allowed_domains TEXT[] DEFAULT '{}',
    webhook_secret_reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, provider_id)
);

CREATE TABLE outreach.allowed_recipients (
    tenant_id TEXT NOT NULL,
    email_address TEXT NOT NULL,
    display_name TEXT,
    approved_by TEXT NOT NULL,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason TEXT,
    PRIMARY KEY (tenant_id, email_address)
);

CREATE TABLE outreach.suppression (
    tenant_id TEXT NOT NULL,
    email_address TEXT NOT NULL,
    suppression_type TEXT NOT NULL, -- OPT_OUT, BOUNCE, COMPLAINT, MANUAL
    source TEXT NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, email_address)
);

CREATE TABLE outreach.campaigns (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INT NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE outreach.sequences (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INT NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE outreach.message_executions (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INT NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE conversation.conversations (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INT NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE mission.missions (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INT NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE mission.approvals (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INT NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE intelligence.leads (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INT NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, id)
);

-- Events (append-only)
CREATE TABLE audit.domain_events (
    event_id TEXT NOT NULL PRIMARY KEY,
    event_type TEXT NOT NULL,
    event_version TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    tenant_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    causation_id TEXT,
    producer TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_domain_events_tenant_occurred ON audit.domain_events (tenant_id, occurred_at);
CREATE INDEX idx_domain_events_correlation ON audit.domain_events (correlation_id);

CREATE TABLE audit.integration_events (
    event_id TEXT NOT NULL PRIMARY KEY,
    event_type TEXT NOT NULL,
    event_version TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    tenant_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    causation_id TEXT,
    producer TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_integration_events_tenant_occurred ON audit.integration_events (tenant_id, occurred_at);

-- Audit log (append-only)
CREATE TABLE audit.audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    actor JSONB,
    result TEXT NOT NULL,
    reason TEXT,
    metadata JSONB,
    correlation_id TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_tenant ON audit.audit_log (tenant_id, occurred_at);
CREATE INDEX idx_audit_log_resource ON audit.audit_log (resource_type, resource_id);

-- Idempotency store
CREATE TABLE idempotency.keys (
    tenant_id TEXT NOT NULL,
    key TEXT NOT NULL,
    scope TEXT NOT NULL,
    status TEXT NOT NULL, -- PENDING, COMPLETED, FAILED
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (tenant_id, key, scope)
);

CREATE INDEX idx_idempotency_expires ON idempotency.keys (expires_at);

-- Row-level security
ALTER TABLE outreach.tenant_email_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach.allowed_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach.suppression ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach.sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach.message_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission.missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency.keys ENABLE ROW LEVEL SECURITY;

ALTER TABLE outreach.tenant_email_config FORCE ROW LEVEL SECURITY;
ALTER TABLE outreach.allowed_recipients FORCE ROW LEVEL SECURITY;
ALTER TABLE outreach.suppression FORCE ROW LEVEL SECURITY;
ALTER TABLE outreach.campaigns FORCE ROW LEVEL SECURITY;
ALTER TABLE outreach.sequences FORCE ROW LEVEL SECURITY;
ALTER TABLE outreach.message_executions FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation.conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE mission.missions FORCE ROW LEVEL SECURITY;
ALTER TABLE mission.approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE intelligence.leads FORCE ROW LEVEL SECURITY;
ALTER TABLE audit.domain_events FORCE ROW LEVEL SECURITY;
ALTER TABLE audit.integration_events FORCE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency.keys FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_outreach_config ON outreach.tenant_email_config USING (tenant_id = current_setting('app.current_tenant', TRUE));
CREATE POLICY tenant_isolation_allowed_recipients ON outreach.allowed_recipients USING (tenant_id = current_setting('app.current_tenant', TRUE));
CREATE POLICY tenant_isolation_suppression ON outreach.suppression USING (tenant_id = current_setting('app.current_tenant', TRUE));
CREATE POLICY tenant_isolation_campaigns ON outreach.campaigns USING (tenant_id = current_setting('app.current_tenant', TRUE));
CREATE POLICY tenant_isolation_sequences ON outreach.sequences USING (tenant_id = current_setting('app.current_tenant', TRUE));
CREATE POLICY tenant_isolation_message_executions ON outreach.message_executions USING (tenant_id = current_setting('app.current_tenant', TRUE));
CREATE POLICY tenant_isolation_conversations ON conversation.conversations USING (tenant_id = current_setting('app.current_tenant', TRUE));
CREATE POLICY tenant_isolation_missions ON mission.missions USING (tenant_id = current_setting('app.current_tenant', TRUE));
CREATE POLICY tenant_isolation_approvals ON mission.approvals USING (tenant_id = current_setting('app.current_tenant', TRUE));
CREATE POLICY tenant_isolation_leads ON intelligence.leads USING (tenant_id = current_setting('app.current_tenant', TRUE));
CREATE POLICY tenant_isolation_domain_events ON audit.domain_events USING (tenant_id = current_setting('app.current_tenant', TRUE));
CREATE POLICY tenant_isolation_integration_events ON audit.integration_events USING (tenant_id = current_setting('app.current_tenant', TRUE));
CREATE POLICY tenant_isolation_audit_log ON audit.audit_log USING (tenant_id = current_setting('app.current_tenant', TRUE));
CREATE POLICY tenant_isolation_idempotency ON idempotency.keys USING (tenant_id = current_setting('app.current_tenant', TRUE));

-- Application role DML privileges (must be granted after objects are created)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA outreach, conversation, mission, intelligence, audit, idempotency TO projectx_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA outreach, conversation, mission, intelligence, audit, idempotency TO projectx_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO projectx_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA outreach, conversation, mission, intelligence, audit, idempotency
  GRANT ALL PRIVILEGES ON TABLES TO projectx_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA outreach, conversation, mission, intelligence, audit, idempotency
  GRANT ALL PRIVILEGES ON SEQUENCES TO projectx_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO projectx_app;
