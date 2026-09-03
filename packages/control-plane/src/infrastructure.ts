import type { TenantContext } from '@projectx/domain';
import type { AIExecutionRequest } from '@projectx/shared';
import { PostgresClient } from '@projectx/infrastructure';
import type { IAuditLog } from '@projectx/infrastructure';
import { ImmutableAgentVersionConflict } from './domain';
import type {
  AgentVersion,
  AutonomyRule,
  Capability,
  Model,
  PolicyRule,
} from './domain';
import type {
  IAgentRepository,
  IAuditSink,
  IAutonomyRepository,
  ICapabilityRepository,
  IEmergencyStopProvider,
  IModelRepository,
  IPolicyRepository,
} from './ports';

export interface PostgresControlPlaneRepositoryConfig {
  readonly client: PostgresClient;
}

function safeJson(a: unknown): string {
  return JSON.stringify(a, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a as string).localeCompare(b as string)));
    }
    return v;
  }) ?? '';
}

function areVersionDefinitionsEqual(a: AgentVersion, b: AgentVersion): string | null {
  if (a.implementationKey !== b.implementationKey) return `implementationKey: ${a.implementationKey} != ${b.implementationKey}`;
  if (a.tenantId !== b.tenantId) return `tenantId: ${a.tenantId} != ${b.tenantId}`;
  if (a.isSystem !== b.isSystem) return `isSystem: ${a.isSystem} != ${b.isSystem}`;
  const ad = a.definition;
  const bd = b.definition;
  if (ad.name !== bd.name) return `name: ${ad.name} != ${bd.name}`;
  if (ad.role !== bd.role) return `role: ${ad.role} != ${bd.role}`;
  if (ad.description !== bd.description) return `description: ${ad.description} != ${bd.description}`;
  if (safeJson(ad.capabilities) !== safeJson(bd.capabilities)) return `capabilities: ${safeJson(ad.capabilities)} != ${safeJson(bd.capabilities)}`;
  if (safeJson(ad.tools) !== safeJson(bd.tools)) return `tools: ${safeJson(ad.tools)} != ${safeJson(bd.tools)}`;
  if (safeJson(ad.policies) !== safeJson(bd.policies)) return `policies: ${safeJson(ad.policies)} != ${safeJson(bd.policies)}`;
  if (safeJson(ad.modelPolicy) !== safeJson(bd.modelPolicy)) return `modelPolicy: ${safeJson(ad.modelPolicy)} != ${safeJson(bd.modelPolicy)}`;
  if (safeJson(ad.memoryPolicy) !== safeJson(bd.memoryPolicy)) return `memoryPolicy: ${safeJson(ad.memoryPolicy)} != ${safeJson(bd.memoryPolicy)}`;
  if (safeJson(ad.knowledgePolicy) !== safeJson(bd.knowledgePolicy)) return `knowledgePolicy: ${safeJson(ad.knowledgePolicy)} != ${safeJson(bd.knowledgePolicy)}`;
  if (ad.autonomyLevelDefault !== bd.autonomyLevelDefault) return `autonomyLevelDefault: ${ad.autonomyLevelDefault} != ${bd.autonomyLevelDefault}`;
  if (safeJson(ad.evaluationPolicy) !== safeJson(bd.evaluationPolicy)) return `evaluationPolicy: ${safeJson(ad.evaluationPolicy)} != ${safeJson(bd.evaluationPolicy)}`;
  if (ad.owner !== bd.owner) return `owner: ${ad.owner} != ${bd.owner}`;
  return null;
}

function isMutableAgentLifecycle(lifecycle: AgentVersion['lifecycle']): boolean {
  return lifecycle === 'DRAFT' || lifecycle === 'TESTING';
}

