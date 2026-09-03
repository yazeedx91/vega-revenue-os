import type { IAgentImplementation, AgentImplementationRuntime } from '@projectx/ai-runtime';
import type { AIExecutionRequest, AIExecutionResult, ExecutionOutcome, ModelUsage } from '@projectx/shared';

export interface ComplianceSafetyRequest {
  readonly proposedOutput?: string;
  readonly contentType?: 'message' | 'reply' | 'profile';
}

const PII_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN-like
  /\b\d{16}\b/, // Credit-card-like
];

export class ComplianceSafetySpecialist implements IAgentImplementation {
  readonly implementationKey = 'specialist.compliance-safety.v1' as const;
  readonly capabilities = ['compliance_review', 'safety_review', 'policy_check'] as const;
  readonly riskCategory = 'compliance';

  async execute(request: AIExecutionRequest, runtime: AgentImplementationRuntime): Promise<AIExecutionResult> {
    const target = (request.context.target ?? {}) as ComplianceSafetyRequest;
    const content = target.proposedOutput ?? '';
    const contentType = target.contentType ?? 'message';

    const findings: string[] = [];
    for (const pattern of PII_PATTERNS) {
      if (pattern.test(content)) findings.push('potential_pii_detected');
    }
    if (content.length > 2000) findings.push('excessive_length_review');

    const safe = findings.length === 0;
    const status = safe ? 'COMPLETED' : 'FAILED';
    const startedAt = runtime.startedAt;
    const completedAt = new Date();
    const summary = safe
      ? `Compliance/safety review passed for ${contentType} content.`
      : `Compliance/safety review failed for ${contentType} content: ${findings.join(', ')}.`;

    const outcome: ExecutionOutcome = {
      summary,
      decisions: [{ safe, findings, contentType }],
      actions: safe ? [{ type: 'compliance_approved', contentType }] : [{ type: 'compliance_rejected', findings }],
      evidence: [{ contentLength: content.length, contentType }],
    };

    const modelUsage: ModelUsage = {
      model: 'slice-4-deterministic',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };

    return {
      executionId: request.executionId,
      tenantId: request.tenantId,
      missionId: request.missionId,
      status,
      outcome,
      modelUsage,
      startedAt,
      completedAt,
      correlationId: request.correlationId,
      events: ['ExecutionCompleted'],
    };
  }
}
