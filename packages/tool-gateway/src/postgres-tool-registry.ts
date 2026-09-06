import type { TenantContext } from '@projectx/domain';
import type { ToolDefinition, ToolLifecycle, ToolSchemaDefinition, ToolSideEffectClass } from '@projectx/shared';
import { PostgresClient } from '@projectx/infrastructure';
import type { IToolRegistry, ToolResolution, ToolResolutionRef } from './tool-registry.interface';
import { resolveToolDefinition } from './tool-resolution';

const FORWARD: Record<ToolLifecycle, ToolLifecycle | null> = {
  DRAFT: 'ACTIVE',
  ACTIVE: 'DEPRECATED',
  DEPRECATED: 'RETIRED',
  RETIRED: null,
};

interface Row {
  tool_definition_id: string;
  tool_id: string;
  version: string;
  tenant_id: string | null;
  description: string;
  input_schema: ToolSchemaDefinition | null;
  output_schema: ToolSchemaDefinition | null;
  required_capabilities: string[];
  risk_category: ToolDefinition['riskCategory'];
  side_effect_class: ToolSideEffectClass;
  required_approval: boolean;
  provider_id: string;
  enabled: boolean;
  timeout_seconds: number;
  max_retries: number;
  idempotency_required: boolean;
  cost_metadata: Record<string, unknown>;
  config: Record<string, unknown>;
  lifecycle: ToolLifecycle;
  created_at: Date;
  updated_at: Date;
}

