import type { CampaignId, EvidenceId, LeadId, SequenceId } from '@projectx/shared';
import type { ProtectedRecipientSnapshot } from './protected-recipient';
import type { SequenceStep } from './sequence-step';
import type { OutreachChannel } from './provider-contracts';

export interface OutreachPlan {
  readonly campaignId: CampaignId;
  readonly sequenceId: SequenceId;
  readonly leadId: LeadId;
  readonly recipient: ProtectedRecipientSnapshot;
  readonly channel: OutreachChannel;
  readonly steps: SequenceStep[];
  readonly firstDueAt: Date;
  readonly businessHours?: BusinessHoursPolicy;
  readonly evidenceReferences: EvidenceId[];
  readonly requiresApproval: boolean;
}

export interface BusinessHoursPolicy {
  readonly timezone: string;
  readonly workDays: number[];
  readonly startHour: number;
  readonly endHour: number;
}
