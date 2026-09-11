-- Slice 9 protected-recipient ownership finalization.
-- Establishes physical workspace/ownership columns for campaign, sequence, and
-- message execution, with protected recipient identity represented by
-- recipient_fingerprint / recipient_ciphertext / recipient_protection_state.
-- Plaintext recipient_address is never persisted on these tables.
-- Legacy rows without an independently persisted protected snapshot become
-- LEGACY_UNAVAILABLE; no synthetic addresses are generated.

ALTER TABLE outreach.campaigns
  ADD COLUMN IF NOT EXISTS contact_id TEXT,
  ADD COLUMN IF NOT EXISTS recipient_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS recipient_protection_state TEXT;

ALTER TABLE outreach.sequences
  ADD COLUMN IF NOT EXISTS contact_id TEXT,
  ADD COLUMN IF NOT EXISTS recipient_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS recipient_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS recipient_protection_state TEXT;

ALTER TABLE outreach.message_executions
  ADD COLUMN IF NOT EXISTS contact_id TEXT,
  ADD COLUMN IF NOT EXISTS recipient_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS recipient_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS recipient_protection_state TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM outreach.campaigns WHERE jsonb_typeof(payload) <> 'object' OR jsonb_typeof(payload->'leadId') <> 'string' OR payload->>'leadId' = '' OR length(payload->>'leadId') > 512 OR jsonb_typeof(payload->'contactId') <> 'string' OR payload->>'contactId' = '' OR length(payload->>'contactId') > 512) THEN
    RAISE EXCEPTION '034: campaign has malformed canonical ownership fields';
  END IF;
  IF EXISTS (SELECT 1 FROM outreach.sequences WHERE jsonb_typeof(payload) <> 'object' OR jsonb_typeof(payload->'campaignId') <> 'string' OR jsonb_typeof(payload->'leadId') <> 'string' OR jsonb_typeof(payload->'contactId') <> 'string' OR payload->>'campaignId' = '' OR payload->>'leadId' = '' OR payload->>'contactId' = '' OR length(payload->>'campaignId') > 512 OR length(payload->>'leadId') > 512 OR length(payload->>'contactId') > 512) THEN
    RAISE EXCEPTION '034: sequence has malformed canonical ownership fields';
  END IF;
  IF EXISTS (SELECT 1 FROM outreach.message_executions WHERE jsonb_typeof(payload) <> 'object' OR jsonb_typeof(payload->'campaignId') <> 'string' OR jsonb_typeof(payload->'sequenceId') <> 'string' OR jsonb_typeof(payload->'leadId') <> 'string' OR jsonb_typeof(payload->'contactId') <> 'string' OR payload->>'campaignId' = '' OR payload->>'sequenceId' = '' OR payload->>'leadId' = '' OR payload->>'contactId' = '' OR jsonb_typeof(payload->'idempotencyKey') <> 'string' OR payload->>'idempotencyKey' = '' OR jsonb_typeof(payload->'status') <> 'string' OR payload->>'status' = '' OR length(payload->>'campaignId') > 512 OR length(payload->>'sequenceId') > 512 OR length(payload->>'leadId') > 512 OR length(payload->>'contactId') > 512) THEN
    RAISE EXCEPTION '034: message execution has malformed canonical ownership fields';
  END IF;
END $$;

UPDATE outreach.campaigns c
SET lead_id = c.payload->>'leadId',
    contact_id = c.payload->>'contactId',
    workspace_id = l.workspace_id,
    recipient_fingerprint = c.payload->>'recipientFingerprint',
    recipient_protection_state = COALESCE(c.payload->>'recipientProtectionState', 'LEGACY_UNAVAILABLE')
FROM intelligence.leads l
WHERE c.tenant_id = l.tenant_id AND c.payload->>'leadId' = l.id;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM outreach.campaigns WHERE lead_id IS NULL OR workspace_id IS NULL OR contact_id IS NULL OR recipient_protection_state IS NULL) THEN
    RAISE EXCEPTION '034: campaign ownership or protection state is missing, cross-tenant, or unprovable';
  END IF;
END $$;

