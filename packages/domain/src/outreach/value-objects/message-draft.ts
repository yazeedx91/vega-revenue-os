import type { EvidenceId } from '@projectx/shared';

export interface Claim {
  readonly text: string;
  readonly evidenceId: EvidenceId;
  readonly confidence: number;
}

export interface MessageDraft {
  readonly subject?: string;
  readonly body: string;
  readonly cta?: string;
  readonly tone: string;
  readonly claims: Claim[];
  readonly evidenceReferences: EvidenceId[];
  readonly unsupportedClaimsRemoved: string[];
}
