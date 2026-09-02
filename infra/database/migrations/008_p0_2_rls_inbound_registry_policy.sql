-- Phase 14 P0-2 inbound mailbox registry policy — final hardening
--
-- The resolver function runs as projectx_security_owner. The registry's RLS
-- policy must allow that role to look up the mailbox→tenant mapping without
-- trusting the caller's app.current_tenant setting. Direct SELECT from the
-- runtime role remains blocked at the privilege layer, not just by this policy.

DROP POLICY IF EXISTS tenant_isolation_inbound_mailbox_registry
    ON outreach.inbound_mailbox_registry;

CREATE POLICY tenant_isolation_inbound_mailbox_registry
    ON outreach.inbound_mailbox_registry
    USING (
        tenant_id = current_setting('app.current_tenant', TRUE)
        OR pg_has_role(current_user, 'projectx_security_owner', 'MEMBER')
    );
