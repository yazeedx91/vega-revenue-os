/**
 * Per-execution budget ledger used by the LLM router to enforce conservative
 * budget accounting across every provider attempt (primary, fallback, and
 * structured-output repair calls).
 *
 * Semantics required by Slice 5 acceptance:
 * - Before every provider attempt, the estimated charge is reserved. If the
 *   accumulated charges plus the new estimate would exceed the execution
 *   budget, the attempt is blocked and no provider call is made.
 * - On success the reservation is reconciled to the actual reported usage.
 * - On a pre-submission failure (no HTTP request dispatched) the reservation is
 *   released — no provider call occurred, so nothing was consumed.
 * - On a submitted failure whose usage is unknown, the estimated charge is
 *   RETAINED. Unknown usage is never treated as free; retaining the estimate
 *   prevents a fallback from silently exceeding the configured budget.
 */

export interface ExecutionBudgetCharge {
  readonly costUsd: number;
  readonly tokens: number;
}

export interface ExecutionBudgetLimit {
  readonly maxCostUsd: number;
  readonly maxTokens: number;
}

export interface IExecutionBudgetLedger {
  /**
   * Reserve an estimated charge for an attempt. Returns true when the attempt
   * is permitted (accumulated + estimate fits within the budget). When false,
   * no reservation is recorded and the caller must not invoke the provider.
   */
  tryReserve(
    executionId: string,
    attemptKey: string,
    estimate: ExecutionBudgetCharge,
    budget: ExecutionBudgetLimit,
  ): boolean;

  /** Reconcile a reservation to the actual reported usage. */
  commitActual(executionId: string, attemptKey: string, actual: ExecutionBudgetCharge): void;

  /** Release a reservation because no provider request was submitted. */
  release(executionId: string, attemptKey: string): void;

  /**
   * Retain the estimated charge for a submitted attempt whose real usage is
   * unknown. The estimate stays on the ledger so subsequent attempts see a
   * reduced remaining budget.
   */
  retain(executionId: string, attemptKey: string): void;

  /** Total charges currently held against an execution (actual + retained estimates). */
  getAccumulated(executionId: string): ExecutionBudgetCharge;
}

export class InMemoryExecutionBudgetLedger implements IExecutionBudgetLedger {
  private readonly charges = new Map<string, Map<string, ExecutionBudgetCharge>>();

  tryReserve(
    executionId: string,
    attemptKey: string,
    estimate: ExecutionBudgetCharge,
    budget: ExecutionBudgetLimit,
  ): boolean {
    const accumulated = this.getAccumulated(executionId);
    if (accumulated.costUsd + estimate.costUsd > budget.maxCostUsd) {
      return false;
    }
    if (accumulated.tokens + estimate.tokens > budget.maxTokens) {
      return false;
    }
    this.bucket(executionId).set(attemptKey, estimate);
    return true;
  }

  commitActual(executionId: string, attemptKey: string, actual: ExecutionBudgetCharge): void {
    this.bucket(executionId).set(attemptKey, actual);
  }

  release(executionId: string, attemptKey: string): void {
    this.charges.get(executionId)?.delete(attemptKey);
  }

  retain(_executionId: string, _attemptKey: string): void {
    // The reservation recorded by tryReserve is already the conservative
    // estimate; retaining simply leaves it in place.
  }

  getAccumulated(executionId: string): ExecutionBudgetCharge {
    const bucket = this.charges.get(executionId);
    if (!bucket) {
      return { costUsd: 0, tokens: 0 };
    }
    let costUsd = 0;
    let tokens = 0;
    for (const charge of bucket.values()) {
      costUsd += charge.costUsd;
      tokens += charge.tokens;
    }
    return { costUsd, tokens };
  }

  private bucket(executionId: string): Map<string, ExecutionBudgetCharge> {
    let bucket = this.charges.get(executionId);
    if (!bucket) {
      bucket = new Map<string, ExecutionBudgetCharge>();
      this.charges.set(executionId, bucket);
    }
    return bucket;
  }
}
