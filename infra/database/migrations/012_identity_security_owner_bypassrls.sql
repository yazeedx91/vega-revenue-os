-- Slice 1 corrective migration: the dedicated SECURITY DEFINER owner must be
-- able to bypass row-level security inside its narrow, non-login context so that
-- cross-tenant lookup functions (e.g., list_workspaces_for_user) can run
-- with least privilege. The runtime app role remains NOBYPASSRLS.
ALTER ROLE projectx_security_owner BYPASSRLS;
