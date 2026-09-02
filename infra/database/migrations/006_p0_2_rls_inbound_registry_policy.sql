-- Phase 14 P0-2 inbound mailbox registry policy fix
--
-- The registry is still fully protected from direct projectx_app SELECT.
-- The narrow resolver function is the only path in. When called, the tenant
-- context is not yet known, so the policy must allow rows to be read unless
-- an explicit app.current_tenant has been set for a different tenant-scoped
-- operation. projectx_app cannot exploit this because it has no direct SELECT
-- on the table and the resolver only returns the single row for its input.

DROP POLICY IF EXISTS tenant_isolation_inbound_mailbox_registry
    ON outreach.inbound_mailbox_registry;

CREATE POLICY tenant_isolation_inbound_mailbox_registry
    ON outreach.inbound_mailbox_registry
    USING (
        tenant_id = current_setting('app.current_tenant', TRUE)
        OR current_setting('app.current_tenant', TRUE) IS NULL
    );
