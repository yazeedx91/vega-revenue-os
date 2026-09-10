-- Slice 8 immutable ICP physical-version persistence.
-- Each row is an immutable physical profile version. Creating a new version
-- INSERTs a new row; prior rows are never UPDATEd or DELETEd by the app role.

CREATE TABLE intelligence.icp_profiles (
    icp_profile_version_id TEXT NOT NULL PRIMARY KEY,
    icp_profile_id         TEXT NOT NULL,
    version_number         INTEGER NOT NULL CHECK (version_number >= 1),
    tenant_id              TEXT NOT NULL,
    workspace_id           UUID NOT NULL,
    name                   TEXT NOT NULL,
    hard_filters           JSONB NOT NULL,
    soft_criteria          JSONB NOT NULL,
    positive_signals       TEXT[] NOT NULL DEFAULT '{}',
    negative_signals       TEXT[] NOT NULL DEFAULT '{}',
    disqualifiers          TEXT[] NOT NULL DEFAULT '{}',
    scoring_weights        JSONB NOT NULL,
    qualification_threshold NUMERIC NOT NULL CHECK (qualification_threshold >= 0 AND qualification_threshold <= 1),
    review_threshold       NUMERIC NOT NULL CHECK (review_threshold >= 0 AND review_threshold <= 1),
    minimum_confidence     NUMERIC NOT NULL CHECK (minimum_confidence >= 0 AND minimum_confidence <= 1),
    status                 TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, workspace_id, icp_profile_id, version_number),
    UNIQUE (tenant_id, workspace_id, icp_profile_version_id),
    FOREIGN KEY (tenant_id, workspace_id)
        REFERENCES identity.workspaces (tenant_id, id)
);

CREATE INDEX icp_profiles_tenant_workspace_profile_version
    ON intelligence.icp_profiles (tenant_id, workspace_id, icp_profile_id, version_number DESC);

CREATE UNIQUE INDEX icp_profiles_one_active_per_workspace
    ON intelligence.icp_profiles (tenant_id, workspace_id)
    WHERE status = 'ACTIVE';

ALTER TABLE intelligence.icp_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence.icp_profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY icp_profiles_tenant_isolation ON intelligence.icp_profiles
    FOR ALL TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

-- Physical immutability: application role may INSERT and SELECT only.
GRANT SELECT, INSERT ON TABLE intelligence.icp_profiles TO projectx_app;
REVOKE UPDATE, DELETE ON TABLE intelligence.icp_profiles FROM projectx_app;

-- Leads pin exactly one immutable ICP physical version in the same tenant/workspace.
ALTER TABLE intelligence.leads
    ADD CONSTRAINT leads_icp_profile_version_fk
    FOREIGN KEY (tenant_id, workspace_id, icp_profile_version_id)
    REFERENCES intelligence.icp_profiles (tenant_id, workspace_id, icp_profile_version_id);
