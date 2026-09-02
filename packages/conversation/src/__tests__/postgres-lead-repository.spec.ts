import type { Pool } from 'pg';
import { Lead } from '@projectx/domain';
import { FakePgPool } from '@projectx/infrastructure';
import { asAccountId, asContactId, asCorrelationId, asEventId, asICPProfileId, asLeadId, asTenantId } from '@projectx/shared';
import { PostgresLeadRepository } from '../infrastructure/postgres-lead-repository';

describe('PostgresLeadRepository', () => {
  const tenantId = asTenantId('tenant-1');
  const ctx = { tenantId, correlationId: asCorrelationId('corr-1') };

  function makeLead() {
    return Lead.create(
      {
        id: asLeadId('lead-1'),
        tenantId,
        accountId: asAccountId('acc-1'),
        contactId: asContactId('contact-1'),
        icpProfileId: asICPProfileId('icp-1'),
      },
      asCorrelationId('corr-1'),
      asEventId('evt-1'),
    );
  }

  function makeRepo() {
    return new PostgresLeadRepository({ pool: new FakePgPool() as unknown as Pool });
  }

  it('preserves scores, status, and dates across save/reload', async () => {
    const repo = makeRepo();
    const lead = makeLead();
    lead.evaluate(
      { icpMatch: 0.9, signalScore: 0.8, intentScore: 0.7, evidenceConfidence: 0.9, overall: 0.85 },
      0.75,
      0.55,
      [],
      'strong match',
      asCorrelationId('c2'),
      asEventId('e2'),
    );

    await repo.save(ctx, lead);
    const reloaded = await repo.load(ctx, lead.id);

    expect(reloaded).not.toBeNull();
    expect(reloaded!.status).toBe('QUALIFIED');
    expect(reloaded!.scores.overall).toBeCloseTo(0.85);
    expect(reloaded!.createdAt).toBeInstanceOf(Date);
    expect(reloaded!.updatedAt).toBeInstanceOf(Date);
  });

  it('does not return a lead belonging to another tenant', async () => {
    const repo = makeRepo();
    const lead = makeLead();
    await repo.save(ctx, lead);

    const otherCtx = { tenantId: asTenantId('tenant-2'), correlationId: asCorrelationId('c') };
    const result = await repo.load(otherCtx, lead.id);
    expect(result).toBeNull();
  });
});
