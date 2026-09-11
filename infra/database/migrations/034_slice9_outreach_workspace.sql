ALTER TABLE outreach.campaigns ADD COLUMN lead_id TEXT, ADD COLUMN workspace_id UUID;
ALTER TABLE outreach.sequences ADD COLUMN campaign_id TEXT, ADD COLUMN lead_id TEXT, ADD COLUMN workspace_id UUID;
ALTER TABLE outreach.message_executions ADD COLUMN campaign_id TEXT, ADD COLUMN sequence_id TEXT, ADD COLUMN lead_id TEXT, ADD COLUMN workspace_id UUID, ADD COLUMN idempotency_key TEXT, ADD COLUMN provider_message_id TEXT, ADD COLUMN recipient_address TEXT, ADD COLUMN status TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM outreach.campaigns WHERE jsonb_typeof(payload) <> 'object' OR jsonb_typeof(payload->'leadId') <> 'string' OR payload->>'leadId' = '' OR length(payload->>'leadId') > 512) THEN
    RAISE EXCEPTION '034: campaign has malformed canonical leadId';
  END IF;
  IF EXISTS (SELECT 1 FROM outreach.sequences WHERE jsonb_typeof(payload) <> 'object' OR jsonb_typeof(payload->'campaignId') <> 'string' OR jsonb_typeof(payload->'leadId') <> 'string' OR payload->>'campaignId' = '' OR payload->>'leadId' = '' OR length(payload->>'campaignId') > 512 OR length(payload->>'leadId') > 512) THEN
    RAISE EXCEPTION '034: sequence has malformed canonical ownership fields';
  END IF;
  IF EXISTS (SELECT 1 FROM outreach.message_executions WHERE jsonb_typeof(payload) <> 'object' OR jsonb_typeof(payload->'campaignId') <> 'string' OR jsonb_typeof(payload->'sequenceId') <> 'string' OR jsonb_typeof(payload->'leadId') <> 'string' OR payload->>'campaignId' = '' OR payload->>'sequenceId' = '' OR payload->>'leadId' = '' OR jsonb_typeof(payload->'idempotencyKey') <> 'string' OR jsonb_typeof(payload->'recipientAddress') <> 'string' OR jsonb_typeof(payload->'status') <> 'string' OR length(payload->>'campaignId') > 512 OR length(payload->>'sequenceId') > 512 OR length(payload->>'leadId') > 512) THEN
    RAISE EXCEPTION '034: message execution has malformed canonical ownership fields';
  END IF;
END $$;

UPDATE outreach.campaigns c
SET lead_id = c.payload->>'leadId', workspace_id = l.workspace_id
FROM intelligence.leads l
WHERE c.tenant_id = l.tenant_id AND c.payload->>'leadId' = l.id;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM outreach.campaigns WHERE lead_id IS NULL OR workspace_id IS NULL) THEN
    RAISE EXCEPTION '034: campaign ownership is missing, cross-tenant, or unprovable';
  END IF;
END $$;

UPDATE outreach.sequences s
SET campaign_id = s.payload->>'campaignId', lead_id = s.payload->>'leadId', workspace_id = c.workspace_id
FROM outreach.campaigns c, intelligence.leads l
WHERE s.tenant_id = c.tenant_id AND s.payload->>'campaignId' = c.id
  AND s.tenant_id = l.tenant_id AND s.payload->>'leadId' = l.id
  AND c.lead_id = l.id AND c.workspace_id = l.workspace_id;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM outreach.sequences WHERE campaign_id IS NULL OR lead_id IS NULL OR workspace_id IS NULL) THEN
    RAISE EXCEPTION '034: sequence ownership paths are missing, cross-tenant, or disagree';
  END IF;
END $$;