function mapAgentVersion(row: Record<string, unknown>): AgentVersion {
  let rawPolicies =
    typeof row.policies === 'string'
      ? JSON.parse(row.policies as string)
      : (row.policies ?? []);
  if (!Array.isArray(rawPolicies) && rawPolicies && Object.keys(rawPolicies).length === 0) {
    rawPolicies = [];
  }
  const policies = Array.isArray(rawPolicies) ? rawPolicies : [];
  return {
    versionId: row.version_id as string,
    agentId: row.agent_id as string,
    tenantId: (row.tenant_id as string | null) ?? null,
    isSystem: (row.is_system as boolean | null) ?? false,
    version: row.version as string,
    lifecycle: row.lifecycle as AgentVersion['lifecycle'],
    implementationKey: (row.implementation_key as string) ?? '',
    definition: {
      agentId: row.agent_id as string,
      name: row.name as string,
      role: row.role as string,
      description: row.description as string,
      capabilities: (row.capabilities as string[]) ?? [],
      tools: (row.tools as string[]) ?? [],
      policies,
      modelPolicy:
        typeof row.model_policy === 'string'
          ? JSON.parse(row.model_policy as string)
          : (row.model_policy ?? { preferredModelFamily: '', maxCostPerTaskUsd: 0, maxTokensPerTask: 0 }),
      memoryPolicy:
        typeof row.memory_policy === 'string'
          ? JSON.parse(row.memory_policy as string)
          : (row.memory_policy ?? { read: [], write: [], validationRequired: false }),
      knowledgePolicy:
        typeof row.knowledge_policy === 'string'
          ? JSON.parse(row.knowledge_policy as string)
          : (row.knowledge_policy ?? { read: [], write: [] }),
      autonomyLevelDefault: (row.autonomy_level_default as number) ?? 0,
      evaluationPolicy:
        typeof row.evaluation_policy === 'string'
          ? JSON.parse(row.evaluation_policy as string)
          : (row.evaluation_policy ?? { criteria: [], minScore: 0 }),
      owner: row.owner as string,
      version: row.version as string,
      lifecycle: row.lifecycle as AgentVersion['lifecycle'],
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    } as AgentVersion['definition'],
  };
}

export class PostgresAgentRepository implements IAgentRepository {
  constructor(private readonly config: PostgresControlPlaneRepositoryConfig) {}

  async getActiveVersion(
    ctx: TenantContext,
    agentId: string,
    version?: string,
  ): Promise<AgentVersion | null> {
    return this.config.client.withTenant(ctx, async (client) => {
      const params: unknown[] = [agentId];
      let sql = `
        SELECT * FROM control_plane.agent_versions
        WHERE agent_id = $1
          AND (is_system = true OR tenant_id = current_setting('app.current_tenant', true))
      `;
      if (version) {
        sql += ` AND version = $2`;
        params.push(version);
      } else {
        sql += ` AND lifecycle = 'ACTIVE'`;
      }
      sql += ' ORDER BY version DESC LIMIT 1';
      const result = await client.query<Record<string, unknown>>(sql, params);
      if (result.rowCount === 0 || !result.rows[0]) return null;
      return mapAgentVersion(result.rows[0]);
    });
  }

