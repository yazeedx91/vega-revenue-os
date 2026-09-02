import type { OutreachChannel } from './provider-contracts';

export interface SequenceStep {
  readonly stepNumber: number;
  readonly channel: OutreachChannel;
  readonly delayMs: number;
  readonly requiresApproval: boolean;
  readonly templateRef?: string;
  readonly objective?: string;
}
