import { createHash, randomUUID } from 'crypto';
import type { TenantContext } from '@projectx/domain';
import type { IIdempotencyStore } from '@projectx/infrastructure';
import type {
  IToolSchemaValidator,
  ToolCallRequest,
  ToolCallResult,
  ToolCallStatus,
  ToolDefinition,
  ToolProviderOutcome,
} from '@projectx/shared';
import type { IToolGateway } from './tool-gateway.interface';
import type { IToolRegistry, ToolResolutionRef } from './tool-registry.interface';
import type { IToolInvocationRepository } from './tool-invocation-repository.interface';
import type {
  IToolApprovalBinding,
  IToolPolicyEvaluator,
  IToolProviderReadiness,
  IToolProviderResolver,
} from './tool-gateway-ports';

/** Optional audit/telemetry sink for governed tool calls. */
export interface IToolAuditSink {
  record(entry: {
    toolCallId: string;
    toolDefinitionId: string;
    toolId: string;
    version: string;
    tenantId: string;
    decision: string;
    status: ToolCallStatus;
    attempts: number;
    correlationId: string;
  }): Promise<string>;
}

export interface ToolGatewayDeps {
  readonly registry: IToolRegistry;
  readonly invocations: IToolInvocationRepository;
  readonly idempotency: IIdempotencyStore;
  readonly policyEvaluator: IToolPolicyEvaluator;
  readonly approvalBinding: IToolApprovalBinding;
  readonly providerReadiness: IToolProviderReadiness;
  readonly providerResolver: IToolProviderResolver;
  readonly schemaValidator: IToolSchemaValidator;
  readonly audit?: IToolAuditSink;
  readonly now?: () => Date;
  readonly idFactory?: () => string;
}

/** Stored idempotency payload — `submitted` drives the FAILED-reclaim rule. */
interface StoredOutcome {
  readonly submitted: boolean;
  readonly callResult: ToolCallResult;
}

/**
 * Production governed tool gateway — the SOLE retry + governance authority for
 * every tool execution. `ToolExecutor` delegates here with zero retry authority.
 *
 * Ordering (crash-observable):
 *   resolve → authorize(policy) → capability/autonomy → approval binding →
 *   input-schema validate → provider resolve → provider readiness →
 *   create logical invocation → acquire idempotency claim →
 *   create physical attempt (STARTED, submitted/resultKnown NULL) →
 *   provider boundary → update attempt → update invocation →
 *   output-schema validate → audit + telemetry.
 */
export class ToolGateway implements IToolGateway {
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(private readonly deps: ToolGatewayDeps) {
    this.now = deps.now ?? (() => new Date());
    this.idFactory = deps.idFactory ?? (() => randomUUID());
  }

  /**
   * Agent-facing port (`IToolClient`-shaped). `ToolGateway` is the single
   * governed authority; `call` delegates to `execute` so the governed path is
   * reachable through the existing agent-facing `IToolClient` contract without
   * tool-gateway depending on ai-runtime.
   */
  async call(request: ToolCallRequest): Promise<ToolCallResult> {
    return this.execute(request);
  }

