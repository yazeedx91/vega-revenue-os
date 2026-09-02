-- Slice 1: identity, workspace, membership, and RLS
CREATE SCHEMA IF NOT EXISTS identity;

-- Global user registry. A user is not itself tenant-scoped, but stores the
-- default tenant used as the personal workspace root.
CREATE TABLE IF NOT EXISTS identity.users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    tenant_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workspaces are tenant-scoped. The tenant_id is authoritative for RLS.
CREATE TABLE IF NOT EXISTS identity.workspaces (
    id UUID PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    owner_user_id UUID NOT NULL REFERENCES identity.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Memberships bind users to workspaces and carry the workspace tenant.
CREATE TABLE IF NOT EXISTS identity.memberships (
    workspace_id UUID NOT NULL REFERENCES identity.workspaces(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

-- RLS on tenant-scoped identity tables.
ALTER TABLE identity.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_workspaces ON identity.workspaces;
CREATE POLICY tenant_isolation_workspaces
    ON identity.workspaces
    USING (tenant_id = current_setting('app.current_tenant', TRUE));

DROP POLICY IF EXISTS tenant_isolation_memberships ON identity.memberships;
CREATE POLICY tenant_isolation_memberships
    ON identity.memberships
    USING (tenant_id = current_setting('app.current_tenant', TRUE));

-- SECURITY DEFINER function to list all workspaces for a user, bypassing RLS.
-- The app role has only EXECUTE on this function, not SELECT on the tables.
DROP FUNCTION IF EXISTS identity.list_workspaces_for_user(p_user_id TEXT);

CREATE OR REPLACE FUNCTION identity.list_workspaces_for_user(p_user_id TEXT)
RETURNS TABLE(
    id UUID,
    tenant_id TEXT,
    name TEXT,
    owner_user_id UUID,
    created_at TIMESTAMPTZ
) LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $$
    SELECT w.id, w.tenant_id, w.name, w.owner_user_id, w.created_at
    FROM identity.workspaces w
    JOIN identity.memberships m ON m.workspace_id = w.id
    WHERE m.user_id = p_user_id::UUID;
$$;

ALTER FUNCTION identity.list_workspaces_for_user(TEXT) OWNER TO projectx_security_owner;
REVOKE ALL ON FUNCTION identity.list_workspaces_for_user(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.list_workspaces_for_user(TEXT) TO projectx_app;

-- Privileges for the application role.
GRANT USAGE ON SCHEMA identity TO projectx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE identity.users TO projectx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE identity.workspaces TO projectx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE identity.memberships TO projectx_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA identity
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO projectx_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity
    GRANT USAGE, SELECT ON SEQUENCES TO projectx_app;
