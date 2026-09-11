ALTER TABLE conversation.conversations ADD COLUMN workspace_id UUID, ADD COLUMN execution_id TEXT, ADD COLUMN lead_id TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM conversation.conversations
    WHERE jsonb_typeof(payload) <> 'object'
       OR jsonb_typeof(payload->'leadId') <> 'string'
       OR payload->>'leadId' = '' OR length(payload->>'leadId') > 512
       OR (payload ? 'executionId' AND payload->'executionId' <> 'null'::jsonb
           AND (jsonb_typeof(payload->'executionId') <> 'string' OR payload->>'executionId' = '' OR length(payload->>'executionId') > 512))
  ) THEN
    RAISE EXCEPTION '035: conversation has malformed canonical ownership fields';
  END IF;
END $$;

UPDATE conversation.conversations c
SET lead_id = c.payload->>'leadId', workspace_id = l.workspace_id
FROM intelligence.leads l
WHERE c.tenant_id = l.tenant_id AND c.payload->>'leadId' = l.id;

UPDATE conversation.conversations c
SET execution_id = c.payload->>'executionId'
FROM outreach.message_executions e
WHERE c.payload ? 'executionId' AND c.payload->>'executionId' IS NOT NULL
  AND c.tenant_id = e.tenant_id AND c.workspace_id = e.workspace_id
  AND c.payload->>'executionId' = e.id AND c.lead_id = e.lead_id;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM conversation.conversations WHERE lead_id IS NULL OR workspace_id IS NULL) THEN
    RAISE EXCEPTION '035: conversation Lead ownership is missing, cross-tenant, or unprovable';
  END IF;
  IF EXISTS (SELECT 1 FROM conversation.conversations WHERE payload->>'executionId' IS NOT NULL AND execution_id IS NULL) THEN
    RAISE EXCEPTION '035: conversation execution ownership is missing, cross-tenant, wrong-workspace, or wrong-Lead';
  END IF;
END $$;

ALTER TABLE outreach.message_executions
  ADD CONSTRAINT executions_tenant_workspace_id_lead_unique UNIQUE (tenant_id, workspace_id, id, lead_id);
ALTER TABLE conversation.conversations
  ADD CONSTRAINT conversations_tenant_workspace_id_unique UNIQUE (tenant_id, workspace_id, id),
  ADD CONSTRAINT conversations_workspace_lead_fk FOREIGN KEY (tenant_id, workspace_id, lead_id) REFERENCES intelligence.leads (tenant_id, workspace_id, id),
  ADD CONSTRAINT conversations_workspace_execution_lead_fk FOREIGN KEY (tenant_id, workspace_id, execution_id, lead_id) REFERENCES outreach.message_executions (tenant_id, workspace_id, id, lead_id),
  ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN lead_id SET NOT NULL;

CREATE INDEX conversations_workspace_lead_channel ON conversation.conversations (tenant_id, workspace_id, lead_id);