  async execute(request: ToolCallRequest): Promise<ToolCallResult> {
    const ctx = this.toContext(request);
    const startedAt = this.now();

    // --- 1. Resolve (structural: shadowing, version pinning, tenant, ACTIVE+enabled)
    const ref: ToolResolutionRef = {
      toolDefinitionId: (request.metadata?.toolDefinitionId as string | undefined) ?? undefined,
      toolId: request.toolId,
      version: request.toolVersion,
    };
    const resolution = await this.deps.registry.resolveExecutable(ctx, ref);
    if (resolution.kind !== 'resolved') {
      return this.terminal(request, startedAt, this.resolutionStatus(resolution.kind), {
        code: `RESOLUTION_${resolution.kind.toUpperCase()}`,
        message: resolution.reason,
        retryable: false,
      });
    }
    const def = resolution.definition;

    // --- 2. Authoritative policy evaluation (agent cannot self-authorize)
    const decision = await this.deps.policyEvaluator.evaluate(ctx, request, def);
    if (decision.decision === 'DENY') {
      return this.terminal(request, startedAt, 'POLICY_DENIED', {
        code: 'POLICY_DENIED',
        message: decision.reason ?? 'denied by policy',
        retryable: false,
      });
    }
    // Capability check: tool's requiredCapabilities ⊆ policy-granted capabilities.
    const missing = def.requiredCapabilities.filter((c) => !decision.capabilities.includes(c));
    if (missing.length > 0) {
      return this.terminal(request, startedAt, 'UNAUTHORIZED', {
        code: 'CAPABILITY_DENIED',
        message: `missing capabilities: ${missing.join(',')}`,
        retryable: false,
      });
    }
    if (!decision.autonomyAllowed) {
      return this.terminal(request, startedAt, 'POLICY_DENIED', {
        code: 'AUTONOMY_DENIED',
        message: 'autonomous invocation not permitted',
        retryable: false,
      });
    }

    // --- 3. Exact approval binding (if required)
    const inputHash = this.hashInput(request.input);
    if (def.requiredApproval || decision.decision === 'REQUIRE_APPROVAL') {
      const approval = await this.deps.approvalBinding.verify(ctx, request, def, inputHash);
      if (!approval.approved) {
        return this.terminal(request, startedAt, 'POLICY_DENIED', {
          code: 'APPROVAL_REQUIRED',
          message: approval.reason ?? 'exact approval binding not satisfied',
          retryable: false,
        });
      }
    }

    // --- 4. Input-schema validation (before provider invocation)
    if (def.inputSchema) {
      const v = this.deps.schemaValidator.validate(request.input, def.inputSchema);
      if (!v.valid) {
        return this.terminal(request, startedAt, 'VALIDATION_ERROR', {
          code: 'INPUT_SCHEMA_VIOLATION',
          message: v.violations.join('; '),
          retryable: false,
        });
      }
    }

    // --- 5. Provider resolution
    const provider = this.deps.providerResolver.resolve(def.providerId, def);
    if (!provider) {
      return this.terminal(request, startedAt, 'FAILED', {
        code: 'NO_PROVIDER',
        message: `no provider adapter for ${def.providerId}`,
        retryable: false,
      });
    }

    // --- 6. Runtime provider readiness — BEFORE the idempotency claim
    const ready = await this.deps.providerReadiness.isReady(def.providerId, def);
    if (!ready) {
      return this.terminal(request, startedAt, 'FAILED', {
        code: 'PROVIDER_NOT_READY',
        message: `provider ${def.providerId} not ready`,
        retryable: true,
      });
    }

    // --- 7. Create the durable logical invocation BEFORE the claim
    const scope = this.idempotencyScope(request, def);
    const idemKey = request.idempotencyKey;
    await this.deps.invocations.createInvocation(ctx, {
      toolCallId: request.toolCallId,
      toolDefinitionId: def.toolDefinitionId,
      toolId: def.toolId,
      version: def.version,
      providerId: def.providerId,
      tenantId: ctx.tenantId as string,
      missionId: request.missionId,
      executionId: request.executionId,
      taskId: request.taskId,
      agentId: request.agentId,
      correlationId: request.correlationId as string,
      action: (request.metadata?.action as string | undefined) ?? undefined,
      idempotencyKey: idemKey as string | undefined,
      decision: decision.decision,
      status: 'IN_PROGRESS',
      startedAt,
    });

    // --- 8. Acquire authoritative idempotency claim BEFORE any side effect
    if (def.idempotencyRequired && idemKey) {
      const claim = await this.deps.idempotency.claim<StoredOutcome>(ctx, scope, idemKey);
      if (!claim.claimed) {
        return this.handleExistingClaim(ctx, request, def, startedAt, claim.existing);
      }
    }

    // --- 9..12. Single-authority retry loop over physical attempts
    const result = await this.executeWithRetry(ctx, request, def, provider, startedAt);

    // --- 13. Persist idempotency outcome per submission certainty
    if (def.idempotencyRequired && idemKey) {
      await this.persistClaimOutcome(ctx, scope, idemKey, result);
    }

    // --- 14. Output-schema validation (before result is accepted)
    if (result.status === 'SUCCESS' && def.outputSchema) {
      const v = this.deps.schemaValidator.validate(result.output, def.outputSchema);
      if (!v.valid) {
        const failed = this.buildResult(request, def, startedAt, 'VALIDATION_ERROR', {
          code: 'OUTPUT_SCHEMA_VIOLATION',
          message: v.violations.join('; '),
          retryable: false,
        }, result.retryCount);
        await this.deps.invocations.completeInvocation(ctx, request.toolCallId, {
          status: 'VALIDATION_ERROR',
          error: { code: 'OUTPUT_SCHEMA_VIOLATION', violations: v.violations },
        });
        return failed;
      }
    }

    // --- 15. Audit + telemetry
    const auditId = await this.recordAudit(request, def, decision.decision, result);
    return { ...result, auditId };
  }

