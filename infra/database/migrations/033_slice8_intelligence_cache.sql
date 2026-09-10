CREATE TABLE intelligence.research_cache (
    tenant_id    TEXT NOT NULL,
    query_hash   VARCHAR(256) NOT NULL,
    workspace_id UUID NOT NULL,
    result_value JSONB NOT NULL,
    provider_id  TEXT NOT NULL,
    cached_at    TIMESTAMPTZ NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (tenant_id, query_hash),
    FOREIGN KEY (tenant_id, workspace_id)
        REFERENCES identity.workspaces (tenant_id, id),
    CHECK (expires_at > cached_at)
);

CREATE INDEX research_cache_expiry ON intelligence.research_cache (expires_at);

ALTER TABLE intelligence.research_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence.research_cache FORCE ROW LEVEL SECURITY;

CREATE POLICY research_cache_tenant_isolation ON intelligence.research_cache
    FOR ALL TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

GRANT SELECT, INSERT, UPDATE, DELETE ON intelligence.research_cache TO projectx_app;
