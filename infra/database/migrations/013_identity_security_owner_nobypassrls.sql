-- Slice 1 corrective migration: the SECURITY DEFINER owner must remain a
-- NOLOGIN, NOSUPERUSER, NOBYPASSRLS role per P0-2 hardening requirements.
-- Cross-tenant workspace listing is handled by the repository with explicit
-- tenant context instead of by this function.
ALTER ROLE projectx_security_owner NOBYPASSRLS;
