import type { OutreachSequence } from '@projectx/domain';
import { ensureSameTenant, type TenantContext } from '@projectx/domain';
import type { CampaignId, SequenceId } from '@projectx/shared';
import type { ISequenceRepository } from '../ports/outreach-repository.interface';

export class InMemorySequenceRepository implements ISequenceRepository {
  private readonly store = new Map<string, OutreachSequence>();

  private key(tenantId: string, sequenceId: string): string {
    return `${tenantId}:${sequenceId}`;
  }

  async save(ctx: TenantContext, sequence: OutreachSequence): Promise<void> {
    ensureSameTenant(ctx, sequence.tenantId);
    this.store.set(this.key(ctx.tenantId as string, sequence.id as string), sequence);
  }

  async load(ctx: TenantContext, sequenceId: SequenceId): Promise<OutreachSequence | null> {
    for (const sequence of this.store.values()) {
      if (sequence.id === sequenceId) {
        ensureSameTenant(ctx, sequence.tenantId);
        return sequence;
      }
    }
    return null;
  }

  async findByCampaign(ctx: TenantContext, campaignId: CampaignId): Promise<OutreachSequence[]> {
    const results: OutreachSequence[] = [];
    for (const sequence of this.store.values()) {
      if (sequence.tenantId === ctx.tenantId && sequence.campaignId === campaignId) {
        results.push(sequence);
      }
    }
    return results;
  }
}