UPDATE outreach.sequences s
SET campaign_id = s.payload->>'campaignId',
    lead_id = s.payload->>'leadId',
    contact_id = s.payload->>'contactId',
    workspace_id = c.workspace_id,
    recipient_fingerprint = s.payload->>'recipientFingerprint',
    recipient_ciphertext = s.payload->>'recipientCiphertext',
    recipient_protection_state = COALESCE(s.payload->>'recipientProtectionState', 'LEGACY_UNAVAILABLE')
FROM outreach.campaigns c, intelligence.leads l
WHERE s.tenant_id = c.tenant_id AND s.payload->>'campaignId' = c.id
  AND s.tenant_id = l.tenant_id AND s.payload->>'leadId' = l.id
  AND c.lead_id = l.id AND c.workspace_id = l.workspace_id;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM outreach.sequences WHERE campaign_id IS NULL OR lead_id IS NULL OR workspace_id IS NULL OR contact_id IS NULL OR recipient_protection_state IS NULL) THEN
    RAISE EXCEPTION '034: sequence ownership or protection state is missing, cross-tenant, or unprovable';
  END IF;
END $$;

UPDATE outreach.message_executions e
SET campaign_id = e.payload->>'campaignId',
    sequence_id = e.payload->>'sequenceId',
    lead_id = e.payload->>'leadId',
    contact_id = e.payload->>'contactId',
    workspace_id = s.workspace_id,
    recipient_fingerprint = e.payload->>'recipientFingerprint',
    recipient_ciphertext = e.payload->>'recipientCiphertext',
    recipient_protection_state = COALESCE(e.payload->>'recipientProtectionState', 'LEGACY_UNAVAILABLE'),
    idempotency_key = e.payload->>'idempotencyKey',
    provider_message_id = e.payload->>'providerMessageId',
    status = e.payload->>'status'
FROM outreach.sequences s, outreach.campaigns c, intelligence.leads l
WHERE e.tenant_id = s.tenant_id AND e.payload->>'sequenceId' = s.id
  AND e.tenant_id = c.tenant_id AND e.payload->>'campaignId' = c.id
  AND e.tenant_id = l.tenant_id AND e.payload->>'leadId' = l.id
  AND s.campaign_id = c.id AND s.lead_id = l.id AND c.lead_id = l.id
  AND s.workspace_id = c.workspace_id AND s.workspace_id = l.workspace_id;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM outreach.message_executions WHERE campaign_id IS NULL OR sequence_id IS NULL OR lead_id IS NULL OR workspace_id IS NULL OR contact_id IS NULL OR recipient_protection_state IS NULL OR idempotency_key IS NULL OR status IS NULL) THEN
    RAISE EXCEPTION '034: execution ownership or protection state is missing, cross-tenant, or unprovable';
  END IF;
END $$;

ALTER TABLE outreach.campaigns
  ADD CONSTRAINT campaigns_protection_state_check CHECK (recipient_protection_state IN ('PROTECTED', 'LEGACY_UNAVAILABLE')),
  ADD CONSTRAINT campaigns_protected_fingerprint_check CHECK (recipient_protection_state <> 'PROTECTED' OR recipient_fingerprint IS NOT NULL),
  ADD CONSTRAINT campaigns_legacy_no_fingerprint_check CHECK (recipient_protection_state <> 'LEGACY_UNAVAILABLE' OR recipient_fingerprint IS NULL),
  ADD CONSTRAINT campaigns_tenant_workspace_id_unique UNIQUE (tenant_id, workspace_id, id),
  ADD CONSTRAINT campaigns_workspace_lead_fk FOREIGN KEY (tenant_id, workspace_id, lead_id) REFERENCES intelligence.leads (tenant_id, workspace_id, id),
  ADD CONSTRAINT campaigns_workspace_contact_fk FOREIGN KEY (tenant_id, workspace_id, contact_id) REFERENCES intelligence.contacts (tenant_id, workspace_id, id),
  ALTER COLUMN contact_id SET NOT NULL,
  ALTER COLUMN lead_id SET NOT NULL,
  ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN recipient_protection_state SET NOT NULL;

