-- Phase 14 Milestone 7b — Controlled communication enablement
-- Graph webhook subscription lifecycle state and operational telemetry storage.

CREATE TABLE IF NOT EXISTS outreach.graph_subscriptions (
    tenant_id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    resource TEXT NOT NULL,
    notification_url TEXT NOT NULL,
    client_state TEXT NOT NULL,
    expiration_date_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_graph_subscriptions_tenant
    ON outreach.graph_subscriptions (tenant_id, created_at DESC);

ALTER TABLE outreach.graph_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_graph_subscriptions
    ON outreach.graph_subscriptions
    USING (tenant_id = current_setting('app.current_tenant', TRUE));
