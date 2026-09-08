-- Slice 8B1a corrective: enforce tenant-workspace ownership at the DB level.
--
-- The simple FK workspace_id → identity.workspaces(id) proves the workspace
-- exists but not that it belongs to the same tenant as the account row.
--
-- Fix: add a composite unique on identity.workspaces(tenant_id, id) to serve
-- as the referenced key, then replace the simple FK with a composite FK
-- (tenant_id, workspace_id) → identity.workspaces(tenant_id, id).
--
-- This guarantees the database rejects:
--   account.tenant_id = Tenant A
--   account.workspace_id = Workspace owned by Tenant B

-- 1. Add supporting unique constraint on identity.workspaces (additive-only,
--    compatible with existing PK on id).
ALTER TABLE identity.workspaces
    ADD CONSTRAINT workspaces_tenant_id_unique UNIQUE (tenant_id, id);

-- 2. Drop the old simple FK on intelligence.accounts.
ALTER TABLE intelligence.accounts
    DROP CONSTRAINT IF EXISTS accounts_workspace_id_fkey;

-- 3. Add the composite FK enforcing tenant-workspace ownership.
ALTER TABLE intelligence.accounts
    ADD CONSTRAINT accounts_tenant_workspace_fk
    FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES identity.workspaces (tenant_id, id);