  async listActiveVersions(ctx: TenantContext): Promise<AgentVersion[]> {
    return this.config.client.withTenant(ctx, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT * FROM control_plane.agent_versions
         WHERE (is_system = true OR tenant_id = current_setting('app.current_tenant', true))
           AND lifecycle = 'ACTIVE'
         ORDER BY agent_id, version DESC`,
      );
      return (result.rows ?? []).map(mapAgentVersion);
    });
  }

  async saveVersion(ctx: TenantContext, version: AgentVersion): Promise<void> {
    return this.config.client.transaction(ctx, async (client) => {
      const existingResult = await client.query<Record<string, unknown>>(
        `SELECT * FROM control_plane.agent_versions
         WHERE version_id = $1
           AND (is_system = true OR tenant_id = current_setting('app.current_tenant', true))
         FOR UPDATE`,
        [version.versionId],
      );
      const d = version.definition;
      const jsonb = (v: unknown) => JSON.stringify(v);
      const existingRow = (existingResult.rows ?? [])[0];
      if (existingRow) {
        const existing = mapAgentVersion(existingRow);
        const diff = areVersionDefinitionsEqual(existing, version);
        if (diff === null) {
          return;
        }
        if (!isMutableAgentLifecycle(existing.lifecycle)) {
          throw new ImmutableAgentVersionConflict(
            version.agentId,
            version.version,
            diff + ' in ' + existing.lifecycle + ' version',
          );
        }
        await client.query(
          `UPDATE control_plane.agent_versions
           SET lifecycle = $1, name = $2, role = $3, description = $4,
               capabilities = $5, tools = $6, policies = $7, model_policy = $8,
               memory_policy = $9, knowledge_policy = $10, autonomy_level_default = $11,
               evaluation_policy = $12, owner = $13, implementation_key = $14,
               updated_at = NOW()
           WHERE version_id = $15`,
          [
            version.lifecycle,
            d.name,
            d.role,
            d.description,
            d.capabilities,
            d.tools,
            jsonb(d.policies),
            jsonb(d.modelPolicy),
            jsonb(d.memoryPolicy),
            jsonb(d.knowledgePolicy),
            d.autonomyLevelDefault,
            jsonb(d.evaluationPolicy),
            d.owner,
            version.implementationKey,
            version.versionId,
          ],
        );
        return;
      }
      await client.query(
        `INSERT INTO control_plane.agent_versions
          (version_id, agent_id, tenant_id, is_system, version, lifecycle, name, role, description,
           capabilities, tools, policies, model_policy, memory_policy, knowledge_policy,
           autonomy_level_default, evaluation_policy, owner, implementation_key, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW())`,
        [
          version.versionId,
          version.agentId,
          version.tenantId,
          version.isSystem,
          version.version,
          version.lifecycle,
          d.name,
          d.role,
          d.description,
          d.capabilities,
          d.tools,
          jsonb(d.policies),
          jsonb(d.modelPolicy),
          jsonb(d.memoryPolicy),
          jsonb(d.knowledgePolicy),
          d.autonomyLevelDefault,
          jsonb(d.evaluationPolicy),
          d.owner,
          version.implementationKey,
        ],
      );
    });
  }

  async transitionLifecycle(
    ctx: TenantContext,
    agentId: string,
    version: string,
    from: AgentVersion['lifecycle'],
    to: AgentVersion['lifecycle'],
  ): Promise<void> {
    return this.config.client.withTenant(ctx, async (client) => {
      const result = await client.query(
        `UPDATE control_plane.agent_versions
         SET lifecycle = $4, updated_at = NOW()
         WHERE agent_id = $1
           AND version = $2
           AND lifecycle = $3`,
        [agentId, version, from, to],
      );
      if (result.rowCount === 0) {
        throw new Error(`Lifecycle transition for ${agentId}@${version} failed`);
      }
    });
  }
}

function mapCapability(row: Record<string, unknown>): Capability {
  return {
    capabilityId: row.capability_id as string,
    name: row.name as string,
    description: row.description as string,
    riskCategory: row.risk_category as string,
    allowedTools: (row.allowed_tools as string[]) ?? [],
    requiredPolicies: (row.required_policies as string[]) ?? [],
  };
}

export class PostgresCapabilityRepository implements ICapabilityRepository {
  constructor(private readonly config: PostgresControlPlaneRepositoryConfig) {}

  async getGlobalCapability(
    ctx: TenantContext,
    capabilityId: string,
  ): Promise<Capability | null> {
    const result = await this.config.client.query<Record<string, unknown>>(
      'SELECT * FROM control_plane.capabilities WHERE capability_id = $1',
      [capabilityId],
    );
    if (result.rowCount === 0 || !result.rows[0]) return null;
    return mapCapability(result.rows[0]);
  }

  async listGlobalCapabilities(ctx: TenantContext): Promise<Capability[]> {
    const result = await this.config.client.query<Record<string, unknown>>(
      'SELECT * FROM control_plane.capabilities ORDER BY capability_id',
    );
    return (result.rows ?? []).map(mapCapability);
  }

  async saveCapability(ctx: TenantContext, capability: Capability): Promise<void> {
    await this.config.client.query(
      `INSERT INTO control_plane.capabilities
         (capability_id, name, description, risk_category, allowed_tools, required_policies, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, '1.0.0', NOW(), NOW())
       ON CONFLICT (capability_id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         risk_category = EXCLUDED.risk_category,
         allowed_tools = EXCLUDED.allowed_tools,
         required_policies = EXCLUDED.required_policies,
         updated_at = NOW()`,
      [
        capability.capabilityId,
        capability.name,
        capability.description,
        capability.riskCategory,
        capability.allowedTools,
        capability.requiredPolicies,
      ],
    );
  }
}

function mapModel(row: Record<string, unknown>): Model {
  return {
    modelId: row.model_id as string,
    provider: row.provider as string,
    family: row.family as string,
    capabilities: (row.capabilities as string[]) ?? [],
    latencyClass: row.latency_class as string,
    costMetadata:
      (typeof row.cost_metadata === 'string'
        ? JSON.parse(row.cost_metadata as string)
        : row.cost_metadata) ?? {},
    healthMetadata:
      (typeof row.health_metadata === 'string'
        ? JSON.parse(row.health_metadata as string)
        : row.health_metadata) ?? {},
  };
}

export class PostgresModelRepository implements IModelRepository {
  constructor(private readonly config: PostgresControlPlaneRepositoryConfig) {}

  async getModel(ctx: TenantContext, modelId: string): Promise<Model | null> {
    const result = await this.config.client.query<Record<string, unknown>>(
      'SELECT * FROM control_plane.models WHERE model_id = $1',
      [modelId],
    );
    if (result.rowCount === 0 || !result.rows[0]) return null;
    return mapModel(result.rows[0]);
  }

  async listModels(ctx: TenantContext): Promise<Model[]> {
    const result = await this.config.client.query<Record<string, unknown>>(
      'SELECT * FROM control_plane.models ORDER BY model_id',
    );
    return (result.rows ?? []).map(mapModel);
  }

  async saveModel(ctx: TenantContext, model: Model): Promise<void> {
    await this.config.client.query(
      `INSERT INTO control_plane.models
         (model_id, provider, family, capabilities, latency_class, cost_metadata, health_metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (model_id) DO UPDATE SET
         provider = EXCLUDED.provider,
         family = EXCLUDED.family,
         capabilities = EXCLUDED.capabilities,
         latency_class = EXCLUDED.latency_class,
         cost_metadata = EXCLUDED.cost_metadata,
         health_metadata = EXCLUDED.health_metadata,
         updated_at = NOW()`,
      [
        model.modelId,
        model.provider,
        model.family,
        model.capabilities,
        model.latencyClass,
        model.costMetadata,
        model.healthMetadata,
      ],
    );
  }
}

function mapPolicyRule(row: Record<string, unknown>): PolicyRule {
  return {
    policyId: row.policy_id as string,
    tenantId: (row.tenant_id as string | null) ?? null,
    scope: row.scope as PolicyRule['scope'],
    missionId: (row.mission_id as string | null) ?? null,
    agentId: (row.agent_id as string | null) ?? null,
    capability: (row.capability as string | null) ?? null,
    toolId: (row.tool_id as string | null) ?? null,
    riskCategory: (row.risk_category as string | null) ?? null,
    outcome: row.outcome as PolicyRule['outcome'],
    policyVersion: (row.policy_version as string) ?? '1.0.0',
    priority: (row.priority as number) ?? 0,
  };
}

export class PostgresPolicyRepository implements IPolicyRepository {
  constructor(private readonly config: PostgresControlPlaneRepositoryConfig) {}

  async findRules(
    ctx: TenantContext,
    request: AIExecutionRequest,
  ): Promise<PolicyRule[]> {
    return this.config.client.withTenant(ctx, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT * FROM control_plane.policies
         WHERE (is_system = true OR tenant_id = current_setting('app.current_tenant', true))
           AND (mission_id IS NULL OR mission_id = $1)
           AND (agent_id IS NULL OR agent_id = $2)
           AND (capability IS NULL OR capability = ANY($3))
           AND (risk_category IS NULL OR risk_category = $4)
         ORDER BY priority, policy_id`,
        [
          request.missionId,
          request.agentId,
          request.capabilities,
          request.policyContext.riskCategory,
        ],
      );
      return (result.rows ?? []).map(mapPolicyRule);
    });
  }

