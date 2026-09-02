-- Slice 1 corrective migration: grant the SECURITY DEFINER owner just enough
-- rights on the identity schema to run the narrow cross-tenant workspace lister.
GRANT USAGE ON SCHEMA identity TO projectx_security_owner;
GRANT SELECT ON TABLE identity.workspaces TO projectx_security_owner;
GRANT SELECT ON TABLE identity.memberships TO projectx_security_owner;
