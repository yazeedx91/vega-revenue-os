-- Slice 8B2b: Contact persistence schema with protected channel envelopes.
--
-- Contact identity is workspace-private. The canonical dedup boundary is:
--   tenant_id + workspace_id + account_id + email_fingerprint
--   tenant_id + workspace_id + account_id + phone_fingerprint
--
-- Protected channels are stored as opaque envelopes (h1/e1 format from 8B2a).
-- No plaintext email/phone columns exist.
--
-- Security: ENABLE + FORCE RLS. Tenant isolation via
-- current_setting('app.current_tenant', TRUE). Write protection enforced
-- via WITH CHECK clause.

-- Add supporting unique constraint on accounts for Contact→Account composite FK
ALTER TABLE intelligence.accounts
    ADD CONSTRAINT accounts_tenant_workspace_account_unique
    UNIQUE (tenant_id, workspace_id, account_id);

CREATE TABLE IF NOT EXISTS intelligence.contacts (
    contact_id          TEXT NOT NULL PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    workspace_id        UUID NOT NULL,
    account_id          TEXT NOT NULL,
    name                TEXT,
    title               TEXT,
    role                TEXT,
    seniority           TEXT,
    department          TEXT,
    function_role       TEXT,
    email_fingerprint   TEXT,
    encrypted_email     TEXT,
    phone_fingerprint   TEXT,
    encrypted_phone     TEXT,
    linked_in_url       TEXT,
    channels            JSONB NOT NULL DEFAULT '[]',
    consent_status      TEXT,
    verification_state  TEXT,
    status              TEXT,
    suppression_reason  TEXT,
    suppression_reference TEXT,
    suppressed_at       TIMESTAMPTZ,
    evidence_references JSONB NOT NULL DEFAULT '[]',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Bounded enum values from frozen Contact aggregate
    CONSTRAINT contacts_status_check CHECK (
        status IN ('DISCOVERED', 'ENRICHED', 'VALIDATED', 'SUPPRESSED')
    ),
    CONSTRAINT contacts_verification_state_check CHECK (
        verification_state IN ('UNVERIFIED', 'VERIFIED', 'BOUNCED')
    ),
    CONSTRAINT contacts_consent_status_check CHECK (
        consent_status IS NULL OR consent_status IN ('GRANTED', 'WITHHELD', 'UNKNOWN')
    )
);

-- Workspace ownership: (tenant_id, workspace_id) → identity.workspaces(tenant_id, id)
ALTER TABLE intelligence.contacts
    ADD CONSTRAINT contacts_tenant_workspace_fk
    FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES identity.workspaces (tenant_id, id);

-- Account ownership: (tenant_id, workspace_id, account_id) → intelligence.accounts(tenant_id, workspace_id, account_id)
ALTER TABLE intelligence.contacts
    ADD CONSTRAINT contacts_account_ownership_fk
    FOREIGN KEY (tenant_id, workspace_id, account_id)
    REFERENCES intelligence.accounts (tenant_id, workspace_id, account_id);

-- Email fingerprint dedup: same fingerprint cannot exist twice within
-- the same tenant + workspace + account. NULL fingerprints excluded.
CREATE UNIQUE INDEX contacts_workspace_account_email_fingerprint_dedup
    ON intelligence.contacts (tenant_id, workspace_id, account_id, email_fingerprint)
    WHERE email_fingerprint IS NOT NULL;

-- Phone fingerprint dedup: same fingerprint cannot exist twice within
-- the same tenant + workspace + account. NULL fingerprints excluded.
CREATE UNIQUE INDEX contacts_workspace_account_phone_fingerprint_dedup
    ON intelligence.contacts (tenant_id, workspace_id, account_id, phone_fingerprint)
    WHERE phone_fingerprint IS NOT NULL;

-- Lookup by tenant + workspace + account for repository queries
CREATE INDEX contacts_tenant_workspace_account
    ON intelligence.contacts (tenant_id, workspace_id, account_id);

-- Lookup by tenant + workspace + status + verification for repository queries
CREATE INDEX contacts_tenant_workspace_status_verification
    ON intelligence.contacts (tenant_id, workspace_id, status, verification_state);

-- RLS: tenant isolation with explicit write protection
ALTER TABLE intelligence.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence.contacts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contacts_tenant_isolation ON intelligence.contacts;
CREATE POLICY contacts_tenant_isolation ON intelligence.contacts
    FOR ALL TO projectx_app
    USING (tenant_id = current_setting('app.current_tenant', TRUE))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

-- Grants (least-privilege DML for application role)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE intelligence.contacts TO projectx_app;