  async saveRule(ctx: TenantContext, rule: PolicyRule): Promise<void> {
    return this.config.client.withTenant(ctx, async (client) => {
      await client.query(
        `INSERT INTO control_plane.policies
           (policy_id, tenant_id, is_system, scope, mission_id, agent_id, capability, tool_id,
            risk_category, outcome, policy_version, priority, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
         ON CONFLICT (policy_id) DO UPDATE SET
           scope = EXCLUDED.scope,
           mission_id = EXCLUDED.mission_id,
           agent_id = EXCLUDED.agent_id,
           capability = EXCLUDED.capability,
           tool_id = EXCLUDED.tool_id,
           risk_category = EXCLUDED.risk_category,
           outcome = EXCLUDED.outcome,
           policy_version = EXCLUDED.policy_version,
           priority = EXCLUDED.priority,
           updated_at = NOW()`,
        [
          rule.policyId,
          rule.tenantId,
          rule.tenantId === null,
          rule.scope,
          rule.missionId,
          rule.agentId,
          rule.capability,
          rule.toolId,
          rule.riskCategory,
          rule.outcome,
          rule.policyVersion,
          rule.priority,
        ],
      );
    });
  }
}

function mapAutonomyRule(row: Record<string, unknown>): AutonomyRule {
  return {
    ruleId: row.rule_id as string,
    tenantId: row.tenant_id as string,
    level: row.level as number,
    riskCategory: row.risk_category as string,
    requiredOutcome: row.required_outcome as AutonomyRule['requiredOutcome'],
    confidenceThreshold: Number(row.confidence_threshold ?? 0.5),
  };
}

