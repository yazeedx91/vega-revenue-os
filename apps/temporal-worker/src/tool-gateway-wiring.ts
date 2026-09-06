import type { TenantContext } from '@projectx/domain';
import type { Pool } from 'pg';
import {
  PostgresClient,
  PostgresIdempotencyStore,
  type ISecretsProvider,
} from '@projectx/infrastructure';
import type { IPolicyClient } from '@projectx/ai-runtime';
import type { IExecutionApprovalBinding } from '@projectx/ai-runtime';
import {
  StrictToolSchemaValidator,
  type AIExecutionRequest,
  type ToolCallRequest,
  type ToolDefinition,
  asIdempotencyKey,
  asCorrelationId,
} from '@projectx/shared';
import {
  ToolGateway,
  PostgresToolRegistry,
  PostgresToolInvocationRepository,
  HttpToolProvider,
  InternalToolProvider,
  type HttpEgressPolicy,
  type IToolApprovalBinding,
  type IToolPolicyEvaluator,
  type IToolProvider,
  type IToolProviderReadiness,
  type IToolProviderResolver,
  type ToolPolicyDecision,
} from '@projectx/tool-gateway';

/**
 * Adapts the authoritative Control Plane policy client to the tool-gateway
 * policy port. The agent cannot self-authorize — every tool call is evaluated
 * through the trusted policy path. Builds an AIExecutionRequest from the tool
 * call so the existing policy engine (emergency stop, policy rules, autonomy)
 * governs the decision.
 */
export class ControlPlaneToolPolicyEvaluator implements IToolPolicyEvaluator {
  constructor(
    private readonly policyClient: IPolicyClient,
    private readonly defaults: { autonomyLevel: number; tenantPolicyVersion: string; missionPolicyVersion: string },
  ) {}

  async evaluate(ctx: TenantContext, request: ToolCallRequest, definition: ToolDefinition): Promise<ToolPolicyDecision> {
    const aiRequest: AIExecutionRequest = {
      executionId: request.executionId ?? request.toolCallId,
      tenantId: request.tenantId,
      missionId: request.missionId ?? '',
      agentId: request.agentId ?? '',
      agentVersion: request.agentVersion ?? '0.0.0',
      taskId: request.taskId ?? request.toolCallId,
      taskType: (request.metadata?.action as string | undefined) ?? definition.toolId,
      correlationId: request.correlationId,
      context: {},
      capabilities: request.authorization.capabilities,
      policyContext: {
        autonomyLevel:
          (request.metadata?.autonomyLevel as number | undefined) ?? this.defaults.autonomyLevel,
        riskCategory: definition.riskCategory,
        tenantPolicyVersion: this.defaults.tenantPolicyVersion,
        missionPolicyVersion: this.defaults.missionPolicyVersion,
      },
      budget: { maxTokens: 0, maxCostUsd: 0, maxDurationSeconds: definition.timeoutSeconds },
      idempotencyKey: request.idempotencyKey ?? asIdempotencyKey(request.toolCallId),
      metadata: { toolId: definition.toolId, toolVersion: definition.version },
    };

    const decision = await this.policyClient.evaluate(ctx, aiRequest);
    return {
      decision: decision.outcome,
      policyDecisionId: decision.decisionId,
      capabilities: decision.capabilities,
      // Autonomous invocation allowed only when policy did not tighten to approval.
      autonomyAllowed: decision.outcome === 'ALLOW',
      reason: decision.policyVersion,
    };
  }
}

/**
 * Adapts the existing execution approval binding (backed by the authoritative
 * Approval aggregate) to the tool approval-binding port. Binds on
 * executionId + idempotencyKey + actionType(tool@version); the input hash is
 * incorporated into the actionType so a generic/stale approval does not satisfy
 * the binding.
 */
export class ExecutionToolApprovalBinding implements IToolApprovalBinding {
  constructor(private readonly binding: IExecutionApprovalBinding) {}

