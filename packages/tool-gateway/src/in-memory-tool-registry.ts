import type { TenantContext } from '@projectx/domain';
import type { ToolDefinition, ToolLifecycle } from '@projectx/shared';
import type { IToolRegistry, ToolResolution, ToolResolutionRef } from './tool-registry.interface';
import { resolveToolDefinition } from './tool-resolution';

const FORWARD: Record<ToolLifecycle, ToolLifecycle | null> = {
  DRAFT: 'ACTIVE',
  ACTIVE: 'DEPRECATED',
  DEPRECATED: 'RETIRED',
  RETIRED: null,
};

/**
 * In-memory tool registry for unit tests and local development. Mirrors the
 * Postgres semantics: surrogate identity, tenant shadowing, forward-only
 * lifecycle, and contract immutability once ACTIVE.
 */
export class InMemoryToolRegistry implements IToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();

  async register(_ctx: TenantContext, definition: ToolDefinition): Promise<ToolDefinition> {
    const key = definition.toolDefinitionId;
    if (this.definitions.has(key)) {
      throw new Error(`tool definition ${key} already registered`);
    }
    // Enforce scope/version uniqueness (global: tool_id+version; tenant: tenant+tool_id+version).
    for (const d of this.definitions.values()) {
      const sameScope = d.tenantId === definition.tenantId;
      if (sameScope && d.toolId === definition.toolId && d.version === definition.version) {
        throw new Error(
          `duplicate tool definition for ${definition.toolId}@${definition.version} in scope ${definition.tenantId ?? 'global'}`,
        );
      }
    }
    const stored: ToolDefinition = { ...definition, lifecycle: definition.lifecycle ?? 'DRAFT' };
    this.definitions.set(key, stored);
    return stored;
  }

  async getById(ctx: TenantContext, toolDefinitionId: string): Promise<ToolDefinition | undefined> {
    const d = this.definitions.get(toolDefinitionId);
    if (!d) return undefined;
    if (d.tenantId !== null && d.tenantId !== (ctx.tenantId as string)) return undefined;
    return d;
  }

  async findByToolVersion(ctx: TenantContext, toolId: string, version: string): Promise<ToolDefinition[]> {
    const tenantId = ctx.tenantId as string;
    return [...this.definitions.values()].filter(
      (d) => d.toolId === toolId && d.version === version && (d.tenantId === null || d.tenantId === tenantId),
    );
  }

  async listCatalog(ctx: TenantContext): Promise<ToolDefinition[]> {
    const tenantId = ctx.tenantId as string;
    return [...this.definitions.values()].filter((d) => d.tenantId === null || d.tenantId === tenantId);
  }

  async discoverExecutable(ctx: TenantContext, capabilities: readonly string[]): Promise<ToolDefinition[]> {
    const tenantId = ctx.tenantId as string;
    // Group by tool_id+version; a tenant-specific definition shadows global.
    const byTool = new Map<string, ToolDefinition[]>();
    for (const d of this.definitions.values()) {
      if (d.tenantId !== null && d.tenantId !== tenantId) continue;
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
    let candidates: ToolDefinition[];
    if (ref.toolDefinitionId) {
      const exact = await this.getById(ctx, ref.toolDefinitionId);
      candidates = exact ? [exact] : [];
      // Also gather same tool_id+version (tenant + global) for shadowing check.
      if (exact) {
        candidates = await this.findByToolVersion(ctx, exact.toolId, exact.version);
      }
    } else if (ref.toolId && ref.version) {
      candidates = await this.findByToolVersion(ctx, ref.toolId, ref.version);
    } else {
      candidates = [];
    }
    return resolveToolDefinition(ref, candidates, tenantId);
  }

  async transitionLifecycle(
    ctx: TenantContext,
    toolDefinitionId: string,
    to: ToolLifecycle,
  ): Promise<ToolDefinition> {
    const d = await this.getMutableOwn(ctx, toolDefinitionId);
    const allowed = FORWARD[d.lifecycle];
    if (allowed !== to) {
      throw new Error(`invalid tool lifecycle transition ${d.lifecycle} -> ${to}`);
    }
    const updated: ToolDefinition = { ...d, lifecycle: to, updatedAt: new Date() };
    this.definitions.set(toolDefinitionId, updated);
    return updated;
  }

  async setEnabled(ctx: TenantContext, toolDefinitionId: string, enabled: boolean): Promise<ToolDefinition> {
    const d = await this.getMutableOwn(ctx, toolDefinitionId);
    const updated: ToolDefinition = { ...d, enabled, updatedAt: new Date() };
    this.definitions.set(toolDefinitionId, updated);
    return updated;
  }

  private async getMutableOwn(ctx: TenantContext, toolDefinitionId: string): Promise<ToolDefinition> {
    const d = this.definitions.get(toolDefinitionId);
    if (!d) throw new Error(`tool definition ${toolDefinitionId} not found`);
    // Only a tenant's own rows are mutable; global rows are not tenant-mutable.
    if (d.tenantId !== (ctx.tenantId as string)) {
      throw new Error(`tool definition ${toolDefinitionId} is not tenant-mutable`);
    }
    return d;
  }
}
