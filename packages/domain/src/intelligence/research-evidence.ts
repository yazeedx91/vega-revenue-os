import type { AccountId, ContactId, EvidenceId, TenantId } from '@projectx/shared';

export type ReliabilityTier = 'OFFICIAL' | 'PREMIUM_PROVIDER' | 'PUBLIC_RECORD' | 'DERIVED' | 'USER_PROVIDED';

export interface EvidenceProvenanceEntry {
  step: string;
  agentId?: string;
  toolCallId?: string;
  inputSummary: string;
  outputSummary: string;
  occurredAt: Date;
}

export interface EvidenceContradiction {
  conflictingEvidenceId: EvidenceId;
  reason: string;
  resolution: 'FAVOR_THIS' | 'FAVOR_OTHER' | 'UNRESOLVED';
}

export interface EvidenceConfidenceBreakdown {
  sourceReliability: number;
  extractionConfidence: number;
  corroboration: number;
}

export interface ResearchEvidenceProps {
  evidenceId: EvidenceId;
  tenantId: TenantId;
  accountId?: AccountId;
  contactId?: ContactId;
  missionId?: string;
  claimType: string;
  rawClaim?: unknown;
  normalizedValue: unknown;
  source: string;
  sourceUri?: string;
  reliabilityTier: ReliabilityTier;
  observedAt: Date;
  freshnessExpiry: Date;
  confidence: number;
  confidenceBreakdown: EvidenceConfidenceBreakdown;
  provenance: EvidenceProvenanceEntry[];
  contradictions?: EvidenceContradiction[];
}

export class ResearchEvidence {
  constructor(public readonly props: ResearchEvidenceProps) {}

  get evidenceId(): EvidenceId {
    return this.props.evidenceId;
  }

  get tenantId(): TenantId {
    return this.props.tenantId;
  }

  get confidence(): number {
    return this.props.confidence;
  }

  addContradiction(conflictingEvidenceId: EvidenceId, reason: string, resolution: EvidenceContradiction['resolution']): ResearchEvidence {
    return new ResearchEvidence({
      ...this.props,
      contradictions: [
        ...(this.props.contradictions ?? []),
        { conflictingEvidenceId, reason, resolution },
      ],
    });
  }

  isFresh(at: Date = new Date()): boolean {
    return at.getTime() < this.props.freshnessExpiry.getTime();
  }
}
