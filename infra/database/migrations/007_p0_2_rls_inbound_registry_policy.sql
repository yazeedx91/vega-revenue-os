-- Phase 14 P0-2 inbound mailbox registry policy correction
--
-- The tenant-aware policy must also read when the pooled client has not yet
-- bound a tenant (NULL or empty string). This lets the narrow resolver
-- determine the tenant from the mailbox address. Direct table access remains
-- denied to projectx_app.

DROP POLICY IF EXISTS tenant_isolation_inbound_mailbox_registry
    ON outreach.inbound_mailbox_registry;

CREATE POLICY tenant_isolation_inbound_mailbox_registry
    ON outreach.inbound_mailbox_registry
    USING (
        tenant_id = current_setting('app.current_tenant', TRUE)
        OR current_setting('app.current_tenant', TRUE) IS NULL
        OR current_setting('app.current_tenant', TRUE) = ''
    );
