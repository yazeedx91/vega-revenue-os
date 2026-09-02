-- Slice 1 corrective migration: force RLS on identity tenant-scoped tables
-- so the table owner cannot bypass row-level security policies.
ALTER TABLE identity.workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.memberships FORCE ROW LEVEL SECURITY;
