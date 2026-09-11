-- Slice 9A: Graph webhook subscription ownership and scope.
-- Subscriptions are either WORKSPACE_BOUND (authoritative workspace identity)
-- or LEGACY_UNBOUND (tenant authority only, no proven workspace link).

ALTER TABLE outreach.graph_subscriptions
  ADD COLUMN IF NOT EXISTS workspace_id UUID,
  ADD COLUMN IF NOT EXISTS subscription_scope TEXT;

-- Existing rows cannot be retroactively proven to own a workspace unless an
-- authoritative durable relationship already exists. 036 does NOT synthesize
-- or guess a default workspace: any unproven subscription becomes LEGACY_UNBOUND.
UPDATE outreach.graph_subscriptions
SET subscription_scope = 'LEGACY_UNBOUND',
    workspace_id = NULL;

-- For subscriptions that can be uniquely proven to belong to exactly one
-- workspace through an already-authoritative durable relationship, promote them.
-- (No heuristic update is included here; promotions are data-migration specific
-- and must be driven by proven tenant/workspace ground truth, not by address
-- or mailbox inference.)

ALTER TABLE outreach.graph_subscriptions
  ADD CONSTRAINT graph_subscriptions_scope_check CHECK (subscription_scope IN ('WORKSPACE_BOUND', 'LEGACY_UNBOUND')),
  ADD CONSTRAINT graph_subscriptions_scope_workspace_check CHECK (
    (subscription_scope = 'WORKSPACE_BOUND' AND workspace_id IS NOT NULL) OR
    (subscription_scope = 'LEGACY_UNBOUND' AND workspace_id IS NULL)
  ),
  ADD CONSTRAINT graph_subscriptions_workspace_fk
    FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES identity.workspaces (tenant_id, id)
    MATCH SIMPLE ON DELETE RESTRICT ON UPDATE CASCADE,
  ALTER COLUMN subscription_scope SET NOT NULL;

CREATE INDEX idx_graph_subscriptions_workspace
  ON outreach.graph_subscriptions (tenant_id, workspace_id);

-- RLS already enabled in 003; ensure the policy remains tenant-scoped for both scopes.
