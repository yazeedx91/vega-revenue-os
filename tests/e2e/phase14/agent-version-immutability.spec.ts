import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { asCorrelationId, asTenantId, asUserId } from '@projectx/shared';
import { NoOpTelemetry, PostgresClient, PostgresAuditLog } from '@projectx/infrastructure';
import {
  AgentLifecycleService,
  ControlPlaneService,
  ImmutableAgentVersionConflict,
  PostgresAgentRepository,
  PostgresAuditSink,
  type AgentVersion,
} from '@projectx/control-plane';
import { connectPostgres, runMigrations } from './helpers';

const TENANT_A = 'tenant-a';
const AGENT_ID = 'immutable-test-agent';
const CAPABILITY_ID = 'test-capability';

function makeCtx() {
  return {
    tenantId: asTenantId(TENANT_A),
    correlationId: asCorrelationId(randomUUID()),
    userId: asUserId('tester'),
  };
}

async function activate(
  svc: AgentLifecycleService,
  ctx: any,
  agentId: string,
  version: string,
) {
  await svc.transition(ctx, agentId, version, 'TESTING');
  await svc.transition(ctx, agentId, version, 'APPROVED');
  await svc.transition(ctx, agentId, version, 'ACTIVE');
}

function makeVersion(
  version: string,
  implementationKey: string,
  capabilities: string[] = [CAPABILITY_ID],
  lifecycle: AgentVersion['lifecycle'] = 'DRAFT',
): AgentVersion {
  return {
    versionId: `${AGENT_ID}:${version}`,
    agentId: AGENT_ID,
    tenantId: asTenantId(TENANT_A),
    isSystem: false,
    version,
    lifecycle,
    implementationKey,
    definition: {
      agentId: AGENT_ID,
      name: 'Test Agent',
      role: 'tester',
      description: 'An agent for immutability tests',
      capabilities,
      tools: [],
      policies: [],
      modelPolicy: { preferredModelFamily: '', maxCostPerTaskUsd: 0, maxTokensPerTask: 0 },
      memoryPolicy: { read: [], write: [], validationRequired: false },
      knowledgePolicy: { read: [], write: [] },
      autonomyLevelDefault: 5,
      evaluationPolicy: { criteria: [], minScore: 0 },
      owner: 'test-owner',
      version,
      lifecycle,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any,
  };
}

describe('AgentVersion immutability E2E', () => {
  let pool: Pool | undefined;
  let postgresClient: PostgresClient | undefined;
  let repo: PostgresAgentRepository | undefined;
  let controlPlane: ControlPlaneService | undefined;
  let lifecycle: AgentLifecycleService | undefined;

  beforeAll(async () => {
    await runMigrations();
    pool = await connectPostgres();
    postgresClient = new PostgresClient(pool);

    const auditLog = new PostgresAuditLog({ pool });
    const auditSink = new PostgresAuditSink(auditLog);
    const repoConfig = { client: postgresClient };

    repo = new PostgresAgentRepository(repoConfig);
    controlPlane = new ControlPlaneService({
      agentRepository: repo,
      capabilityRepository: undefined as any,
      modelRepository: undefined as any,
      policyRepository: undefined as any,
      autonomyRepository: undefined as any,
      auditSink,
    });
    lifecycle = new AgentLifecycleService({ agentRepository: repo, auditSink });
  });

  beforeEach(async () => {
    if (!postgresClient) return;
    const ctx = makeCtx();
    await postgresClient.withTenant(ctx, async (client) => {
      await client.query('DELETE FROM control_plane.agent_versions WHERE agent_id = $1', [AGENT_ID]);
    });
  });

  afterAll(async () => {
    if (postgresClient) await postgresClient.end();
  });

  it('v1 identical re-seed is idempotent', async () => {
    const ctx = makeCtx();
    const v1 = makeVersion('1.0.0', 'impl.v1');
    await controlPlane!.registerAgentVersion(ctx, v1);
    await activate(lifecycle!, ctx, AGENT_ID, '1.0.0');

    // Re-register the same definition (still carrying DRAFT lifecycle) must be a no-op.
    await expect(controlPlane!.registerAgentVersion(ctx, v1)).resolves.toBeUndefined();

    const active = await repo!.getActiveVersion(ctx, AGENT_ID, '1.0.0');
    expect(active).not.toBeNull();
    expect(active!.lifecycle).toBe('ACTIVE');
    expect(active!.implementationKey).toBe('impl.v1');
  });

  it('v1 different implementation key is rejected when ACTIVE', async () => {
    const ctx = makeCtx();
    const v1 = makeVersion('1.0.0', 'impl.v1');
    await controlPlane!.registerAgentVersion(ctx, v1);
    await activate(lifecycle!, ctx, AGENT_ID, '1.0.0');

    const v1Changed = makeVersion('1.0.0', 'impl.v1.CHANGED');
    await expect(controlPlane!.registerAgentVersion(ctx, v1Changed)).rejects.toThrow(
      ImmutableAgentVersionConflict,
    );

    const active = await repo!.getActiveVersion(ctx, AGENT_ID, '1.0.0');
    expect(active!.implementationKey).toBe('impl.v1');
  });

  it('v1 different capabilities are rejected when ACTIVE', async () => {
    const ctx = makeCtx();
    const v1 = makeVersion('1.0.0', 'impl.v1', [CAPABILITY_ID]);
    await controlPlane!.registerAgentVersion(ctx, v1);
    await activate(lifecycle!, ctx, AGENT_ID, '1.0.0');

    const v1Changed = makeVersion('1.0.0', 'impl.v1', ['other-capability']);
    await expect(controlPlane!.registerAgentVersion(ctx, v1Changed)).rejects.toThrow(
      ImmutableAgentVersionConflict,
    );

    const active = await repo!.getActiveVersion(ctx, AGENT_ID, '1.0.0');
    expect(active!.definition.capabilities).toEqual([CAPABILITY_ID]);
  });

  it('v2 new implementation is allowed', async () => {
    const ctx = makeCtx();
    const v1 = makeVersion('1.0.0', 'impl.v1');
    const v2 = makeVersion('2.0.0', 'impl.v2');
    await controlPlane!.registerAgentVersion(ctx, v1);
    await controlPlane!.registerAgentVersion(ctx, v2);
    await activate(lifecycle!, ctx, AGENT_ID, '1.0.0');
    await activate(lifecycle!, ctx, AGENT_ID, '2.0.0');

    const all = await repo!.listActiveVersions(ctx);
    const versions = all.filter((v) => v.agentId === AGENT_ID);
    expect(versions.length).toBe(2);
    expect(versions.map((v) => [v.version, v.implementationKey])).toEqual([
      ['2.0.0', 'impl.v2'],
      ['1.0.0', 'impl.v1'],
    ]);
  });

  it('two concurrent writers cannot mutate an immutable ACTIVE version', async () => {
    const ctx = makeCtx();
    const v1 = makeVersion('1.0.0', 'impl.v1');
    await controlPlane!.registerAgentVersion(ctx, v1);
    await activate(lifecycle!, ctx, AGENT_ID, '1.0.0');

    const v1AltA = makeVersion('1.0.0', 'impl.v1.A');
    const v1AltB = makeVersion('1.0.0', 'impl.v1.B');

    const results = await Promise.allSettled([
      repo!.saveVersion(ctx, v1AltA),
      repo!.saveVersion(ctx, v1AltB),
    ]);

    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');

    const active = await repo!.getActiveVersion(ctx, AGENT_ID, '1.0.0');
    expect(active!.implementationKey).toBe('impl.v1');
  });
});