export class PostgresAutonomyRepository implements IAutonomyRepository {
  constructor(private readonly config: PostgresControlPlaneRepositoryConfig) {}

  async getRule(
    ctx: TenantContext,
    level: number,
    riskCategory: string,
  ): Promise<AutonomyRule | null> {
    return this.config.client.withTenant(ctx, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT * FROM control_plane.autonomy_config
         WHERE tenant_id = current_setting('app.current_tenant', true)
           AND level = $1
           AND risk_category = $2
         LIMIT 1`,
        [level, riskCategory],
      );
      if (result.rowCount === 0 || !result.rows[0]) return null;
      return mapAutonomyRule(result.rows[0]);
    });
  }

  async saveRule(ctx: TenantContext, rule: AutonomyRule): Promise<void> {
    return this.config.client.withTenant(ctx, async (client) => {
      await client.query(
        `INSERT INTO control_plane.autonomy_config
           (rule_id, tenant_id, level, risk_category, required_outcome, confidence_threshold, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (rule_id) DO UPDATE SET
           required_outcome = EXCLUDED.required_outcome,
           confidence_threshold = EXCLUDED.confidence_threshold,
           updated_at = NOW()`,
        [
          rule.ruleId,
          rule.tenantId,
          rule.level,
          rule.riskCategory,
          rule.requiredOutcome,
          rule.confidenceThreshold,
        ],
      );
    });
  }
}

export class PostgresEmergencyStopProvider implements IEmergencyStopProvider {
  constructor(private readonly config: PostgresControlPlaneRepositoryConfig) {}

  async isStopped(
    ctx: TenantContext,
    target: { scope: 'tenant' | 'mission' | 'agent'; targetId?: string },
  ): Promise<boolean> {
    return this.config.client.withTenant(ctx, async (client) => {
      const conditions: string[] = ['active = true'];
      const params: unknown[] = [];
      if (target.scope === 'tenant') {
        conditions.push('tenant_id = current_setting(\'app.current_tenant\', true)');
      } else if (target.scope === 'mission' && target.targetId) {
        params.push(target.targetId);
        conditions.push(`mission_id = $1`);
      } else if (target.scope === 'agent' && target.targetId) {
        params.push(target.targetId);
        conditions.push(`agent_id = $1`);
      }
      const result = await client.query<Record<string, unknown>>(
        `SELECT 1 FROM control_plane.emergency_stop
         WHERE ${conditions.join(' AND ')}
         LIMIT 1`,
        params,
      );
      return (result.rowCount ?? 0) > 0;
    });
  }
}

export class PostgresAuditSink implements IAuditSink {
  constructor(private readonly auditLog: IAuditLog) {}

  async record(
    ctx: TenantContext,
    event: string,
    outcome: 'success' | 'denied' | 'failure',
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const resourceId =
      (metadata.decisionId as string) ??
      (metadata.agentId as string) ??
      (metadata.policyId as string) ??
      (metadata.ruleId as string) ??
      'unknown';
    await this.auditLog.record(ctx, {
      action: event,
      resourceType: 'control-plane',
      resourceId,
      result: outcome,
      reason: event,
      metadata,
    });
  }
}



