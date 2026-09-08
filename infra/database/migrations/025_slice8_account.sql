-- Slice 8B1a: Account persistence schema with workspace-safe dedup.
--
-- Account identity is workspace-private. The canonical dedup boundary is:
--   tenant_id + workspace_id + normalized_domain
--
-- Same normalized company domain may legitimately exist in two different
-- authorized workspaces. The UNIQUE index uses WHERE normalized_domain IS NOT
-- NULL so multiple domain-less accounts remain possible.
--
-- Security: ENABLE + FORCE RLS. Tenant isolation via
-- current_setting('app.current_tenant', TRUE).

CREATE SCHEMA IF NOT EXISTS intelligence;

CREATE TABLE IF NOT EXISTS intelligence.accounts (
    account_id        TEXT NOT NULL PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    workspace_id      UUID NOT NULL REFERENCES identity.workspaces(id),
    name              TEXT NOT NULL,
    domain            TEXT,
    normalized_domain TEXT,
    aliases           JSONB NOT NULL DEFAULT '[]',
    industry          TEXT,
    geography         TEXT,
    company_size_band TEXT,
    employee_count    INTEGER,
    annual_revenue_usd NUMERIC,
    territories       JSONB NOT NULL DEFAULT '[]',
    tech_stack        JSONB NOT NULL DEFAULT '[]',
    enrichment_state  TEXT NOT NULL DEFAULT 'NONE',
    status            TEXT NOT NULL DEFAULT 'DISCOVERED',
    duplicate_of      TEXT,
    evidence_references JSONB NOT NULL DEFAULT '[]',
    account_version   INTEGER NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Bounded enum values from frozen Account aggregate
    CONSTRAINT accounts_status_check CHECK (
        status IN ('DISCOVERED', 'ENRICHED', 'QUALIFIED', 'DISQUALIFIED', 'DUPLICATE')
    ),
    CONSTRAINT accounts_enrichment_state_check CHECK (
        enrichment_state IN ('NONE', 'PARTIAL', 'COMPLETE')
    ),
    CONSTRAINT accounts_company_size_band_check CHECK (
        company_size_band IS NULL OR company_size_band IN ('STARTUP', 'SMB', 'MID_MARKET', 'ENTERPRISE')
    ),
    CONSTRAINT accounts_version_positive CHECK (
        account_version >= 1
    )
);

-- Workspace-private dedup: same normalized_domain cannot exist twice within
-- the same tenant + workspace. NULL domains are excluded (multiple domain-less
-- accounts are allowed).
CREATE UNIQUE INDEX IF NOT EXISTS accounts_workspace_domain_dedup
    ON intelligence.accounts (tenant_id, workspace_id, normalized_domain)
    WHERE normalized_domain IS NOT NULL;

-- Lookup by tenant + workspace for list queries
CREATE INDEX IF NOT EXISTS accounts_tenant_workspace
    ON intelligence.accounts (tenant_id, workspace_id, status);

-- RLS: tenant isolation
ALTER TABLE intelligence.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence.accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounts_tenant_isolation ON intelligence.accounts;
CREATE POLICY accounts_tenant_isolation ON intelligence.accounts
    FOR ALL TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

-- Grants (least-privilege DML for application role)
GRANT USAGE ON SCHEMA intelligence TO projectx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE intelligence.accounts TO projectx_app;
