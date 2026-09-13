-- Phase 14 P0-2 security/RLS hardening migration
-- Adds a dedicated, minimal inbound mailbox registry that is protected from
-- direct SELECT by the application role. Tenant lookup is exposed only through
-- a narrow SECURITY DEFINER function. Also tightens application privileges to
-- the least required DML set and forces RLS on any table that was not already
-- protected.

CREATE SCHEMA IF NOT EXISTS outreach;

-- Harden the application role. No superuser, no RLS bypass, no dangerous
-- privileges.
ALTER ROLE projectx_app WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

-- Inbound mailbox registry: the only non-RLS data path is the resolve function.
CREATE TABLE IF NOT EXISTS outreach.inbound_mailbox_registry (
    normalized_mailbox TEXT NOT NULL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    provider_id TEXT NOT NULL DEFAULT 'graph-email',
    channel TEXT NOT NULL DEFAULT 'email',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE outreach.inbound_mailbox_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach.inbound_mailbox_registry FORCE ROW LEVEL SECURITY;

-- Dedicated, low-privilege owner for SECURITY DEFINER objects. It cannot log in,
-- bypass RLS, create databases/roles, or replicate. The privileged migration
-- identity creates this role and transfers narrow object ownership to it.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'projectx_security_owner') THEN
        CREATE ROLE projectx_security_owner
            NOLOGIN
            NOSUPERUSER
            NOBYPASSRLS
            NOCREATEDB
            NOCREATEROLE
            NOREPLICATION;
    ELSE
        ALTER ROLE projectx_security_owner
            NOLOGIN
            NOSUPERUSER
            NOBYPASSRLS
            NOCREATEDB
            NOCREATEROLE
            NOREPLICATION;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA outreach TO projectx_security_owner;
GRANT SELECT ON TABLE outreach.inbound_mailbox_registry TO projectx_security_owner;

DROP POLICY IF EXISTS tenant_isolation_inbound_mailbox_registry
    ON outreach.inbound_mailbox_registry;

CREATE POLICY tenant_isolation_inbound_mailbox_registry
    ON outreach.inbound_mailbox_registry
    USING (tenant_id = current_setting('app.current_tenant', TRUE));

CREATE OR REPLACE FUNCTION outreach.resolve_inbound_mailbox(
    p_mailbox TEXT
) RETURNS TABLE(
    tenant_id TEXT,
    provider_id TEXT,
    channel TEXT
) LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog, outreach
AS $$
    SELECT r.tenant_id, r.provider_id, r.channel
    FROM outreach.inbound_mailbox_registry AS r
    WHERE r.normalized_mailbox = p_mailbox
    LIMIT 1;
$$;

-- PostgreSQL requires the new function owner to hold CREATE on the schema before it
-- can accept ownership. Grant it only for the transfer, then revoke it.
GRANT CREATE ON SCHEMA outreach TO projectx_security_owner;
ALTER FUNCTION outreach.resolve_inbound_mailbox(TEXT) OWNER TO projectx_security_owner;
REVOKE CREATE ON SCHEMA outreach FROM projectx_security_owner;

-- Only the least-privilege application runtime role may execute the resolver.
-- PUBLIC must not have unrestricted EXECUTE.
REVOKE ALL ON FUNCTION outreach.resolve_inbound_mailbox(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outreach.resolve_inbound_mailbox(TEXT) TO projectx_app;

-- 003 created the graph_subscriptions table but did not force RLS.
ALTER TABLE outreach.graph_subscriptions FORCE ROW LEVEL SECURITY;

-- Revoke broad ALL PRIVILEGES and grant only the least required DML set on
-- existing tenant-scoped tables. This does not alter 001_phase14_initial.sql.
DO $$
DECLARE
    schema_name TEXT;
BEGIN
    FOR schema_name IN SELECT unnest(ARRAY['outreach', 'conversation', 'mission', 'intelligence', 'audit', 'idempotency'])
    LOOP
        EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM projectx_app', schema_name);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO projectx_app', schema_name);
        EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM projectx_app', schema_name);
        EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO projectx_app', schema_name);
    END LOOP;
END
$$;

-- The application role has no direct access to the inbound mailbox registry.
-- It may only resolve a single mailbox through the dedicated function.
REVOKE ALL PRIVILEGES ON TABLE outreach.inbound_mailbox_registry FROM projectx_app;

-- Least-privilege default privileges for future objects created by the
-- migration/admin user.
ALTER DEFAULT PRIVILEGES IN SCHEMA outreach, conversation, mission, intelligence, audit, idempotency
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO projectx_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA outreach, conversation, mission, intelligence, audit, idempotency
    GRANT USAGE, SELECT ON SEQUENCES TO projectx_app;
