import { randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { Client, Pool } from 'pg';
import { asCorrelationId, asIdempotencyKey, asTenantId } from '@projectx/shared';
import { ApprovalApplicationService, InMemoryIdempotencyStore, MissionOrchestratorService, PostgresApprovalRepository, PostgresMissionRepository } from '@projectx/mission-orchestrator';
import { OperatorApiService } from '../../../apps/api/src/operator/operator-api.service';
import { applyMigration } from '../../../infra/database/migrations/run';

const rootUrl = process.env.ADMIN_DATABASE_URL ?? 'postgresql://projectx:projectx@127.0.0.1:5433/postgres';
const migrationDir = resolve(__dirname, '../../../infra/database/migrations');
const tenant = 'slice11-tenant';
const workspaceA = '60000000-0000-4000-8000-000000000001';
const workspaceB = '60000000-0000-4000-8000-000000000002';
const userId = '61000000-0000-4000-8000-000000000001';
const missionId = '62000000-0000-4000-8000-000000000001';
let database: string;
let admin: Pool;
let app: Pool;
let operator: OperatorApiService;
let missions: PostgresMissionRepository;
let approvals: PostgresApprovalRepository;

const ctxA = { tenantId: asTenantId(tenant), workspaceId: workspaceA, userId, correlationId: asCorrelationId('slice11-a') };
const ctxB = { ...ctxA, workspaceId: workspaceB, correlationId: asCorrelationId('slice11-b') };

beforeAll(async () => {
  database = `projectx_slice11_${randomUUID().replace(/-/g, '')}`;
  const root = new Client({ connectionString: rootUrl }); await root.connect(); await root.query(`CREATE DATABASE ${database}`); await root.end();
  const url = new URL(rootUrl); url.pathname = `/${database}`;
  const migrator = new Client({ connectionString: url.toString() }); await migrator.connect();
  await migrator.query('CREATE TABLE schema_migrations(filename TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  for (const file of readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort()) await applyMigration(migrator, file, readFileSync(resolve(migrationDir, file), 'utf8'));
  await migrator.end();
  admin = new Pool({ connectionString: url.toString() });
  const appUrl = new URL(url.toString()); appUrl.username = 'projectx_app'; appUrl.password = 'projectx_app'; app = new Pool({ connectionString: appUrl.toString() });
  await admin.query("SELECT set_config('app.current_tenant',$1,false)", [tenant]);
  await admin.query('INSERT INTO identity.users(id,email,tenant_id) VALUES($1,$2,$3)', [userId, 'slice11@example.test', tenant]);
  await admin.query('INSERT INTO identity.workspaces(id,tenant_id,name,owner_user_id) VALUES($1,$2,$3,$4),($5,$2,$6,$4)', [workspaceA, tenant, 'A', userId, workspaceB, 'B']);
  await admin.query("INSERT INTO intelligence.accounts(account_id,tenant_id,workspace_id,name) VALUES('account-a',$1,$2,'Account')", [tenant, workspaceA]);
  await admin.query("INSERT INTO intelligence.contacts(contact_id,tenant_id,workspace_id,account_id,status,verification_state) VALUES('contact-a',$1,$2,'account-a','VALIDATED','VERIFIED')", [tenant, workspaceA]);
  await admin.query("INSERT INTO intelligence.leads(tenant_id,id,payload,workspace_id,account_id,contact_id,status) VALUES($1,'lead-a',$2,$3,'account-a','contact-a','QUALIFIED')", [tenant, JSON.stringify({ workspaceId: workspaceA }), workspaceA]);
  await admin.query("INSERT INTO mission.missions(id,tenant_id,workspace_id,workspace_binding_state,owner_user_id,name,objective,icp_id,status) VALUES($1,$2,$3,'WORKSPACE_BOUND',$4,'Mission A','Objective','icp','EXECUTING')", [missionId, tenant, workspaceA, userId]);
  await admin.query("INSERT INTO outreach.campaigns(tenant_id,workspace_id,id,lead_id,contact_id,recipient_fingerprint,recipient_protection_state,payload) VALUES($1,$2,'campaign-a','lead-a','contact-a','h1.v1.fingerprint','PROTECTED','{}')", [tenant, workspaceA]);
  await admin.query("INSERT INTO outreach.sequences(tenant_id,workspace_id,id,campaign_id,lead_id,contact_id,recipient_fingerprint,recipient_ciphertext,recipient_protection_state,payload) VALUES($1,$2,'sequence-a','campaign-a','lead-a','contact-a','h1.v1.fingerprint','e1.v1.ciphertext','PROTECTED','{}')", [tenant, workspaceA]);
  await admin.query("INSERT INTO outreach.message_executions(tenant_id,workspace_id,id,campaign_id,sequence_id,lead_id,contact_id,recipient_fingerprint,recipient_ciphertext,recipient_protection_state,idempotency_key,status,payload) VALUES($1,$2,'execution-a','campaign-a','sequence-a','lead-a','contact-a','h1.v1.fingerprint','e1.v1.ciphertext','PROTECTED','idem-a','DELIVERED','{}')", [tenant, workspaceA]);
  await admin.query("INSERT INTO conversation.conversations(tenant_id,workspace_id,id,lead_id,execution_id,payload) VALUES($1,$2,'conversation-a','lead-a','execution-a',$3)", [tenant, workspaceA, JSON.stringify({ channel: 'email', status: 'OPEN', messages: [], optedOut: false, createdAt: new Date(), updatedAt: new Date() })]);
  operator = new OperatorApiService(app); missions = new PostgresMissionRepository({ pool: app }); approvals = new PostgresApprovalRepository({ pool: app });
}, 180_000);

afterAll(async () => {
  await app?.end(); await admin?.end(); const root = new Client({ connectionString: rootUrl }); await root.connect();
  await root.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [database]); await root.query(`DROP DATABASE IF EXISTS ${database}`); await root.end();
}, 60_000);

describe('Slice 11 PostgreSQL API ownership acceptance', () => {
  it.each([
    ['Lead', 'lead', 'lead-a'], ['Campaign', 'campaign', 'campaign-a'], ['Sequence', 'sequence', 'sequence-a'],
    ['MessageExecution', 'execution', 'execution-a'], ['Conversation', 'conversation', 'conversation-a'],
  ])('allows workspace A and denies workspace B access to %s', async (_name, method, id) => {
    await expect((operator[method as keyof OperatorApiService] as any)(ctxA, id)).resolves.toMatchObject({ id });
    await expect((operator[method as keyof OperatorApiService] as any)(ctxB, id)).rejects.toMatchObject({ status: 404 });
  });

  it('same principal in workspace B cannot read, pause, resume, or cancel workspace A Mission', async () => {
    expect(await missions.findById(ctxA, missionId)).not.toBeNull();
    expect(await missions.findById(ctxB, missionId)).toBeNull();
    const service = new MissionOrchestratorService({
      missionRepository: missions,
      eventBus: { publish: async () => undefined, sendCommand: async () => undefined, subscribe: async () => undefined },
      workflowClient: { start: async () => ({} as never), signal: async () => undefined, query: async () => undefined as never, cancel: async () => undefined },
      idempotencyStore: new InMemoryIdempotencyStore(), generateIdempotencyKey: () => asIdempotencyKey(randomUUID()),
      generateEventId: () => randomUUID() as never, generateCorrelationId: () => asCorrelationId(randomUUID()),
    });
    await expect(service.pauseMission(ctxB, { missionId: missionId as never, reason: 'cross-workspace' })).rejects.toThrow();
    await expect(service.resumeMission(ctxB, { missionId: missionId as never })).rejects.toThrow();
    await expect(service.cancelMission(ctxB, { missionId: missionId as never, reason: 'cross-workspace' })).rejects.toThrow();
  });

  it('derives Approval workspace from Mission and persists authenticated decision actor', async () => {
    const service = new ApprovalApplicationService({
      approvalRepository: approvals, missionRepository: missions,
      workflowClient: { start: async () => ({} as never), signal: async () => undefined, query: async () => undefined as never, cancel: async () => undefined },
      notificationPort: { notifyApprovalRequested: async () => undefined }, generateApprovalId: () => '63000000-0000-4000-8000-000000000001',
      generateEventId: () => randomUUID() as never, generateCorrelationId: () => asCorrelationId(randomUUID()),
    });
    const approvalId = await service.requestApproval(ctxA, { missionId, actionType: 'MISSION_CONTROL', riskCategory: 'HIGH', proposedAction: {}, evidence: [], reasoning: 'Operator decision', confidence: 1, requestedBy: userId, approverRole: 'OPERATOR', timeoutSeconds: 3600, idempotencyKey: asIdempotencyKey('slice11-approval') });
    await expect(service.approve(ctxB, { approvalId, actorId: userId, reason: 'Cross-workspace attempt', decision: 'APPROVED' })).rejects.toThrow('Approval access denied');
    await expect(service.reject(ctxB, { approvalId, actorId: userId, reason: 'Cross-workspace attempt', decision: 'REJECTED' })).rejects.toThrow('Approval access denied');
    await service.approve(ctxA, { approvalId, actorId: userId, reason: 'Approved by authenticated operator', decision: 'APPROVED' });
    expect(await approvals.load(ctxB, approvalId)).toBeNull();
    const stored = await approvals.load(ctxA, approvalId);
    expect(stored).toMatchObject({ workspaceId: workspaceA, decidedBy: userId, status: 'APPROVED' });
    const row = await admin.query('SELECT workspace_id,payload->>\'decidedBy\' decided_by FROM mission.approvals WHERE id=$1', [approvalId]);
    expect(row.rows[0]).toEqual({ workspace_id: workspaceA, decided_by: userId });
  });

  it('operator responses omit protected recipient snapshots', async () => {
    const [campaign, sequence, execution] = await Promise.all([operator.campaign(ctxA, 'campaign-a'), operator.sequence(ctxA, 'sequence-a'), operator.execution(ctxA, 'execution-a')]);
    const response = JSON.stringify({ campaign, sequence, execution });
    expect(response).not.toContain('e1.v1.ciphertext');
    expect(response).not.toContain('h1.v1.fingerprint');
  });
});
