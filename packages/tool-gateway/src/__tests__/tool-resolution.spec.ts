import type { TenantContext } from '@projectx/domain';
import { asTenantId, type ToolDefinition } from '@projectx/shared';
import { InMemoryToolRegistry } from '../in-memory-tool-registry';
import { resolveToolDefinition } from '../tool-resolution';

const tenantId = asTenantId('tenant-1');
const otherTenant = asTenantId('tenant-2');
const ctx: TenantContext = { tenantId, correlationId: 'c' };

function def(over: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    toolDefinitionId: 'td-1',
    toolId: 'web_search',
    version: '1.0.0',
    tenantId: null,
    description: '',
    requiredCapabilities: [],
    riskCategory: 'LOW',
    sideEffectClass: 'READ_ONLY',
    requiredApproval: false,
    providerId: 'http',
    enabled: true,
    timeoutSeconds: 30,
    maxRetries: 0,
    idempotencyRequired: false,
    lifecycle: 'ACTIVE',
    ...over,
  };
}

describe('resolveToolDefinition — deterministic resolution', () => {
  it('resolves a global ACTIVE definition by tool_id+version', () => {
    const res = resolveToolDefinition({ toolId: 'web_search', version: '1.0.0' }, [def()], 'tenant-1');
    expect(res.kind).toBe('resolved');
  });

  it('version-less toolId → version_required (no version-less execution)', () => {
    const res = resolveToolDefinition({ toolId: 'web_search' }, [def()], 'tenant-1');
    expect(res.kind).toBe('version_required');
  });

  it('tenant override shadows global for same tool_id+version', () => {
    const global = def({ toolDefinitionId: 'g-1', tenantId: null });
    const tenant = def({ toolDefinitionId: 't-1', tenantId: 'tenant-1' });
    const res = resolveToolDefinition({ toolId: 'web_search', version: '1.0.0' }, [global, tenant], 'tenant-1');
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') expect(res.definition.toolDefinitionId).toBe('t-1');
  });

  it('disabled tenant override → fail closed, NO global fallthrough', () => {
    const global = def({ toolDefinitionId: 'g-1', tenantId: null });
    const tenant = def({ toolDefinitionId: 't-1', tenantId: 'tenant-1', enabled: false });
    const res = resolveToolDefinition({ toolId: 'web_search', version: '1.0.0' }, [global, tenant], 'tenant-1');
    expect(res.kind).toBe('shadowed');
  });

  it('explicit global tool_definition_id cannot bypass a tenant override', () => {
    const global = def({ toolDefinitionId: 'g-1', tenantId: null });
    const tenant = def({ toolDefinitionId: 't-1', tenantId: 'tenant-1', enabled: false });
    // Caller supplies the GLOBAL id, but a tenant override exists → shadowed.
    const res = resolveToolDefinition({ toolDefinitionId: 'g-1' }, [global, tenant], 'tenant-1');
    expect(res.kind).toBe('shadowed');
  });

  it('explicit tool_definition_id resolves when no tenant override exists', () => {
    const global = def({ toolDefinitionId: 'g-1', tenantId: null });
    const res = resolveToolDefinition({ toolDefinitionId: 'g-1' }, [global], 'tenant-1');
    expect(res.kind).toBe('resolved');
  });

  it('a definition belonging to another tenant is not visible', () => {
    const other = def({ toolDefinitionId: 'o-1', tenantId: 'tenant-2' });
    const res = resolveToolDefinition({ toolDefinitionId: 'o-1' }, [other], 'tenant-1');
    expect(res.kind).toBe('not_found');
  });

  it('DRAFT definition → not_executable', () => {
    const res = resolveToolDefinition({ toolId: 'web_search', version: '1.0.0' }, [def({ lifecycle: 'DRAFT' })], 'tenant-1');
    expect(res.kind).toBe('not_executable');
  });
});

describe('InMemoryToolRegistry — catalog, lifecycle, shadowing', () => {
  it('enforces scope/version uniqueness (global)', async () => {
    const r = new InMemoryToolRegistry();
    await r.register(ctx, def({ toolDefinitionId: 'a' }));
    await expect(r.register(ctx, def({ toolDefinitionId: 'b' }))).rejects.toThrow('duplicate');
  });

  it('enforces forward-only lifecycle transitions', async () => {
    const r = new InMemoryToolRegistry();
    await r.register(ctx, def({ toolDefinitionId: 't-1', tenantId: 'tenant-1', lifecycle: 'DRAFT' }));
    await r.transitionLifecycle(ctx, 't-1', 'ACTIVE');
    await expect(r.transitionLifecycle(ctx, 't-1', 'DRAFT')).rejects.toThrow('invalid tool lifecycle');
    await r.transitionLifecycle(ctx, 't-1', 'DEPRECATED');
    await r.transitionLifecycle(ctx, 't-1', 'RETIRED');
    await expect(r.transitionLifecycle(ctx, 't-1', 'ACTIVE')).rejects.toThrow('invalid tool lifecycle');
  });

  it('global definitions are not tenant-mutable', async () => {
    const r = new InMemoryToolRegistry();
    await r.register(ctx, def({ toolDefinitionId: 'g-1', tenantId: null }));
    await expect(r.setEnabled(ctx, 'g-1', false)).rejects.toThrow('not tenant-mutable');
  });

  it('discoverExecutable returns only ACTIVE+enabled+capability-authorized tools', async () => {
    const r = new InMemoryToolRegistry();
    await r.register(ctx, def({ toolDefinitionId: 'a', requiredCapabilities: ['research'] }));
    await r.register(ctx, def({ toolDefinitionId: 'b', toolId: 'other', requiredCapabilities: ['admin'] }));
    await r.register(ctx, def({ toolDefinitionId: 'c', toolId: 'draft', lifecycle: 'DRAFT' }));
    const exec = await r.discoverExecutable(ctx, ['research']);
    expect(exec.map((d) => d.toolDefinitionId)).toEqual(['a']);
  });
});