  async verify(
    ctx: TenantContext,
    request: ToolCallRequest,
    definition: ToolDefinition,
    inputHash: string,
  ): Promise<{ approved: boolean; approvalId?: string; reason?: string }> {
    if (!request.executionId || !request.idempotencyKey) {
      return { approved: false, reason: 'missing executionId/idempotencyKey for approval binding' };
    }
    const actionType = `${definition.toolId}@${definition.version}#${inputHash.slice(0, 16)}`;
    const evidence = this.binding.resolveValidApproval
      ? await this.binding.resolveValidApproval(ctx, {
          executionId: request.executionId,
          idempotencyKey: request.idempotencyKey as string,
          actionType,
        })
      : null;
    if (evidence) return { approved: true, approvalId: evidence.approvalId };
    const ok = await this.binding.hasValidApproval(ctx, {
      executionId: request.executionId,
      idempotencyKey: request.idempotencyKey as string,
      actionType,
    });
    return ok ? { approved: true } : { approved: false, reason: 'no bound approval for tool action' };
  }
}

/** Runtime provider readiness — fail closed when a provider is not registered/ready. */
export class MapToolProviderReadiness implements IToolProviderReadiness {
  constructor(private readonly ready: (providerId: string, def: ToolDefinition) => Promise<boolean>) {}
  isReady(providerId: string, def: ToolDefinition): Promise<boolean> {
    return this.ready(providerId, def);
  }
}

/** Routes provider_id → adapter. Unknown provider → undefined (fail closed). */
export class MapToolProviderResolver implements IToolProviderResolver {
  constructor(private readonly providers: ReadonlyMap<string, IToolProvider>) {}
  resolve(providerId: string): IToolProvider | undefined {
    return this.providers.get(providerId);
  }
}

export interface GovernedToolGatewayOptions {
  readonly pool: Pool;
  readonly policyClient: IPolicyClient;
  readonly approvalBinding: IExecutionApprovalBinding;
  readonly secrets?: ISecretsProvider;
  /** Privileged server-side egress policy for the HTTP provider. */
  readonly httpEgress?: HttpEgressPolicy;
  /** Additional internal tool handlers keyed by provider_id. */
  readonly internalProviders?: ReadonlyMap<string, InternalToolProvider>;
  readonly policyDefaults?: { autonomyLevel: number; tenantPolicyVersion: string; missionPolicyVersion: string };
  /** Readiness probe; defaults to "provider registered = ready". */
  readonly readiness?: (providerId: string, def: ToolDefinition) => Promise<boolean>;
}

/**
 * Assemble the production governed ToolGateway over real Postgres-backed
 * registry/invocations/idempotency and the authoritative Control Plane policy
 * path. Returns the gateway (which is also the agent-facing IToolClient via
 * `call`). The caller wraps it in `ToolExecutor` for the telemetry boundary.
 */
export function buildGovernedToolGateway(opts: GovernedToolGatewayOptions): ToolGateway {
  const postgresClient = new PostgresClient(opts.pool);
  const registry = new PostgresToolRegistry(postgresClient);
  const invocations = new PostgresToolInvocationRepository(postgresClient);
  const idempotency = new PostgresIdempotencyStore({ pool: opts.pool });

  const providers = new Map<string, IToolProvider>();
  if (opts.httpEgress) {
    providers.set('http', new HttpToolProvider({
      providerId: 'http',
      policy: opts.httpEgress,
      secrets: opts.secrets,
    }));
  }
  for (const [id, p] of opts.internalProviders ?? []) providers.set(id, p);

  const readiness = opts.readiness ?? (async (providerId) => providers.has(providerId));

  return new ToolGateway({
    registry,
    invocations,
    idempotency,
    policyEvaluator: new ControlPlaneToolPolicyEvaluator(opts.policyClient, opts.policyDefaults ?? {
      autonomyLevel: 0,
      tenantPolicyVersion: '1.0.0',
      missionPolicyVersion: '1.0.0',
    }),
    approvalBinding: new ExecutionToolApprovalBinding(opts.approvalBinding),
    providerReadiness: new MapToolProviderReadiness(readiness),
    providerResolver: new MapToolProviderResolver(providers),
    schemaValidator: new StrictToolSchemaValidator(),
  });
}
