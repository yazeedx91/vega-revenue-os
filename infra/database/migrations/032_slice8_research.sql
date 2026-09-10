CREATE TABLE intelligence.research_requests (
    request_id    TEXT NOT NULL PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    workspace_id  UUID NOT NULL,
    mission_id    TEXT,
    query_hash    VARCHAR(256) NOT NULL,
    requested_at  TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, workspace_id, request_id),
    FOREIGN KEY (tenant_id, workspace_id)
        REFERENCES identity.workspaces (tenant_id, id)
);

CREATE TABLE intelligence.research_runs (
    run_id          TEXT NOT NULL PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    workspace_id    UUID NOT NULL,
    request_id      TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    failure_code    VARCHAR(128),
    failure_message VARCHAR(1024),
    UNIQUE (tenant_id, workspace_id, run_id),
    FOREIGN KEY (tenant_id, workspace_id)
        REFERENCES identity.workspaces (tenant_id, id),
    FOREIGN KEY (tenant_id, workspace_id, request_id)
        REFERENCES intelligence.research_requests (tenant_id, workspace_id, request_id)
);

CREATE TABLE intelligence.research_evidence (
    evidence_id          TEXT NOT NULL PRIMARY KEY,
    tenant_id            TEXT NOT NULL,
    workspace_id         UUID NOT NULL,
    request_id           TEXT NOT NULL,
    run_id               TEXT NOT NULL,
    account_id           TEXT,
    contact_id           TEXT,
    mission_id           TEXT,
    claim_type           VARCHAR(128) NOT NULL CHECK (length(claim_type) > 0),
    normalized_value     JSONB NOT NULL,
    source               VARCHAR(512) NOT NULL CHECK (length(source) > 0),
    source_uri           VARCHAR(2048),
    reliability_tier     TEXT NOT NULL CHECK (reliability_tier IN ('OFFICIAL', 'PREMIUM_PROVIDER', 'PUBLIC_RECORD', 'DERIVED', 'USER_PROVIDED')),
    observed_at          TIMESTAMPTZ NOT NULL,
    freshness_expiry     TIMESTAMPTZ NOT NULL,
    confidence           NUMERIC NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    confidence_breakdown JSONB NOT NULL,
    provenance           JSONB NOT NULL,
    contradictions       JSONB,
    evidence_fingerprint VARCHAR(256) NOT NULL,
    UNIQUE (tenant_id, workspace_id, evidence_id),
    UNIQUE (tenant_id, workspace_id, evidence_fingerprint),
    FOREIGN KEY (tenant_id, workspace_id)
        REFERENCES identity.workspaces (tenant_id, id),
    FOREIGN KEY (tenant_id, workspace_id, request_id)
        REFERENCES intelligence.research_requests (tenant_id, workspace_id, request_id),
    FOREIGN KEY (tenant_id, workspace_id, run_id)
        REFERENCES intelligence.research_runs (tenant_id, workspace_id, run_id),
    FOREIGN KEY (tenant_id, workspace_id, account_id)
        REFERENCES intelligence.accounts (tenant_id, workspace_id, account_id),
    FOREIGN KEY (tenant_id, workspace_id, contact_id)
        REFERENCES intelligence.contacts (tenant_id, workspace_id, contact_id)
);

CREATE INDEX research_requests_workspace_query ON intelligence.research_requests (tenant_id, workspace_id, query_hash);
CREATE INDEX research_evidence_account ON intelligence.research_evidence (tenant_id, workspace_id, account_id);
CREATE INDEX research_evidence_contact ON intelligence.research_evidence (tenant_id, workspace_id, contact_id);
CREATE INDEX research_evidence_mission ON intelligence.research_evidence (tenant_id, workspace_id, mission_id);

ALTER TABLE intelligence.research_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence.research_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE intelligence.research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence.research_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE intelligence.research_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence.research_evidence FORCE ROW LEVEL SECURITY;

CREATE POLICY research_requests_tenant_isolation ON intelligence.research_requests FOR ALL TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE)) WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));
CREATE POLICY research_runs_tenant_isolation ON intelligence.research_runs FOR ALL TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE)) WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));
CREATE POLICY research_evidence_tenant_isolation ON intelligence.research_evidence FOR ALL TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE)) WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

GRANT SELECT, INSERT ON intelligence.research_requests TO projectx_app;
GRANT SELECT, INSERT, UPDATE ON intelligence.research_runs TO projectx_app;
GRANT SELECT, INSERT ON intelligence.research_evidence TO projectx_app;
