import type { TenantContext } from '@projectx/domain';
import type { ToolDefinition, ToolLifecycle } from '@projectx/shared';

/**
 * Reference used to resolve a single executable tool definition. Executable
 * invocation MUST be version-pinned: either an exact `toolDefinitionId`, or
 * `toolId` + explicit `version`. A version-less reference fails closed.
 */
export interface ToolResolutionRef {
  readonly toolDefinitionId?: string;
  readonly toolId?: string;
  readonly version?: string;
}

/**
 * Outcome of deterministic resolution. Never returns two equally-valid
 * executable definitions for one invocation.
 */
export type ToolResolution =
  | { readonly kind: 'resolved'; readonly definition: ToolDefinition }
  | { readonly kind: 'not_found'; readonly reason: string }
  | { readonly kind: 'shadowed'; readonly reason: string }
  | { readonly kind: 'not_executable'; readonly reason: string; readonly definition?: ToolDefinition }
  | { readonly kind: 'version_required'; readonly reason: string }
  | { readonly kind: 'ambiguous'; readonly reason: string };

/**
 * Tool registry: catalog metadata + executable discovery. Catalog holds all
 * registered definitions (including deferred/unavailable); executable discovery
 * returns only tools that are enabled, tenant-available, capability-authorized,
 * version-resolvable, provider-bound, and ACTIVE.
 */
export interface IToolRegistry {
  /** Register a new (DRAFT) tool definition. */
  register(ctx: TenantContext, definition: ToolDefinition): Promise<ToolDefinition>;

  /** Fetch a definition by surrogate id (tenant-visible: own or global). */
  getById(ctx: TenantContext, toolDefinitionId: string): Promise<ToolDefinition | undefined>;

  /** Candidate definitions for a tool_id+version across tenant + global scope. */
  findByToolVersion(
    ctx: TenantContext,
    toolId: string,
    version: string,
  ): Promise<ToolDefinition[]>;

  /** Catalog listing (metadata only — includes deferred/unavailable tools). */
  listCatalog(ctx: TenantContext): Promise<ToolDefinition[]>;

  /**
   * Executable discovery: only ACTIVE + enabled + capability-authorized tools
   * for the tenant. Deferred/unavailable tools are never returned here.
   */
  discoverExecutable(ctx: TenantContext, capabilities: readonly string[]): Promise<ToolDefinition[]>;

  /**
   * Deterministically resolve a single definition for a pinned ref. Applies
   * tenant-override shadowing, version pinning, tenant visibility, and
   * structural executability (ACTIVE + enabled). Capability authorization is a
   * separate governance step performed by the gateway after authoritative
   * policy evaluation. Fails closed on ambiguity, missing version, or a
   * shadowed/disabled override.
   */
  resolveExecutable(ctx: TenantContext, ref: ToolResolutionRef): Promise<ToolResolution>;

  /** Forward-only lifecycle transition (DRAFT→ACTIVE→DEPRECATED→RETIRED). */
  transitionLifecycle(
    ctx: TenantContext,
    toolDefinitionId: string,
    to: ToolLifecycle,
  ): Promise<ToolDefinition>;

  /** Operational toggle (mutable even when ACTIVE). */
  setEnabled(ctx: TenantContext, toolDefinitionId: string, enabled: boolean): Promise<ToolDefinition>;
}
