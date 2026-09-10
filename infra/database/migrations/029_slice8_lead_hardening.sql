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

UPDATE intelligence.leads
    SET workspace_id = (payload ->> 'workspaceId')::UUID
    WHERE workspace_id IS NULL
      AND payload ? 'workspaceId'
      AND payload ->> 'workspaceId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM intelligence.leads WHERE workspace_id IS NULL) THEN
        RAISE EXCEPTION 'Cannot harden intelligence.leads: existing rows lack a valid workspaceId in payload';
    END IF;
END $$;

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
