import type { Pool } from 'pg';
import { OutreachCampaign } from '@projectx/domain';
import { FakePgPool } from '@projectx/infrastructure';
import { asCampaignId, asCorrelationId, asEventId, asTenantId } from '@projectx/shared';
import { PostgresCampaignRepository } from '../infrastructure/postgres-campaign-repository';

describe('PostgresCampaignRepository', () => {
  const tenantId = asTenantId('tenant-1');
  const ctx = { tenantId, correlationId: asCorrelationId('corr-1') };

  function makeCampaign() {
    return OutreachCampaign.create(
      {
        id: asCampaignId('camp-1'),
        tenantId,
        leadId: 'lead-1' as any,
        recipient: { contactId: 'c1' as any, channel: 'email', address: 'a@b.com' },
        channel: 'email',
        steps: [{ stepNumber: 1, channel: 'email', delayMs: 0, requiresApproval: true, objective: 'first-touch' }],
        missionId: 'm-1',
      },
      asCorrelationId('corr-1'),
      asEventId('evt-1'),
    );
  }

  function makeRepo() {
    return new PostgresCampaignRepository({ pool: new FakePgPool() as unknown as Pool });
  }

  it('saves and reloads a campaign preserving business state and real Date instances', async () => {
    const repo = makeRepo();
    const campaign = makeCampaign();
    campaign.recordSpend(1, 0.1);
    await repo.save(ctx, campaign);

    const reloaded = await repo.load(ctx, campaign.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.status).toBe('DRAFT');
    expect(reloaded!.sentCount).toBe(1);
    expect(reloaded!.spentCostUsd).toBeCloseTo(0.1);
    expect(reloaded!.createdAt).toBeInstanceOf(Date);
    expect(reloaded!.updatedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(reloaded!.createdAt.getTime())).toBe(false);
  });

  it('preserves state transitions across a save/reload cycle', async () => {
    const repo = makeRepo();
    const campaign = makeCampaign();
    campaign.submitForApproval(asCorrelationId('c2'), asEventId('e2'));
    campaign.approve('approver-1' as any, 'ok', asCorrelationId('c3'), asEventId('e3'));
    await repo.save(ctx, campaign);

    const reloaded = await repo.load(ctx, campaign.id);
    expect(reloaded!.status).toBe('APPROVED');
    // Behavior after reload must work identically to a freshly constructed aggregate.
    const result = reloaded!.start(asCorrelationId('c4'), asEventId('e4'));
    expect(result.success).toBe(true);
    expect(reloaded!.status).toBe('RUNNING');
  });

  it('does not return a campaign belonging to another tenant', async () => {
    const repo = makeRepo();
    const campaign = makeCampaign();
    await repo.save(ctx, campaign);

    const otherCtx = { tenantId: asTenantId('tenant-2'), correlationId: asCorrelationId('c') };
    const result = await repo.load(otherCtx, campaign.id);
    expect(result).toBeNull();
  });
});