function toDefinition(r: Row): ToolDefinition {
  return {
    toolDefinitionId: r.tool_definition_id,
    toolId: r.tool_id,
    version: r.version,
    tenantId: r.tenant_id,
    description: r.description,
    inputSchema: r.input_schema ?? undefined,
    outputSchema: r.output_schema ?? undefined,
    requiredCapabilities: r.required_capabilities ?? [],
    riskCategory: r.risk_category,
    sideEffectClass: r.side_effect_class,
    requiredApproval: r.required_approval,
    providerId: r.provider_id,
    enabled: r.enabled,
    timeoutSeconds: r.timeout_seconds,
    maxRetries: r.max_retries,
    idempotencyRequired: r.idempotency_required,
    costMetadata: r.cost_metadata,
    config: r.config,
    lifecycle: r.lifecycle,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Postgres-backed tool registry. Tenant isolation is enforced by RLS
 * (app.current_tenant); global rows (tenant_id IS NULL) are tenant-readable but
 * not tenant-mutable. Contract immutability and forward-only lifecycle are
 * enforced both here (semantic pre-check + SELECT ... FOR UPDATE) and by the
 * DB-level trigger.
 */
export class PostgresToolRegistry implements IToolRegistry {
  constructor(private readonly client: PostgresClient) {}

  async register(ctx: TenantContext, d: ToolDefinition): Promise<ToolDefinition> {
    await this.client.withTenant(ctx, async (c) => {
      await c.query(
        `INSERT INTO tool_registry.tool_definitions
          (tool_definition_id, tool_id, version, tenant_id, description,
           input_schema, output_schema, required_capabilities, risk_category,
           side_effect_class, required_approval, provider_id, enabled,
           timeout_seconds, max_retries, idempotency_required, cost_metadata,
           config, lifecycle)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          d.toolDefinitionId, d.toolId, d.version, d.tenantId, d.description,
          d.inputSchema ? JSON.stringify(d.inputSchema) : null,
          d.outputSchema ? JSON.stringify(d.outputSchema) : null,
          d.requiredCapabilities, d.riskCategory, d.sideEffectClass,
          d.requiredApproval, d.providerId, d.enabled, d.timeoutSeconds,
          d.maxRetries, d.idempotencyRequired, JSON.stringify(d.costMetadata ?? {}),
          JSON.stringify(d.config ?? {}), d.lifecycle ?? 'DRAFT',
        ],
      );
    });
    return d;
  }

  async getById(ctx: TenantContext, toolDefinitionId: string): Promise<ToolDefinition | undefined> {
    const res = await this.client.withTenant(ctx, (c) =>
      c.query<Row>(
        `SELECT * FROM tool_registry.tool_definitions WHERE tool_definition_id = $1`,
        [toolDefinitionId],
      ),
    );
    return res.rows[0] ? toDefinition(res.rows[0]) : undefined;
  }

  async findByToolVersion(ctx: TenantContext, toolId: string, version: string): Promise<ToolDefinition[]> {
    const res = await this.client.withTenant(ctx, (c) =>
      c.query<Row>(
        `SELECT * FROM tool_registry.tool_definitions WHERE tool_id = $1 AND version = $2`,
        [toolId, version],
      ),
    );
    return res.rows.map(toDefinition);
  }

  async listCatalog(ctx: TenantContext): Promise<ToolDefinition[]> {
    const res = await this.client.withTenant(ctx, (c) =>
      c.query<Row>(`SELECT * FROM tool_registry.tool_definitions ORDER BY tool_id, version`),
    );
    return res.rows.map(toDefinition);
  }

  async discoverExecutable(ctx: TenantContext, capabilities: readonly string[]): Promise<ToolDefinition[]> {
    const catalog = await this.listCatalog(ctx);
    const tenantId = ctx.tenantId as string;
    const byTool = new Map<string, ToolDefinition[]>();
    for (const d of catalog) {
      const key = `${d.toolId}@${d.version}`;
      const arr = byTool.get(key) ?? [];
      arr.push(d);
      byTool.set(key, arr);
    }
    const executable: ToolDefinition[] = [];
    for (const group of byTool.values()) {
      const tenant = group.find((d) => d.tenantId === tenantId);
      const global = group.find((d) => d.tenantId === null);
      const effective = tenant ?? global;
      if (!effective) continue;
      if (effective.lifecycle !== 'ACTIVE' || !effective.enabled) continue;
      const missing = effective.requiredCapabilities.filter((c) => !capabilities.includes(c));
      if (missing.length > 0) continue;
      executable.push(effective);
    }
    return executable;
  }

  async resolveExecutable(ctx: TenantContext, ref: ToolResolutionRef): Promise<ToolResolution> {
    const tenantId = ctx.tenantId as string;
    let candidates: ToolDefinition[] = [];
    if (ref.toolDefinitionId) {
      const exact = await this.getById(ctx, ref.toolDefinitionId);
      if (exact) {
        candidates = await this.findByToolVersion(ctx, exact.toolId, exact.version);
      }
    } else if (ref.toolId && ref.version) {
      candidates = await this.findByToolVersion(ctx, ref.toolId, ref.version);
    }
    return resolveToolDefinition(ref, candidates, tenantId);
  }

  async transitionLifecycle(ctx: TenantContext, toolDefinitionId: string, to: ToolLifecycle): Promise<ToolDefinition> {
    return this.client.transaction(ctx, async (c) => {
      const res = await c.query<Row>(
        `SELECT * FROM tool_registry.tool_definitions WHERE tool_definition_id = $1 FOR UPDATE`,
        [toolDefinitionId],
      );
      const row = res.rows[0];
      if (!row) throw new Error(`tool definition ${toolDefinitionId} not found`);
      if (row.tenant_id !== (ctx.tenantId as string)) {
        throw new Error(`tool definition ${toolDefinitionId} is not tenant-mutable`);
      }
      const allowed = FORWARD[row.lifecycle];
      if (allowed !== to) {
        throw new Error(`invalid tool lifecycle transition ${row.lifecycle} -> ${to}`);
      }
      const upd = await c.query<Row>(
        `UPDATE tool_registry.tool_definitions SET lifecycle = $1 WHERE tool_definition_id = $2 RETURNING *`,
        [to, toolDefinitionId],
      );
      return toDefinition(upd.rows[0]);
    });
  }

  async setEnabled(ctx: TenantContext, toolDefinitionId: string, enabled: boolean): Promise<ToolDefinition> {
    return this.client.transaction(ctx, async (c) => {
      const res = await c.query<Row>(
        `SELECT * FROM tool_registry.tool_definitions WHERE tool_definition_id = $1 FOR UPDATE`,
        [toolDefinitionId],
      );
      const row = res.rows[0];
      if (!row) throw new Error(`tool definition ${toolDefinitionId} not found`);
      if (row.tenant_id !== (ctx.tenantId as string)) {
        throw new Error(`tool definition ${toolDefinitionId} is not tenant-mutable`);
      }
      const upd = await c.query<Row>(
        `UPDATE tool_registry.tool_definitions SET enabled = $1 WHERE tool_definition_id = $2 RETURNING *`,
        [enabled, toolDefinitionId],
      );
      return toDefinition(upd.rows[0]);
    });
  }
}
