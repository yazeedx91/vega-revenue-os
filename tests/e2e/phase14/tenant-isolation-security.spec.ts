import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import type { ApprovalId } from '@projectx/domain';
import { PostgresClient } from '@projectx/infrastructure';
import { Approval } from '@projectx/mission-orchestrator';
import { ApprovalVerificationAdapter, InMemoryApprovalRepository } from '@projectx/mission-orchestrator';
import {
  InMemoryOutreachProviderRegistry,
  PostgresCampaignRepository,
  PostgresMessageExecutionRepository,
  PostgresSequenceRepository,
  PostgresTenantEmailConfigRepository,
  StubEmailProvider,
} from '@projectx/outreach';
import {
  asCampaignId,
  asCorrelationId,
  asEventId,
  asIdempotencyKey,
  asOutreachExecutionId,
  asSequenceId,
  asTenantId,
  asUserId,
} from '@projectx/shared';
import type { OutreachExecutionId } from '@projectx/shared';
import {
  buildCampaign,
  buildLead,
  buildPlan,
  buildSequence,
  connectPostgres,
  createDurableAdapters,
  createExecutionService,
  createTenantContext,
  requireEnv,
  runMigrations,
  seedOutreachOwnership,
} from './helpers';
import { getAdminDatabaseUrl, getAppDatabaseUrl } from './integration-config';

const SENTINEL_SECRET = 'P0_2_SENTINEL_SECRET_DO_NOT_LEAK';
const SENTINEL_REF = 'P0_2_SENTINEL_REF';

function mailboxFor(tenantId: string): string {
  return `inbound-${tenantId}@contoso.onmicrosoft.com`;
}

function normalize(from: string): string {
  return from.trim().toLowerCase();
}

async function seedTenantConfig(
  admin: Pool,
  tenantId: string,
  allowedDomain: string,
  fromAddress: string,
): Promise<void> {
  await admin.query(
    `
      INSERT INTO outreach.tenant_email_config (
        tenant_id, provider_id, channel, from_address, allowed_domains,
        graph_client_secret_reference, webhook_secret_reference
      )
      VALUES ($1, 'graph-email', 'email', $2, $3, $4, $5)
      ON CONFLICT (tenant_id, provider_id) DO UPDATE
        SET from_address = EXCLUDED.from_address,
            allowed_domains = EXCLUDED.allowed_domains,
            graph_client_secret_reference = EXCLUDED.graph_client_secret_reference,
            webhook_secret_reference = EXCLUDED.webhook_secret_reference
    `,
    [tenantId, fromAddress, [allowedDomain], SENTINEL_REF, `${tenantId}-webhook-ref`],
  );
  await admin.query(
    `
      INSERT INTO outreach.inbound_mailbox_registry (normalized_mailbox, tenant_id, provider_id, channel)
      VALUES ($1, $2, 'graph-email', 'email')
      ON CONFLICT (normalized_mailbox) DO NOTHING
    `,
    [normalize(fromAddress), tenantId],
  );
}

async function seedAllowlist(admin: Pool, tenantId: string, address: string): Promise<void> {
  await admin.query(
    `INSERT INTO outreach.allowed_recipients (tenant_id, email_address, approved_by)
     VALUES ($1, $2, 'p0-2-test')
     ON CONFLICT (tenant_id, email_address) DO NOTHING`,
    [tenantId, address],
  );
}

