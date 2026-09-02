import type { TenantContext } from '@projectx/domain';
import type { IntentClassification } from '@projectx/domain';
import type { IIntentClassifier } from '../ports/intent-classifier.interface';

export class DeterministicIntentClassifier implements IIntentClassifier {
  async classify(_ctx: TenantContext, content: string, _channel: string): Promise<IntentClassification> {
    const lower = content.toLowerCase();

    if (lower.includes('unsubscribe') || lower.includes('opt out') || lower.includes('stop')) {
      return { intent: 'OPT_OUT', confidence: 0.99, reason: 'Explicit opt-out language detected' };
    }

    if (lower.includes('meeting') || lower.includes('book a time') || lower.includes('calendar')) {
      return { intent: 'MEETING_REQUEST', confidence: 0.92, reason: 'Meeting scheduling language detected' };
    }

    if (lower.includes('not interested') || lower.includes('no thanks') || lower.includes('wrong') || lower.includes('remove')) {
      return { intent: 'NEGATIVE', confidence: 0.9, reason: 'Negative/disqualifying language detected' };
    }

    if (lower.includes('interested') || lower.includes('yes') || lower.includes('tell me more') || lower.includes('pricing')) {
      return { intent: 'POSITIVE', confidence: 0.88, reason: 'Positive engagement language detected' };
    }

    if (lower.includes('?') || lower.includes('how') || lower.includes('what') || lower.includes('question')) {
      return { intent: 'QUESTION', confidence: 0.82, reason: 'Question language detected' };
    }

    return { intent: 'UNCERTAIN', confidence: 0.55, reason: 'Unable to classify deterministically' };
  }
}
