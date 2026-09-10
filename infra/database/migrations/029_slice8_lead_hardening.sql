-- Slice 8 lead hardening — workspace-aware, ICP-version pinned, qualification snapshot persisted.
--
-- Do not modify 001_phase14_initial.sql; this is a forward-only migration.
--
-- Security: RLS already enabled in 001; this migration only adds columns and
-- foreign keys. Repository queries include workspace_id in WHERE clauses.

ALTER TABLE intelligence.leads
    ADD COLUMN IF NOT EXISTS workspace_id UUID,
    ADD COLUMN IF NOT EXISTS account_id TEXT,
    ADD COLUMN IF NOT EXISTS contact_id TEXT,
    ADD COLUMN IF NOT EXISTS icp_profile_id TEXT,
    ADD COLUMN IF NOT EXISTS icp_profile_version_id TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT,
    ADD COLUMN IF NOT EXISTS decision_reason TEXT,
    ADD COLUMN IF NOT EXISTS reason_codes TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS scores JSONB,
    ADD COLUMN IF NOT EXISTS qualification_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS evidence_references TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS mission_id TEXT;

-- Backfill workspace_id for any pre-existing rows so the NOT NULL constraint can be applied.
UPDATE intelligence.leads
    SET workspace_id = '00000000-0000-0000-0000-000000000000'
    WHERE workspace_id IS NULL;

ALTER TABLE intelligence.leads
    ALTER COLUMN workspace_id SET NOT NULL;

-- Workspace ownership FK (composite tenant+workspace → identity.workspaces)
ALTER TABLE intelligence.leads
    ADD CONSTRAINT leads_tenant_workspace_fk
    FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES identity.workspaces (tenant_id, id);

-- Account ownership FK (composite tenant+workspace+account → intelligence.accounts)
ALTER TABLE intelligence.leads
    ADD CONSTRAINT leads_account_ownership_fk
    FOREIGN KEY (tenant_id, workspace_id, account_id)
    REFERENCES intelligence.accounts (tenant_id, workspace_id, account_id);

-- Indexes for workspace-scoped repository queries
CREATE INDEX IF NOT EXISTS leads_tenant_workspace_account
    ON intelligence.leads (tenant_id, workspace_id, account_id);

CREATE INDEX IF NOT EXISTS leads_tenant_workspace_contact
    ON intelligence.leads (tenant_id, workspace_id, contact_id);

CREATE INDEX IF NOT EXISTS leads_tenant_workspace_status
    ON intelligence.leads (tenant_id, workspace_id, status);

CREATE INDEX IF NOT EXISTS leads_tenant_workspace_mission
    ON intelligence.leads (tenant_id, workspace_id, mission_id);

-- ICP version FK will be added in 030 after intelligence.icp_profiles is created.
