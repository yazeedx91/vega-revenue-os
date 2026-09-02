export type ReplyIntent =
  | 'POSITIVE'
  | 'NEGATIVE'
  | 'QUESTION'
  | 'OPT_OUT'
  | 'MEETING_REQUEST'
  | 'UNCERTAIN';

export interface IntentClassification {
  readonly intent: ReplyIntent;
  readonly confidence: number;
  readonly reason: string;
  readonly evidenceReferences?: string[];
}

export function isHighConfidence(classification: IntentClassification, threshold = 0.85): boolean {
  return classification.confidence >= threshold;
}

export function requiresEscalation(classification: IntentClassification, threshold = 0.6): boolean {
  return classification.confidence < threshold || classification.intent === 'OPT_OUT';
}
