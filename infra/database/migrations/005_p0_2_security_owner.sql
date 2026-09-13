-- Phase 14 P0-2 SECURITY DEFINER ownership hardening
-- Ensures the narrow inbound mailbox resolver is owned by a dedicated,
-- low-privilege role that cannot log in, bypass RLS, or create objects.
-- This migration is idempotent: it safely re-creates the role and re-applies
-- the function definition + ownership for any deployment that ran an earlier
-- version of the P0-2 hardening migration.

CREATE SCHEMA IF NOT EXISTS outreach;

-- Dedicated owner for SECURITY DEFINER objects. The privileged migration
-- identity must create this role; the runtime application role must not own
-- any SECURITY DEFINER function.
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

-- Recreate the resolver with an explicit, minimal search_path and the
-- correct owner. Return type is intentionally narrow: tenant_id, provider_id,
-- channel only.
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

-- Least-privilege execution: PUBLIC is denied, only the runtime app role can use
-- the narrow resolver, and it has no direct access to the registry table.
REVOKE ALL ON FUNCTION outreach.resolve_inbound_mailbox(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outreach.resolve_inbound_mailbox(TEXT) TO projectx_app;