UPDATE outreach.message_executions e
SET campaign_id = e.payload->>'campaignId', sequence_id = e.payload->>'sequenceId', lead_id = e.payload->>'leadId', workspace_id = s.workspace_id, idempotency_key = e.payload->>'idempotencyKey', provider_message_id = e.payload->>'providerMessageId', recipient_address = e.payload->>'recipientAddress', status = e.payload->>'status'
FROM outreach.sequences s, outreach.campaigns c, intelligence.leads l
WHERE e.tenant_id = s.tenant_id AND e.payload->>'sequenceId' = s.id
  AND e.tenant_id = c.tenant_id AND e.payload->>'campaignId' = c.id
  AND e.tenant_id = l.tenant_id AND e.payload->>'leadId' = l.id
  AND s.campaign_id = c.id AND s.lead_id = l.id AND c.lead_id = l.id
  AND s.workspace_id = c.workspace_id AND s.workspace_id = l.workspace_id;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM outreach.message_executions WHERE campaign_id IS NULL OR sequence_id IS NULL OR lead_id IS NULL OR workspace_id IS NULL) THEN
    RAISE EXCEPTION '034: execution ownership paths are missing, cross-tenant, or disagree';
  END IF;
END $$;

ALTER TABLE intelligence.leads ADD CONSTRAINT leads_tenant_workspace_id_unique UNIQUE (tenant_id, workspace_id, id);
ALTER TABLE outreach.campaigns ADD CONSTRAINT campaigns_tenant_workspace_id_unique UNIQUE (tenant_id, workspace_id, id);
ALTER TABLE outreach.sequences ADD CONSTRAINT sequences_tenant_workspace_id_unique UNIQUE (tenant_id, workspace_id, id);
ALTER TABLE outreach.message_executions ADD CONSTRAINT executions_tenant_workspace_id_unique UNIQUE (tenant_id, workspace_id, id);

ALTER TABLE outreach.campaigns
  ADD CONSTRAINT campaigns_workspace_lead_fk FOREIGN KEY (tenant_id, workspace_id, lead_id) REFERENCES intelligence.leads (tenant_id, workspace_id, id),
  ALTER COLUMN lead_id SET NOT NULL, ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE outreach.sequences
  ADD CONSTRAINT sequences_workspace_campaign_fk FOREIGN KEY (tenant_id, workspace_id, campaign_id) REFERENCES outreach.campaigns (tenant_id, workspace_id, id),
  ADD CONSTRAINT sequences_workspace_lead_fk FOREIGN KEY (tenant_id, workspace_id, lead_id) REFERENCES intelligence.leads (tenant_id, workspace_id, id),
  ALTER COLUMN campaign_id SET NOT NULL, ALTER COLUMN lead_id SET NOT NULL, ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE outreach.message_executions
  ADD CONSTRAINT executions_workspace_campaign_fk FOREIGN KEY (tenant_id, workspace_id, campaign_id) REFERENCES outreach.campaigns (tenant_id, workspace_id, id),
  ADD CONSTRAINT executions_workspace_sequence_fk FOREIGN KEY (tenant_id, workspace_id, sequence_id) REFERENCES outreach.sequences (tenant_id, workspace_id, id),
  ADD CONSTRAINT executions_workspace_lead_fk FOREIGN KEY (tenant_id, workspace_id, lead_id) REFERENCES intelligence.leads (tenant_id, workspace_id, id),
  ALTER COLUMN campaign_id SET NOT NULL, ALTER COLUMN sequence_id SET NOT NULL, ALTER COLUMN lead_id SET NOT NULL, ALTER COLUMN workspace_id SET NOT NULL, ALTER COLUMN idempotency_key SET NOT NULL, ALTER COLUMN recipient_address SET NOT NULL, ALTER COLUMN status SET NOT NULL;

CREATE INDEX outreach_campaigns_workspace ON outreach.campaigns (tenant_id, workspace_id);
CREATE INDEX outreach_sequences_workspace_campaign ON outreach.sequences (tenant_id, workspace_id, campaign_id);
CREATE INDEX outreach_executions_workspace_sequence ON outreach.message_executions (tenant_id, workspace_id, sequence_id);
CREATE UNIQUE INDEX outreach_executions_workspace_idempotency ON outreach.message_executions (tenant_id, workspace_id, idempotency_key);
CREATE INDEX outreach_executions_tenant_provider_message ON outreach.message_executions (tenant_id, provider_message_id);
CREATE INDEX outreach_executions_tenant_recipient ON outreach.message_executions (tenant_id, recipient_address);

