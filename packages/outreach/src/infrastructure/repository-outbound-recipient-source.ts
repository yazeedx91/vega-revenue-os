import { asCorrelationId, asTenantId } from '@projectx/shared';
import type { IContactRepository, ILeadRepository } from '@projectx/infrastructure';
import type { IOutboundRecipientSource, ResolveProtectedEmailRecipientInput, ResolvedProtectedEmailRecipient } from '../ports/outbound-recipient-source.interface';

export interface RepositoryOutboundRecipientSourceConfig {
  readonly leadRepository: ILeadRepository;
  readonly contactRepository: IContactRepository;
}

export class RepositoryOutboundRecipientSource implements IOutboundRecipientSource {
  constructor(private readonly config: RepositoryOutboundRecipientSourceConfig) {}

  async resolveProtectedEmailRecipient(input: ResolveProtectedEmailRecipientInput): Promise<ResolvedProtectedEmailRecipient> {
    const ctx = {
      tenantId: asTenantId(input.tenantId),
      workspaceId: input.workspaceId,
      correlationId: asCorrelationId(`recipient-source-${input.leadId}`),
    };
    const lead = await this.config.leadRepository.findById(ctx, input.leadId);
    if (!lead || lead.tenantId !== input.tenantId || lead.workspaceId !== input.workspaceId || lead.contactId !== input.contactId) {
      throw new Error('Protected recipient Lead ownership validation failed');
    }
    const contact = await this.config.contactRepository.findById(ctx, input.contactId);
    if (!contact || contact.tenantId !== input.tenantId || contact.workspaceId !== input.workspaceId || contact.id !== lead.contactId) {
      throw new Error('Protected recipient Contact ownership validation failed');
    }
    if (!contact.emailFingerprint || !contact.encryptedEmail) {
      throw new Error('Protected recipient email channel is unavailable');
    }
    return {
      contactId: contact.id,
      recipientFingerprint: contact.emailFingerprint,
      recipientCiphertext: contact.encryptedEmail,
      recipientProtectionState: 'PROTECTED',
    };
  }
}