describe('Phase 14 P0-2 tenant isolation, RLS and secrets', () => {
  let adminPool: Pool;
  let appPool: Pool;
  let appClient: PostgresClient;

  const tenantA = `tenant-p0-2-a-${randomUUID()}`;
  const tenantB = `tenant-p0-2-b-${randomUUID()}`;

  beforeAll(async () => {
    process.env.OUTREACH_LIVE_EMAIL_ENABLED = 'false';
    process.env.P0_2_SENTINEL_SECRET = SENTINEL_SECRET;
    requireEnv();
    adminPool = await connectPostgres(getAdminDatabaseUrl());
    appPool = await connectPostgres(getAppDatabaseUrl());
    appClient = new PostgresClient(appPool);
    await runMigrations();

    // Seed two isolated tenants.
    const aFrom = mailboxFor(tenantA);
    const bFrom = mailboxFor(tenantB);
    await Promise.all([
      seedTenantConfig(adminPool, tenantA, 'contoso.onmicrosoft.com', aFrom),
      seedTenantConfig(adminPool, tenantB, 'fabrikam.onmicrosoft.com', bFrom),
      seedAllowlist(adminPool, tenantA, 'allowed-a@example.com'),
      seedAllowlist(adminPool, tenantB, 'allowed-b@example.com'),
    ]);
  }, 120_000);

  afterAll(async () => {
    await adminPool?.end();
    await appPool?.end();
  });

  it('projectx_app has no superuser or RLS bypass privileges', async () => {
    const result = await adminPool.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'projectx_app'`,
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].rolsuper).toBe(false);
    expect(result.rows[0].rolbypassrls).toBe(false);
  });

  it('app role cannot read the inbound mailbox registry directly', async () => {
    await expect(
      appPool.query(
        `SELECT tenant_id FROM outreach.inbound_mailbox_registry WHERE normalized_mailbox = $1`,
        [mailboxFor(tenantA)],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('app role resolves inbound mailboxes only through the narrow function', async () => {
    const aResult = await appClient.query(
      `SELECT * FROM outreach.resolve_inbound_mailbox($1)`,
      [mailboxFor(tenantA)],
    );
    expect(aResult.rowCount).toBe(1);
    expect(aResult.rows[0].tenant_id).toBe(tenantA);

    const bResult = await appClient.query(
      `SELECT * FROM outreach.resolve_inbound_mailbox($1)`,
      [mailboxFor(tenantB)],
    );
    expect(bResult.rowCount).toBe(1);
    expect(bResult.rows[0].tenant_id).toBe(tenantB);

    const missing = await appClient.query(
      `SELECT * FROM outreach.resolve_inbound_mailbox($1)`,
      ['unknown@contoso.onmicrosoft.com'],
    );
    expect(missing.rowCount).toBe(0);
  });

  it('resolve_inbound_mailbox is owned by projectx_security_owner with least privilege', async () => {
    const owner = await adminPool.query(`
      SELECT r.rolname, r.rolsuper, r.rolbypassrls
      FROM pg_proc p
      JOIN pg_roles r ON p.proowner = r.oid
      WHERE p.proname = 'resolve_inbound_mailbox'
    `);
    expect(owner.rowCount).toBe(1);
    expect(owner.rows[0].rolname).toBe('projectx_security_owner');
    expect(owner.rows[0].rolsuper).toBe(false);
    expect(owner.rows[0].rolbypassrls).toBe(false);

    const publicExec = await adminPool.query(
      `SELECT has_function_privilege('public', 'outreach.resolve_inbound_mailbox(text)', 'EXECUTE') AS can`,
    );
    expect(publicExec.rows[0].can).toBe(false);

    const appExec = await adminPool.query(
      `SELECT has_function_privilege('projectx_app', 'outreach.resolve_inbound_mailbox(text)', 'EXECUTE') AS can`,
    );
    expect(appExec.rows[0].can).toBe(true);

    const proconfig = await adminPool.query(
      `SELECT proconfig FROM pg_proc WHERE proname = 'resolve_inbound_mailbox'`,
    );
    expect(proconfig.rowCount).toBe(1);
    const proconfigValue = JSON.stringify(proconfig.rows[0].proconfig);
    expect(proconfigValue).toContain('pg_catalog, outreach');
    expect(proconfigValue).not.toContain('public');
    expect(proconfigValue).not.toContain('outreach, pg_catalog');

    const result = await appClient.query(
      `SELECT * FROM outreach.resolve_inbound_mailbox($1)`,
      [mailboxFor(tenantA)],
    );
    expect(result.rowCount).toBe(1);
    expect(Object.keys(result.rows[0]).sort()).toEqual(['channel', 'provider_id', 'tenant_id']);
  });

  it('PostgresTenantEmailConfigRepository keeps tenant_email_config under RLS', async () => {
    const repo = new PostgresTenantEmailConfigRepository({ pool: appPool });

    const aConfig = await repo.findByMailboxAddress(mailboxFor(tenantA));
    expect(aConfig).not.toBeNull();
    expect(aConfig?.tenantId).toBe(tenantA);
    expect(aConfig?.graphClientSecretReference).toBe(SENTINEL_REF);

    const bConfig = await repo.findByMailboxAddress(mailboxFor(tenantB));
    expect(bConfig).not.toBeNull();
    expect(bConfig?.tenantId).toBe(tenantB);

    const missing = await repo.findByMailboxAddress('unknown@contoso.onmicrosoft.com');
    expect(missing).toBeNull();
  });

  it('tenant A app connection cannot read tenant B rows', async () => {
    const campaign = buildCampaign(tenantA, 'campaign-a');
    const repo = new PostgresCampaignRepository({ pool: appPool });
    const ctxA = createTenantContext(tenantA);
    await seedOutreachOwnership(adminPool, tenantA, String(campaign.leadId), campaign.contactId, campaign.recipientFingerprint);
    await repo.save(ctxA, campaign);

    const ctxB = createTenantContext(tenantB);
    const cross = await repo.load(ctxB, campaign.id);
    expect(cross).toBeNull();
  });

  it('tenant-scoped reads fail closed when app.current_tenant is unset', async () => {
    const result = await appPool.query(
      `SELECT * FROM outreach.campaigns WHERE tenant_id = $1`,
      [tenantA],
    );
    expect(result.rowCount).toBe(0);
  });

  it('direct SQL cross-tenant read/update/delete is blocked by RLS', async () => {
    // Seed a sequence for A directly via admin so we know the PK.
    const campaign = buildCampaign(tenantA, 'campaign-rls');
    const sequence = buildSequence(tenantA, campaign.id, 'seq-rls');
    const ctxA = createTenantContext(tenantA);
    await seedOutreachOwnership(adminPool, tenantA, String(sequence.leadId), sequence.contactId, sequence.recipientFingerprint, sequence.recipientCiphertext);
    await new PostgresCampaignRepository({ pool: appPool }).save(ctxA, campaign);
    const repo = new PostgresSequenceRepository({ pool: appPool });
    await repo.save(ctxA, sequence);

    // Tenant B cannot see it.
    await appClient.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantB]);
    const readAsB = await appClient.query('SELECT * FROM outreach.sequences WHERE id = $1', [
      sequence.id,
    ]);
    expect(readAsB.rowCount).toBe(0);

    // Tenant B cannot update or delete it.
    const update = await appClient.query(
      'UPDATE outreach.sequences SET version = 999 WHERE id = $1',
      [sequence.id],
    );
    expect(update.rowCount).toBe(0);
    const remove = await appClient.query(
      'DELETE FROM outreach.sequences WHERE id = $1',
      [sequence.id],
    );
    expect(remove.rowCount).toBe(0);
  });

  it('ApprovalVerificationAdapter rejects cross-tenant and mismatched idempotency key approvals', async () => {
    const repo = new InMemoryApprovalRepository();
    const approval = Approval.create(
      {
        id: 'approval-a' as unknown as ApprovalId,
        tenantId: asTenantId(tenantA),
        workspaceId: createTenantContext(tenantA).workspaceId,
        workspaceBindingState: 'WORKSPACE_BOUND',
        missionId: 'mission-a',
        sequenceId: asSequenceId('seq-a'),
        executionId: asOutreachExecutionId('exec-a'),
        idempotencyKey: asIdempotencyKey('idmp-a'),
        actionType: 'OUTREACH_EMAIL_SEND',
        riskCategory: 'low',
        proposedAction: {},
        evidence: [],
        reasoning: 'test',
        confidence: 0.9,
        requestedBy: 'e2e',
        approverRole: 'operator',
        timeoutSeconds: 3600,
        correlationId: asCorrelationId('corr-a'),
      },
      asEventId('evt-approval-a'),
    );
    if (!approval.success) throw new Error('Failed to create test approval');
    approval.value.approve(asUserId('e2e-operator'), 'approved', asCorrelationId('corr'), asEventId('evt'));
    await repo.save(createTenantContext(tenantA), approval.value);

    const verifyA = new ApprovalVerificationAdapter(repo);
    const resultA = await verifyA.verify(createTenantContext(tenantA), {
      approvalId: approval.value.id,
      campaignId: asCampaignId('campaign-a'),
      sequenceId: asSequenceId('seq-a'),
      executionId: asOutreachExecutionId('exec-a'),
      idempotencyKey: asIdempotencyKey('idmp-a'),
      recipientAddress: 'allowed-a@example.com',
      actionType: 'OUTREACH_EMAIL_SEND',
      correlationId: asCorrelationId('corr-ok'),
    });
    expect(resultA.outcome).toBe('APPROVED');

    const wrongTenant = await verifyA.verify(createTenantContext(tenantB), {
      approvalId: approval.value.id,
      campaignId: asCampaignId('campaign-a'),
      sequenceId: asSequenceId('seq-a'),
      executionId: asOutreachExecutionId('exec-a'),
      idempotencyKey: asIdempotencyKey('idmp-a'),
      recipientAddress: 'allowed-a@example.com',
      actionType: 'OUTREACH_EMAIL_SEND',
      correlationId: asCorrelationId('corr-bad-tenant'),
    });
    // The in-memory repository is tenant-scoped, so a cross-tenant lookup is
    // indistinguishable from a missing approval — still a denial.
    expect(wrongTenant.outcome).toBe('NOT_FOUND');

    const wrongKey = await verifyA.verify(createTenantContext(tenantA), {
      approvalId: approval.value.id,
      campaignId: asCampaignId('campaign-a'),
      sequenceId: asSequenceId('seq-a'),
      executionId: asOutreachExecutionId('exec-a'),
      idempotencyKey: asIdempotencyKey('idmp-forged'),
      recipientAddress: 'allowed-a@example.com',
      actionType: 'OUTREACH_EMAIL_SEND',
      correlationId: asCorrelationId('corr-bad-key'),
    });
    expect(wrongKey.outcome).toBe('WRONG_TARGET');
  });

  it('executeApprovedSend fails closed for cross-tenant campaign/sequence/execution', async () => {
    const adapters = await createDurableAdapters();
    try {
      const ctxA = createTenantContext(tenantA);
      const recipientAddress = 'allowed-a@example.com';
      const campaign = buildCampaign(tenantA, `campaign-exec-${Date.now()}`, recipientAddress);
      const sequence = buildSequence(tenantA, campaign.id, `seq-exec-${Date.now()}`, recipientAddress);
      const recipient = { channel: 'email', address: recipientAddress } as const;

      const plan = buildPlan(campaign.id, sequence.id, recipient);
      const lead = buildLead(tenantA);
      const evidence = [];

      await adapters.campaignRepository.save(ctxA, campaign);
      await adapters.sequenceRepository.save(ctxA, sequence);
      const { service, approvalRepo } = createExecutionService(adapters, tenantA, new StubEmailProvider());
      const draft = await service.prepareDraft(ctxA, sequence.id, plan, lead, evidence);
      expect(draft.status).toBe('AWAITING_APPROVAL');

      const execution = await adapters.executionRepository.load(ctxA, draft.executionId as OutreachExecutionId);
      if (!execution) throw new Error('Execution not found after prepare');

      const approval = Approval.create(
        {
          id: `approval-exec-${Date.now()}` as unknown as ApprovalId,
          tenantId: asTenantId(tenantA),
          workspaceId: ctxA.workspaceId,
          workspaceBindingState: 'WORKSPACE_BOUND',
          missionId: `mission-${Date.now()}`,
          sequenceId: sequence.id,
          executionId: draft.executionId,
          idempotencyKey: execution.idempotencyKey,
          actionType: 'OUTREACH_EMAIL_SEND',
          riskCategory: 'low',
          proposedAction: {},
          evidence: [],
          reasoning: 'test',
          confidence: 0.9,
          requestedBy: 'e2e',
          approverRole: 'operator',
          timeoutSeconds: 3600,
          correlationId: asCorrelationId('corr-approval'),
        },
        asEventId('evt-approval-exec'),
      );
      if (!approval.success) throw new Error('Approval creation failed');
      approval.value.approve(asUserId('e2e-operator'), 'approved', asCorrelationId('corr-approve'), asEventId('evt-approve'));
      await approvalRepo.save(ctxA, approval.value);

      const resultA = await service.executeApprovedSend(
        ctxA,
        draft.executionId as OutreachExecutionId,
        approval.value.id,
      );
      expect(resultA.status).toBe('COMPLETED');

      // A forged/misdirected request using Tenant B context must not send.
      const ctxB = createTenantContext(tenantB);
      const crossResult = await service.executeApprovedSend(
        ctxB,
        draft.executionId as OutreachExecutionId,
        approval.value.id,
      );
      expect(crossResult.status).toBe('FAILED');
    } finally {
      await adapters.dispose();
    }
  });

  it('InMemoryOutreachProviderRegistry isolates tenant mappings', async () => {
    const registry = new InMemoryOutreachProviderRegistry();
    const stubA = new StubEmailProvider({ type: 'success', costUsd: 0.05 });
    const stubB = new StubEmailProvider({ type: 'success', costUsd: 0.05 });
    registry.register(stubA);
    registry.register(stubB);
    registry.setTenantProvider(tenantA, 'email', stubA.providerId);
    registry.setTenantProvider(tenantB, 'email', stubB.providerId);

    const selectedA = await registry.select(createTenantContext(tenantA), 'email');
    expect(selectedA?.providerId).toBe(stubA.providerId);

    const selectedB = await registry.select(createTenantContext(tenantB), 'email');
    expect(selectedB?.providerId).toBe(stubB.providerId);

    const selectedUnknown = await registry.select(createTenantContext(`unknown-${Date.now()}`), 'email');
    expect(selectedUnknown).toBeNull();
  });

  it('sentinel secret does not appear in DB or service outputs', async () => {
    const repo = new PostgresTenantEmailConfigRepository({ pool: appPool });
    const aConfig = await repo.findByMailboxAddress(mailboxFor(tenantA));
    expect(aConfig).not.toBeNull();

    // The real secret must never be serialized or returned; only the reference.
    const output = JSON.stringify(aConfig);
    expect(output).not.toContain(SENTINEL_SECRET);
    expect(aConfig?.graphClientSecretReference).toBe(SENTINEL_REF);

    // No business table should contain the literal secret.
    const tables = [
      'outreach.tenant_email_config',
      'outreach.inbound_mailbox_registry',
      'outreach.campaigns',
      'outreach.sequences',
      'outreach.allowed_recipients',
      'idempotency.keys',
      'audit.audit_log',
    ];
    for (const table of tables) {
      const result = await adminPool.query(
        `SELECT 1 FROM ${table} AS t WHERE t::text ILIKE $1 LIMIT 1`,
        [`%${SENTINEL_SECRET}%`],
      );
      expect(result.rowCount).toBe(0);
    }
  });
});