ALTER TABLE outreach.sequences
  ADD CONSTRAINT sequences_protection_state_check CHECK (recipient_protection_state IN ('PROTECTED', 'LEGACY_UNAVAILABLE')),
  ADD CONSTRAINT sequences_protected_fingerprint_ciphertext_check CHECK (recipient_protection_state <> 'PROTECTED' OR (recipient_fingerprint IS NOT NULL AND recipient_ciphertext IS NOT NULL)),
  ADD CONSTRAINT sequences_legacy_no_protected_check CHECK (recipient_protection_state <> 'LEGACY_UNAVAILABLE' OR (recipient_fingerprint IS NULL AND recipient_ciphertext IS NULL)),
  ADD CONSTRAINT sequences_tenant_workspace_id_unique UNIQUE (tenant_id, workspace_id, id),
  ADD CONSTRAINT sequences_workspace_campaign_fk FOREIGN KEY (tenant_id, workspace_id, campaign_id) REFERENCES outreach.campaigns (tenant_id, workspace_id, id),
  ADD CONSTRAINT sequences_workspace_lead_fk FOREIGN KEY (tenant_id, workspace_id, lead_id) REFERENCES intelligence.leads (tenant_id, workspace_id, id),
  ADD CONSTRAINT sequences_workspace_contact_fk FOREIGN KEY (tenant_id, workspace_id, contact_id) REFERENCES intelligence.contacts (tenant_id, workspace_id, id),
  ALTER COLUMN campaign_id SET NOT NULL,
  ALTER COLUMN lead_id SET NOT NULL,
  ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN contact_id SET NOT NULL,
  ALTER COLUMN recipient_protection_state SET NOT NULL;

ALTER TABLE outreach.message_executions
  ADD CONSTRAINT executions_protection_state_check CHECK (recipient_protection_state IN ('PROTECTED', 'LEGACY_UNAVAILABLE')),
  ADD CONSTRAINT executions_protected_fingerprint_ciphertext_check CHECK (recipient_protection_state <> 'PROTECTED' OR (recipient_fingerprint IS NOT NULL AND recipient_ciphertext IS NOT NULL)),
  ADD CONSTRAINT executions_legacy_no_protected_check CHECK (recipient_protection_state <> 'LEGACY_UNAVAILABLE' OR (recipient_fingerprint IS NULL AND recipient_ciphertext IS NULL)),
  ADD CONSTRAINT executions_tenant_workspace_id_unique UNIQUE (tenant_id, workspace_id, id),
  ADD CONSTRAINT executions_workspace_campaign_fk FOREIGN KEY (tenant_id, workspace_id, campaign_id) REFERENCES outreach.campaigns (tenant_id, workspace_id, id),
  ADD CONSTRAINT executions_workspace_sequence_fk FOREIGN KEY (tenant_id, workspace_id, sequence_id) REFERENCES outreach.sequences (tenant_id, workspace_id, id),
  ADD CONSTRAINT executions_workspace_lead_fk FOREIGN KEY (tenant_id, workspace_id, lead_id) REFERENCES intelligence.leads (tenant_id, workspace_id, id),
  ADD CONSTRAINT executions_workspace_contact_fk FOREIGN KEY (tenant_id, workspace_id, contact_id) REFERENCES intelligence.contacts (tenant_id, workspace_id, id),
  ALTER COLUMN campaign_id SET NOT NULL,
  ALTER COLUMN sequence_id SET NOT NULL,
  ALTER COLUMN lead_id SET NOT NULL,
  ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN contact_id SET NOT NULL,
  ALTER COLUMN recipient_protection_state SET NOT NULL,
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN status SET NOT NULL;

CREATE INDEX outreach_campaigns_workspace ON outreach.campaigns (tenant_id, workspace_id);
CREATE INDEX outreach_sequences_workspace_campaign ON outreach.sequences (tenant_id, workspace_id, campaign_id);
CREATE INDEX outreach_executions_workspace_sequence ON outreach.message_executions (tenant_id, workspace_id, sequence_id);
CREATE UNIQUE INDEX outreach_executions_workspace_idempotency ON outreach.message_executions (tenant_id, workspace_id, idempotency_key);
CREATE INDEX outreach_executions_tenant_provider_message ON outreach.message_executions (tenant_id, provider_message_id);
CREATE INDEX outreach_executions_tenant_recipient_fingerprint ON outreach.message_executions (tenant_id, recipient_fingerprint);
