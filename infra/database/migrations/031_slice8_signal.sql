ALTER TABLE intelligence.contacts
    ADD CONSTRAINT contacts_tenant_workspace_contact_unique
    UNIQUE (tenant_id, workspace_id, contact_id);

CREATE TABLE intelligence.signals (
    signal_id          TEXT NOT NULL PRIMARY KEY,
    tenant_id          TEXT NOT NULL,
    workspace_id       UUID NOT NULL,
    account_id         TEXT NOT NULL,
    contact_id         TEXT,
    signal_type        TEXT NOT NULL CHECK (signal_type IN (
        'Growth', 'Funding', 'Leadership', 'Technology',
        'DigitalTransformation', 'BusinessChange', 'PainIndicators',
        'CompetitivePressure', 'IndustryTailwinds'
    )),
    observed_at        TIMESTAMPTZ NOT NULL,
    effective_from     TIMESTAMPTZ NOT NULL,
    effective_until    TIMESTAMPTZ NOT NULL,
    source             VARCHAR(512) NOT NULL CHECK (length(source) > 0),
    source_uri         VARCHAR(2048),
    confidence         NUMERIC NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    relevance          NUMERIC NOT NULL CHECK (relevance >= 0 AND relevance <= 1),
    observed_signal    VARCHAR(4096) NOT NULL CHECK (length(observed_signal) > 0),
    interpreted_signal VARCHAR(4096) NOT NULL CHECK (length(interpreted_signal) > 0),
    evidence_ids       TEXT[] NOT NULL DEFAULT '{}',
    status             TEXT NOT NULL CHECK (status IN ('ACTIVE', 'EXPIRED', 'RETRACTED')),
    dedup_identity     TEXT NOT NULL,
    signal_version     INTEGER NOT NULL DEFAULT 0 CHECK (signal_version >= 0),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (effective_until > effective_from),
    UNIQUE (tenant_id, workspace_id, signal_id),
    FOREIGN KEY (tenant_id, workspace_id)
        REFERENCES identity.workspaces (tenant_id, id),
    FOREIGN KEY (tenant_id, workspace_id, account_id)
        REFERENCES intelligence.accounts (tenant_id, workspace_id, account_id),
    FOREIGN KEY (tenant_id, workspace_id, contact_id)
        REFERENCES intelligence.contacts (tenant_id, workspace_id, contact_id)
);

CREATE UNIQUE INDEX signals_workspace_dedup
    ON intelligence.signals (tenant_id, workspace_id, dedup_identity);

CREATE INDEX signals_qualification_lookup
    ON intelligence.signals (tenant_id, workspace_id, account_id, status, effective_from, effective_until);

ALTER TABLE intelligence.signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence.signals FORCE ROW LEVEL SECURITY;

CREATE POLICY signals_tenant_isolation ON intelligence.signals
    FOR ALL TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

GRANT SELECT, INSERT, UPDATE ON TABLE intelligence.signals TO projectx_app;
