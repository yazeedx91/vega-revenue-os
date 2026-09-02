import type { TenantContext } from '@projectx/domain';

/**
 * Row shape backed by the existing, previously-unused
 * `outreach.tenant_email_config` table (see
 * `infra/database/migrations/001_phase14_initial.sql`). Powers two Milestone
 * 6 inbound-Graph concerns: (1) resolving which tenant owns a given mailbox
 * (`fromAddress`), and (2) verifying a webhook notification's `clientState`
 * against the tenant's registered shared secret (`webhookSecretReference`,
 * a name resolved through `ISecretsProvider` — never a literal secret
 * value stored or passed around in this shape).
 */
export interface TenantEmailConfig {
  readonly tenantId: string;
  readonly providerId: string;
  readonly channel: string;
  readonly fromAddress: string;
  readonly replyToAddress?: string;
  readonly allowedDomains: string[];
  readonly webhookSecretReference?: string;
  readonly graphClientSecretReference?: string;
}

export interface ITenantEmailConfigRepository {
  /** Tenant-scoped read, for admin/config-management call sites. */
  get(ctx: TenantContext, providerId: string): Promise<TenantEmailConfig | null>;
  /**
   * Cross-tenant lookup by mailbox address — deliberately the one place in
   * this port that is NOT tenant-scoped by a caller-supplied `TenantContext`,
   * because resolving the tenant from an inbound webhook mailbox is exactly
   * what this method exists to do. Returns at most one config (mailbox
   * addresses are expected to be provisioned to a single tenant); returns
   * `null` rather than guessing if none is registered.
   */
  findByMailboxAddress(fromAddress: string): Promise<TenantEmailConfig | null>;
}
