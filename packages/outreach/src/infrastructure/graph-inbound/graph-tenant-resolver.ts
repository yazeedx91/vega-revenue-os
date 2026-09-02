import type { ITenantEmailConfigRepository, TenantEmailConfig } from '../../ports/tenant-email-config-repository.interface';

export type GraphTenantResolutionOutcome =
  | { readonly status: 'RESOLVED'; readonly config: TenantEmailConfig }
  | { readonly status: 'NOT_FOUND'; readonly reason: string };

/**
 * Extracts the target mailbox from a Graph change notification's `resource`
 * field (`Users/{mailbox}/Messages/{id}`) and resolves the owning tenant via
 * `ITenantEmailConfigRepository.findByMailboxAddress`. Never guesses: an
 * unrecognized mailbox is `NOT_FOUND`, not a fallback to any default tenant.
 */
export class GraphTenantResolver {
  constructor(private readonly tenantEmailConfigRepository: ITenantEmailConfigRepository) {}

  extractMailbox(resource: string): string | null {
    // Matches `Users/{mailbox}/Messages/{id}` case-insensitively, with or
    // without a leading slash, and with `{mailbox}` being either a UPN/email
    // address or a Graph object id.
    const match = resource.match(/users\/([^/]+)\/messages\//i);
    return match ? decodeURIComponent(match[1]) : null;
  }

  async resolve(resource: string): Promise<GraphTenantResolutionOutcome> {
    const mailbox = this.extractMailbox(resource);
    if (!mailbox) {
      return { status: 'NOT_FOUND', reason: `Could not extract a mailbox from resource "${resource}"` };
    }

    const config = await this.tenantEmailConfigRepository.findByMailboxAddress(mailbox);
    if (!config) {
      return { status: 'NOT_FOUND', reason: `No tenant is registered for mailbox "${mailbox}"` };
    }

    return { status: 'RESOLVED', config };
  }
}
