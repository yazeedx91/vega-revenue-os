import type { Lead, ResearchEvidence } from '@projectx/domain';
import { ensureSameTenant, type TenantContext } from '@projectx/domain';
import type { OutreachPlan, Recipient, SequenceStep } from '@projectx/domain';
import type { CampaignId, SequenceId } from '@projectx/shared';

export interface OutreachPlanningDependencies {
  generateSequenceId: () => SequenceId;
}

export interface OutreachPlanningInput {
  campaignId: CampaignId;
  lead: Lead;
  evidence: ResearchEvidence[];
  channels?: string[];
  maxSteps?: number;
  timezone?: string;
  workDays?: number[];
  startHour?: number;
  endHour?: number;
}

export class OutreachPlanningService {
  constructor(private readonly deps: OutreachPlanningDependencies) {}

  plan(ctx: TenantContext, input: OutreachPlanningInput): OutreachPlan {
    ensureSameTenant(ctx, input.lead.tenantId);

    const channel = this.selectChannel(input.channels);
    const recipient = this.buildRecipient(input.lead);
    const steps = this.buildSteps(channel, input.maxSteps ?? 1);

    return {
      campaignId: input.campaignId,
      sequenceId: this.deps.generateSequenceId(),
      leadId: input.lead.id,
      recipient,
      channel,
      steps,
      firstDueAt: new Date(Date.now() + steps[0].delayMs),
      businessHours: {
        timezone: input.timezone ?? 'UTC',
        workDays: input.workDays ?? [1, 2, 3, 4, 5],
        startHour: input.startHour ?? 9,
        endHour: input.endHour ?? 17,
      },
      evidenceReferences: input.evidence.map((e) => e.evidenceId),
      requiresApproval: true,
    };
  }

  private selectChannel(channels?: string[]): 'email' | 'linkedin' | 'calendar' {
    if (!channels || channels.length === 0) return 'email';
    const normalized = channels.map((c) => c.toLowerCase());
    if (normalized.includes('email')) return 'email';
    if (normalized.includes('linkedin')) return 'linkedin';
    if (normalized.includes('calendar')) return 'calendar';
    return 'email';
  }

  private buildRecipient(lead: Lead): Recipient {
    return {
      contactId: lead.contactId,
      channel: 'email',
      address: `${lead.contactId}@example.com`,
    };
  }

  private buildSteps(channel: 'email' | 'linkedin' | 'calendar', count: number): SequenceStep[] {
    const steps: SequenceStep[] = [];
    for (let i = 0; i < count; i += 1) {
      steps.push({
        stepNumber: i + 1,
        channel,
        delayMs: i === 0 ? 0 : 24 * 60 * 60 * 1000,
        requiresApproval: true,
        objective: i === 0 ? 'first-touch' : 'follow-up',
      });
    }
    return steps;
  }
}