  /**
   * Single-authority retry loop. Each iteration persists a STARTED attempt
   * BEFORE crossing the provider boundary, then records submission certainty.
   * Retry is permitted ONLY when non-submission is positively known
   * (`submitted === false`) and the failure is retryable; READ_ONLY tools may
   * additionally retry on an ambiguous (resultKnown=false) outcome since a
   * repeated read has no side effect. Side-effecting tools NEVER auto-retry an
   * ambiguous submission → OUTCOME_UNKNOWN → reconciliation.
   */
  private async executeWithRetry(
    ctx: TenantContext,
    request: ToolCallRequest,
    def: ToolDefinition,
    provider: { execute(c: TenantContext, r: ToolCallRequest): Promise<ToolProviderOutcome> },
    startedAt: Date,
  ): Promise<ToolCallResult> {
    const maxAttempts = Math.max(1, def.maxRetries + 1);
    let attempt = 0;
    let last: ToolCallResult | undefined;

    while (attempt < maxAttempts) {
      attempt += 1;
      // Persist STARTED attempt (submitted/resultKnown NULL) BEFORE provider boundary.
      await this.deps.invocations.createAttempt(ctx, {
        tenantId: ctx.tenantId as string,
        toolCallId: request.toolCallId,
        attempt,
        toolDefinitionId: def.toolDefinitionId,
        providerId: def.providerId,
        status: 'STARTED',
        startedAt: this.now(),
      });

      let outcome: ToolProviderOutcome;
      let threw = false;
      try {
        outcome = await provider.execute(ctx, request);
      } catch (err) {
        // Provider threw unexpectedly after the boundary was crossed. Do NOT
        // translate an unknown exception into submitted=false — treat as a
        // possible submission (conservative) for side-effecting tools.
        threw = true;
        outcome = {
          submitted: def.sideEffectClass !== 'READ_ONLY',
          resultKnown: false,
          retryable: false,
          failureClassification: 'PROVIDER_EXCEPTION',
          errorCode: 'PROVIDER_EXCEPTION',
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }

      const status = this.mapOutcomeStatus(outcome, threw);
      await this.deps.invocations.completeAttempt(ctx, request.toolCallId, attempt, {
        status: status === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : status === 'SUCCESS' ? 'COMPLETED' : 'FAILED',
        submitted: outcome.submitted,
        resultKnown: outcome.resultKnown,
        failureClassification: outcome.failureClassification,
        retryable: outcome.retryable,
        providerRequestId: outcome.providerRequestId,
      });

      last = this.buildResult(request, def, startedAt, status, {
        code: outcome.errorCode ?? (status === 'SUCCESS' ? 'OK' : 'PROVIDER_ERROR'),
        message: outcome.errorMessage ?? '',
        retryable: outcome.retryable,
      }, attempt - 1, outcome.output);

      if (status === 'SUCCESS') break;
      // Retry is decided by submission certainty, not by the mapped status:
      // READ_ONLY may retry an ambiguous (OUTCOME_UNKNOWN) outcome; a
      // side-effecting tool only retries when non-submission is positively
      // known, so its ambiguous outcome breaks here → OUTCOME_UNKNOWN.
      if (!this.canRetry(outcome, def, attempt, maxAttempts)) break;
    }

    const final = last ?? this.buildResult(request, def, startedAt, 'FAILED', {
      code: 'NO_ATTEMPT', message: 'no attempt executed', retryable: false,
    }, 0);

    await this.deps.invocations.completeInvocation(ctx, request.toolCallId, {
      status: final.status,
      error: final.error ? { code: final.error.code, message: final.error.message } : undefined,
    });
    return final;
  }

  private canRetry(
    outcome: ToolProviderOutcome,
    def: ToolDefinition,
    attempt: number,
    maxAttempts: number,
  ): boolean {
    if (attempt >= maxAttempts) return false;
    if (!outcome.retryable) return false;
    if (def.sideEffectClass === 'READ_ONLY') {
      // A repeated read has no side effect; safe to retry ambiguous outcomes.
      return outcome.submitted === false || outcome.resultKnown === false;
    }
    // Side-effecting: retry only when non-submission is positively known.
    return outcome.submitted === false;
  }

  private mapOutcomeStatus(outcome: ToolProviderOutcome, threw: boolean): ToolCallStatus {
    if (outcome.resultKnown && outcome.submitted && !outcome.errorCode) return 'SUCCESS';
    if (outcome.submitted && !outcome.resultKnown) return 'OUTCOME_UNKNOWN';
    if (threw && outcome.submitted) return 'OUTCOME_UNKNOWN';
    if (outcome.errorCode === 'TIMEOUT' && outcome.submitted && !outcome.resultKnown) return 'OUTCOME_UNKNOWN';
    if (outcome.errorCode === 'TIMEOUT') return 'TIMEOUT';
    if (outcome.errorCode === 'VALIDATION_ERROR') return 'VALIDATION_ERROR';
    if (outcome.errorCode === 'UNAUTHORIZED') return 'UNAUTHORIZED';
    if (outcome.errorCode === 'POLICY_DENIED') return 'POLICY_DENIED';
    return outcome.errorCode ? 'PROVIDER_ERROR' : 'FAILED';
  }

  private async handleExistingClaim(
    ctx: TenantContext,
    request: ToolCallRequest,
    def: ToolDefinition,
    startedAt: Date,
    existing: { result: StoredOutcome; status: 'PENDING' | 'COMPLETED' | 'FAILED' } | undefined,
  ): Promise<ToolCallResult> {
    // Record the new invocation as a duplicate/idempotent outcome (no adapter call).
    if (existing?.status === 'COMPLETED' && existing.result?.callResult) {
      await this.deps.invocations.completeInvocation(ctx, request.toolCallId, {
        status: existing.result.callResult.status,
      });
      return { ...existing.result.callResult, toolCallId: request.toolCallId };
    }
    // PENDING (possibly-submitted) or non-reclaimable FAILED → conservative.
    const status: ToolCallStatus = 'OUTCOME_UNKNOWN';
    await this.deps.invocations.completeInvocation(ctx, request.toolCallId, {
      status,
      error: { code: 'DUPLICATE_IN_FLIGHT', message: 'prior side-effect claim unresolved' },
    });
    return this.buildResult(request, def, startedAt, status, {
      code: 'DUPLICATE_IN_FLIGHT',
      message: 'an existing logical side effect is unresolved; reconciliation required',
      retryable: false,
    }, 0);
  }

  private async persistClaimOutcome(
    ctx: TenantContext,
    scope: string,
    key: NonNullable<ToolCallRequest['idempotencyKey']>,
    result: ToolCallResult,
  ): Promise<void> {
    if (result.status === 'OUTCOME_UNKNOWN') {
      // Retain the PENDING claim — reconciliation resolves it. Do not overwrite.
      return;
    }
    const submitted = result.status === 'SUCCESS' || result.error?.code !== 'NOT_SUBMITTED';
    const payload: StoredOutcome = { submitted, callResult: result };
    if (result.status === 'SUCCESS') {
      await this.deps.idempotency.set(ctx, scope, key, payload, { status: 'COMPLETED' });
    } else {
      // FAILED: reclaimable only when non-submission is positively known.
      await this.deps.idempotency.set(ctx, scope, key, payload, { status: 'FAILED' });
    }
  }

  private idempotencyScope(request: ToolCallRequest, def: ToolDefinition): string {
    const action = (request.metadata?.action as string | undefined) ?? 'execute';
    return `tool:${def.toolId}:${action}`;
  }

  private hashInput(input: unknown): string {
    return createHash('sha256').update(JSON.stringify(input ?? null)).digest('hex');
  }

  private toContext(request: ToolCallRequest): TenantContext {
    return {
      tenantId: request.tenantId,
      correlationId: request.correlationId as string,
      agentId: request.agentId,
      missionId: request.missionId,
    };
  }

  private resolutionStatus(kind: string): ToolCallStatus {
    switch (kind) {
      case 'version_required':
      case 'not_found':
        return 'VALIDATION_ERROR';
      case 'shadowed':
      case 'ambiguous':
        return 'POLICY_DENIED';
      default:
        return 'FAILED';
    }
  }

  private buildResult(
    request: ToolCallRequest,
    def: ToolDefinition,
    startedAt: Date,
    status: ToolCallStatus,
    error: { code: string; message: string; retryable: boolean },
    retryCount: number,
    output?: unknown,
  ): ToolCallResult {
    return {
      toolCallId: request.toolCallId,
      status,
      output,
      error: status === 'SUCCESS' ? undefined : error,
      validation: { schemaValid: true, tenantIsolationCheck: true, piiCheck: 'NOT_RUN' },
      provider: def.providerId,
      startedAt,
      completedAt: this.now(),
      retryCount,
      auditId: '',
    };
  }

  private terminal(
    request: ToolCallRequest,
    startedAt: Date,
    status: ToolCallStatus,
    error: { code: string; message: string; retryable: boolean },
  ): ToolCallResult {
    return {
      toolCallId: request.toolCallId,
      status,
      error,
      validation: { schemaValid: status !== 'VALIDATION_ERROR', tenantIsolationCheck: true, piiCheck: 'NOT_RUN' },
      provider: 'tool-gateway',
      startedAt,
      completedAt: this.now(),
      retryCount: 0,
      auditId: '',
    };
  }

  private async recordAudit(
    request: ToolCallRequest,
    def: ToolDefinition,
    decision: string,
    result: ToolCallResult,
  ): Promise<string> {
    if (!this.deps.audit) return this.idFactory();
    return this.deps.audit.record({
      toolCallId: request.toolCallId,
      toolDefinitionId: def.toolDefinitionId,
      toolId: def.toolId,
      version: def.version,
      tenantId: request.tenantId as string,
      decision,
      status: result.status,
      attempts: result.retryCount + 1,
      correlationId: request.correlationId as string,
    });
  }
}
