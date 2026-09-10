import type { AccountId, ContactId, EvidenceId, ResearchRequestId, ResearchRunId, TenantId } from '@projectx/shared';
import type { JsonValue } from './lead';

export const MAX_SOURCE_LENGTH = 512;
export const MAX_SOURCE_URI_LENGTH = 2048;
export const MAX_FINGERPRINT_LENGTH = 256;
export const MAX_CLAIM_TYPE_LENGTH = 128;

const OPAQUE_HASH_PATTERN = /^[A-Za-z0-9_-]+$/;
const URI_CREDENTIALS_PATTERN = /\/\/[^@/]*:[^@/]*@/;

export type ReliabilityTier = 'OFFICIAL' | 'PREMIUM_PROVIDER' | 'PUBLIC_RECORD' | 'DERIVED' | 'USER_PROVIDED';

export interface EvidenceProvenanceEntry {
  readonly step: string;
  readonly agentId?: string;
  readonly toolCallId?: string;
  readonly inputSummary: string;
  readonly outputSummary: string;
  readonly occurredAt: string;
}

export interface EvidenceContradiction {
  readonly conflictingEvidenceId: EvidenceId;
  readonly reason: string;
  readonly resolution: 'FAVOR_THIS' | 'FAVOR_OTHER' | 'UNRESOLVED';
}

export interface EvidenceConfidenceBreakdown {
  readonly sourceReliability: number;
  readonly extractionConfidence: number;
  readonly corroboration: number;
}

export interface ResearchEvidenceProps {
  readonly evidenceId: EvidenceId;
  readonly tenantId: TenantId;
  readonly workspaceId: string;
  readonly requestId: ResearchRequestId;
  readonly runId: ResearchRunId;
  readonly accountId?: AccountId;
  readonly contactId?: ContactId;
  readonly missionId?: string;
  readonly claimType: string;
  readonly normalizedValue: JsonValue;
  readonly source: string;
  readonly sourceUri?: string;
  readonly reliabilityTier: ReliabilityTier;
  readonly observedAt: string;
  readonly freshnessExpiry: string;
  readonly confidence: number;
  readonly confidenceBreakdown: EvidenceConfidenceBreakdown;
  readonly provenance: readonly EvidenceProvenanceEntry[];
  readonly contradictions?: readonly EvidenceContradiction[];
  readonly evidenceFingerprint: string;
}

export class EvidenceInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceInvariantError';
  }
}

function isJsonSafe(value: unknown, seen: Set<unknown> = new Set()): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'function' || typeof value === 'undefined' || typeof value === 'symbol' || typeof value === 'bigint') return false;
  if (value instanceof Date || value instanceof RegExp || value instanceof Map || value instanceof Set) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((v) => isJsonSafe(v, seen));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every((v) => isJsonSafe(v, seen));
  }
  return false;
}

function deepFreeze<T>(obj: T): T {
  Object.freeze(obj);
  if (obj !== null && typeof obj === 'object') {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
        deepFreeze(val);
      }
    }
  }
  return obj;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

function validateFiniteInRange(value: number, fieldName: string, min: number, max: number): void {
  if (!Number.isFinite(value)) {
    throw new EvidenceInvariantError(`${fieldName} must be finite`);
  }
  if (value < min || value > max) {
    throw new EvidenceInvariantError(`${fieldName} must be between ${min} and ${max}`);
  }
}

export class ResearchEvidence {
  public readonly props: Readonly<ResearchEvidenceProps>;

  constructor(props: ResearchEvidenceProps) {
    if (!props.workspaceId) {
      throw new EvidenceInvariantError('workspaceId must be non-empty');
    }
    if (!props.claimType || props.claimType.length > MAX_CLAIM_TYPE_LENGTH) {
      throw new EvidenceInvariantError(`claimType must be non-empty and at most ${MAX_CLAIM_TYPE_LENGTH} characters`);
    }
    if (!props.source || props.source.length > MAX_SOURCE_LENGTH) {
      throw new EvidenceInvariantError(`source must be non-empty and at most ${MAX_SOURCE_LENGTH} characters`);
    }
    if (props.sourceUri !== undefined) {
      if (props.sourceUri.length > MAX_SOURCE_URI_LENGTH) {
        throw new EvidenceInvariantError(`sourceUri must not exceed ${MAX_SOURCE_URI_LENGTH} characters`);
      }
      if (URI_CREDENTIALS_PATTERN.test(props.sourceUri)) {
        throw new EvidenceInvariantError('sourceUri must not contain embedded credentials');
      }
    }
    if (!isJsonSafe(props.normalizedValue)) {
      throw new EvidenceInvariantError('normalizedValue must be JSON-safe (no functions, cycles, undefined, NaN, Infinity)');
    }

    if (!props.evidenceFingerprint || props.evidenceFingerprint.length === 0) {
      throw new EvidenceInvariantError('evidenceFingerprint must be non-empty');
    }
    if (props.evidenceFingerprint.length > MAX_FINGERPRINT_LENGTH) {
      throw new EvidenceInvariantError(`evidenceFingerprint must not exceed ${MAX_FINGERPRINT_LENGTH} characters`);
    }
    if (!OPAQUE_HASH_PATTERN.test(props.evidenceFingerprint)) {
      throw new EvidenceInvariantError('evidenceFingerprint must be opaque machine-safe format (base64url-safe characters only)');
    }

    validateFiniteInRange(props.confidence, 'confidence', 0, 1);
    validateFiniteInRange(props.confidenceBreakdown.sourceReliability, 'sourceReliability', 0, 1);
    validateFiniteInRange(props.confidenceBreakdown.extractionConfidence, 'extractionConfidence', 0, 1);
    validateFiniteInRange(props.confidenceBreakdown.corroboration, 'corroboration', 0, 1);

    if (!props.observedAt || isNaN(new Date(props.observedAt).getTime())) {
      throw new EvidenceInvariantError('observedAt must be a valid ISO-8601 timestamp');
    }
    if (!props.freshnessExpiry || isNaN(new Date(props.freshnessExpiry).getTime())) {
      throw new EvidenceInvariantError('freshnessExpiry must be a valid ISO-8601 timestamp');
    }

    this.props = deepFreeze({
      ...props,
      normalizedValue: deepClone(props.normalizedValue),
      provenance: deepClone([...props.provenance]),
      contradictions: props.contradictions ? deepClone([...props.contradictions]) : undefined,
      confidenceBreakdown: { ...props.confidenceBreakdown },
    });
  }

  get evidenceId(): EvidenceId {
    return this.props.evidenceId;
  }

  get tenantId(): TenantId {
    return this.props.tenantId;
  }

  get workspaceId(): string {
    return this.props.workspaceId;
  }

  get confidence(): number {
    return this.props.confidence;
  }

  isFresh(at?: string): boolean {
    const now = at ?? new Date().toISOString();
    return now < this.props.freshnessExpiry;
  }
}
