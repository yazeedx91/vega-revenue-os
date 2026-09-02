import type { Conversation } from '@projectx/domain';
import type { NextBestAction } from '@projectx/domain';
import { isHighConfidence, requiresEscalation } from '@projectx/domain';
import type { INextBestActionPolicy } from '../ports/next-best-action-policy.interface';

export class InMemoryNextBestActionPolicy implements INextBestActionPolicy {
  decide(conversation: Conversation, autonomyLevel: number): NextBestAction {
    const intent = conversation.latestIntent;
    const confidence = conversation.latestConfidence ?? 0;

    if (intent === 'OPT_OUT') {
      return { actionType: 'CLOSE', reason: 'Prospect opted out', requiresApproval: false };
    }

    if (requiresEscalation({ intent: intent ?? 'UNCERTAIN', confidence, reason: '' })) {
      return { actionType: 'ESCALATE', reason: 'Low confidence reply classification', requiresApproval: true };
    }

    if (autonomyLevel < 2) {
      return { actionType: 'ESCALATE', reason: 'Autonomy level requires human review', requiresApproval: true };
    }

    if (intent === 'MEETING_REQUEST') {
      return {
        actionType: 'SCHEDULE_MEETING_DEFERRED',
        reason: 'Prospect requested a meeting; scheduling is deferred to a later phase',
        requiresApproval: true,
      };
    }

    if (intent === 'POSITIVE') {
      return {
        actionType: 'FOLLOW_UP',
        reason: 'Positive reply; continue nurture sequence',
        requiresApproval: false,
        suggestedFollowUp: 'Send a follow-up with more details',
      };
    }

    if (intent === 'NEGATIVE') {
      return { actionType: 'DISQUALIFY', reason: 'Negative reply', requiresApproval: false };
    }

    if (intent === 'QUESTION') {
      return {
        actionType: 'FOLLOW_UP',
        reason: 'Answer the question and continue',
        requiresApproval: false,
        suggestedFollowUp: 'Draft an answer to the question',
      };
    }

    if (!isHighConfidence({ intent: intent ?? 'UNCERTAIN', confidence, reason: '' })) {
      return { actionType: 'ESCALATE', reason: 'Intent confidence below autonomous threshold', requiresApproval: true };
    }

    return { actionType: 'ESCALATE', reason: 'Unhandled intent', requiresApproval: true };
  }
}
