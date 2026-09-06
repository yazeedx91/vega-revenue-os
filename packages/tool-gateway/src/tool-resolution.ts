import type { ToolDefinition } from '@projectx/shared';
import type { ToolResolution, ToolResolutionRef } from './tool-registry.interface';

/**
 * Deterministic tool/version/scope resolution.
 *
 * Binding rules (evaluated in order):
 *  1. Explicit `toolDefinitionId` → resolve exact definition, verify tenant
 *     visibility, then check whether a tenant-specific definition exists for the
 *     same tool_id+version. A tenant-specific definition shadows global even
 *     when the caller supplied the global id — fail closed if the requested id
 *     differs from the tenant definition id, or the tenant definition is not
 *     executable. If no tenant-specific definition exists, the global exact
 *     definition may execute if otherwise valid.
 *  2. `toolId` + `version` → a tenant-specific definition shadows global; if it
 *     is not executable the call fails closed (no global fallthrough). If no
 *     tenant-specific definition exists, resolve the global ACTIVE definition.
 *  3. `toolId` without `version` → fail closed (no version-less execution).
 *  4. Ambiguity → fail closed.
 *
 * `candidates` must already be tenant-visible (own tenant + global rows).
 */
export function resolveToolDefinition(
  ref: ToolResolutionRef,
  candidates: readonly ToolDefinition[],
  tenantId: string,
): ToolResolution {
  // Structural executability only (lifecycle + enabled). Capability
  // authorization is enforced by the gateway after authoritative policy eval.
  const isExecutable = (d: ToolDefinition): { ok: boolean; reason?: string } => {
    if (d.lifecycle !== 'ACTIVE') return { ok: false, reason: `lifecycle=${d.lifecycle}` };
    if (!d.enabled) return { ok: false, reason: 'disabled' };
    return { ok: true };
  };

  const tenantDef = candidates.find((d) => d.tenantId === tenantId);
  const globalDef = candidates.find((d) => d.tenantId === null);

  // --- 1. Explicit toolDefinitionId ---------------------------------------
  if (ref.toolDefinitionId) {
    const exact = candidates.find((d) => d.toolDefinitionId === ref.toolDefinitionId);
    if (!exact) {
      return { kind: 'not_found', reason: `tool_definition_id ${ref.toolDefinitionId} not found` };
    }
    // Tenant visibility: a tenant may only reference its own or a global def.
    if (exact.tenantId !== null && exact.tenantId !== tenantId) {
      return { kind: 'not_found', reason: 'definition not visible to tenant' };
    }
    // Tenant shadowing applies even when the caller supplied the global id.
    if (tenantDef) {
      if (tenantDef.toolDefinitionId !== exact.toolDefinitionId) {
        return {
          kind: 'shadowed',
          reason: 'tenant-specific definition shadows the requested global tool_definition_id',
        };
      }
      const exec = isExecutable(tenantDef);
      if (!exec.ok) {
        return { kind: 'not_executable', reason: `tenant override not executable: ${exec.reason}`, definition: tenantDef };
      }
      return { kind: 'resolved', definition: tenantDef };
    }
    const exec = isExecutable(exact);
    if (!exec.ok) {
      return { kind: 'not_executable', reason: exec.reason ?? 'not executable', definition: exact };
    }
    return { kind: 'resolved', definition: exact };
  }

  // --- 3. toolId without version → fail closed -----------------------------
  if (ref.toolId && !ref.version) {
    return { kind: 'version_required', reason: 'version-less execution is not permitted' };
  }

  // --- 2. toolId + version --------------------------------------------------
  if (ref.toolId && ref.version) {
    const scoped = candidates.filter((d) => d.toolId === ref.toolId && d.version === ref.version);
    const t = scoped.find((d) => d.tenantId === tenantId);
    const g = scoped.find((d) => d.tenantId === null);

    if (t) {
      // Tenant-specific definition shadows global — no fallthrough.
      const exec = isExecutable(t);
      if (!exec.ok) {
        return { kind: 'shadowed', reason: `tenant override not executable: ${exec.reason}`, };
      }
      return { kind: 'resolved', definition: t };
    }
    if (g) {
      const exec = isExecutable(g);
      if (!exec.ok) {
        return { kind: 'not_executable', reason: exec.reason ?? 'not executable', definition: g };
      }
      return { kind: 'resolved', definition: g };
    }
    return { kind: 'not_found', reason: `no definition for ${ref.toolId}@${ref.version}` };
  }

  return { kind: 'ambiguous', reason: 'no resolvable tool reference supplied' };
}
