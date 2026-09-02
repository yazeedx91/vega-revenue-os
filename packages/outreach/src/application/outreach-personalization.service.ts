import type { Lead, ResearchEvidence } from '@projectx/domain';
import { ensureSameTenant, type TenantContext } from '@projectx/domain';
import type {
  AIExecutionRequest,
  CorrelationId,
  EvidenceId,
  IdempotencyKey,
  ModelUsage,
  OutreachMessageId,
  PromptContext,
} from '@projectx/shared';
import { asAgentId, asExecutionId, asMissionId, asTaskId } from '@projectx/shared';
import type { IOutputValidator, IReasoningEngine } from '@projectx/ai-runtime';
import type { MessageDraft, OutreachPlan } from '@projectx/domain';
import { asOutreachMessageId } from '@projectx/shared';

export interface OutreachPersonalizationDependencies {
  reasoningEngine: IReasoningEngine;
  outputValidator: IOutputValidator;
  generateMessageId: () => OutreachMessageId;
  generateExecutionId: () => string;
  generateIdempotencyKey: (hint: string) => IdempotencyKey;
}

export interface PersonalizationResult {
  messageId: OutreachMessageId;
  draft: MessageDraft;
  modelUsage: ModelUsage;
}

export class OutreachPersonalizationService {
  constructor(private readonly deps: OutreachPersonalizationDependencies) {}

  async personalize(
    ctx: TenantContext,
    plan: OutreachPlan,
    lead: Lead,
    evidence: ResearchEvidence[],
  ): Promise<{ success: true; value: PersonalizationResult } | { success: false; error: Error }> {
    ensureSameTenant(ctx, lead.tenantId);

    const promptContext = this.buildPromptContext(plan, lead, evidence);
    const executionRequest = this.buildAIExecutionRequest(ctx, plan);

    const reasoningOutput = await this.deps.reasoningEngine.reason(ctx, {
      execution: executionRequest,
      promptContext,
      observations: [],
      correlationId: ctx.correlationId as CorrelationId,
    });

    const parsed = this.parseDraft(reasoningOutput.conclusion, reasoningOutput.rationale, reasoningOutput.confidence);
    const verified = this.verifyClaims(parsed, evidence);

    const validation = await this.deps.outputValidator.validate(ctx, {
      execution: executionRequest,
      proposedOutput: verified as unknown as Record<string, unknown>,
      correlationId: ctx.correlationId as CorrelationId,
      idempotencyKey: this.deps.generateIdempotencyKey(`draft:${plan.sequenceId}`),
    });

    if (!validation.valid || validation.piiCheck === 'FAILED' || (validation.policyViolations?.length ?? 0) > 0) {
      const reasons = [
        ...(validation.policyViolations ?? []),
        ...(validation.schemaViolations ?? []),
        validation.piiCheck === 'FAILED' ? 'PII check failed' : '',
      ].filter(Boolean);
      return { success: false, error: new Error(`Personalization rejected: ${reasons.join('; ')}`) };
    }

    const messageId = this.deps.generateMessageId();
    const draft: MessageDraft = {
      subject: verified.subject,
      body: validation.safeOutput as string,
      cta: verified.cta,
      tone: verified.tone,
      claims: verified.claims.map((c) => ({ ...c, evidenceId: c.evidenceId as EvidenceId })),
      evidenceReferences: verified.claims.map((c) => c.evidenceId as EvidenceId),
      unsupportedClaimsRemoved: verified.unsupportedClaimsRemoved,
    };

    return {
      success: true,
      value: {
        messageId,
        draft,
        modelUsage: reasoningOutput.modelUsage ?? {
          model: 'stub',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        },
      },
    };
  }

  private buildPromptContext(plan: OutreachPlan, lead: Lead, evidence: ResearchEvidence[]): PromptContext {
    const evidenceSummaries = evidence
      .filter((e) => e.tenantId === lead.tenantId)
      .map((e) => ({
        evidenceId: e.evidenceId,
        claimType: e.props.claimType,
        value: e.props.normalizedValue,
        confidence: e.confidence,
      }));

    return {
      systemPromptVersion: '1',
      userMessage: [
        'You are an outreach writer. Generate a personalized outreach message.',
        'Every factual claim MUST reference one of the provided evidence IDs.',
        'Do not invent facts. Do not include PII. Keep tone professional.',
        'Return JSON: { subject?, body, cta?, tone, claims: [{ text, evidenceId, confidence }] }.',
        '',
        `Lead score: ${lead.scores.overall}`,
        `Channel: ${plan.channel}`,
        `Step objective: ${plan.steps[0]?.objective ?? 'first-touch'}`,
        `Evidence: ${JSON.stringify(evidenceSummaries)}`,
      ].join('\n'),
      toolsAvailable: [],
    };
  }

  private buildAIExecutionRequest(ctx: TenantContext, plan: OutreachPlan): AIExecutionRequest {
    return {
      executionId: this.deps.generateExecutionId(),
      tenantId: ctx.tenantId,
      missionId: asMissionId(plan.campaignId as string),
      agentId: asAgentId('outreach-writer'),
      agentVersion: '1.0.0',
      taskId: asTaskId(`draft:${plan.sequenceId}`),
      taskType: 'draft-message',
      correlationId: ctx.correlationId as CorrelationId,
      context: {
        plan: plan as unknown as Record<string, unknown>,
      },
      capabilities: ['draft-message'],
      policyContext: {
        autonomyLevel: 0.5,
        riskCategory: 'MEDIUM',
        tenantPolicyVersion: '1',
        missionPolicyVersion: '1',
      },
      budget: {
        maxTokens: 2000,
        maxCostUsd: 0.5,
        maxDurationSeconds: 30,
      },
      idempotencyKey: this.deps.generateIdempotencyKey(`draft:${plan.sequenceId}`),
    };
  }

  private parseDraft(conclusion: string, rationale: string, confidence: number): Partial<MessageDraft> & { rawClaims?: { text: string; evidenceId: string; confidence: number }[] } {
    try {
      const parsed = JSON.parse(conclusion);
      return {
        subject: parsed.subject,
        body: parsed.body,
        cta: parsed.cta,
        tone: parsed.tone ?? 'professional',
        rawClaims: parsed.claims ?? [],
      };
    } catch {
      return {
        body: conclusion,
        tone: 'professional',
        rawClaims: [
          {
            text: rationale,
            evidenceId: '',
            confidence,
          },
        ],
      };
    }
  }

  private verifyClaims(
    parsed: Partial<MessageDraft> & { rawClaims?: { text: string; evidenceId: string; confidence: number }[] },
    evidence: ResearchEvidence[],
  ): {
    subject?: string;
    body: string;
    cta?: string;
    tone: string;
    claims: { text: string; evidenceId: string; confidence: number }[];
    unsupportedClaimsRemoved: string[];
  } {
    const evidenceIds = new Set(evidence.map((e) => e.evidenceId as string));
    const supported: { text: string; evidenceId: string; confidence: number }[] = [];
    const removed: string[] = [];

    for (const claim of parsed.rawClaims ?? []) {
      if (evidenceIds.has(claim.evidenceId)) {
        supported.push(claim);
      } else {
        removed.push(claim.text);
      }
    }

    return {
      subject: parsed.subject,
      body: parsed.body ?? '',
      cta: parsed.cta,
      tone: parsed.tone ?? 'professional',
      claims: supported,
      unsupportedClaimsRemoved: removed,
    };
  }
}
