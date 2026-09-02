import type { TenantContext } from '@projectx/domain';

export interface IntelligenceAuditEntry {
  action: 'DISCOVER_ACCOUNTS' | 'GET_COMPANY_INTELLIGENCE' | 'DISCOVER_CONTACTS' | 'ENRICH_CONTACT' | 'DETECT_SIGNALS' | 'EVALUATE_ICP' | 'SCORE_LEAD' | 'CACHE_HIT' | 'CACHE_WRITE' | 'RATE_LIMITED';
  providerId?: string;
  accountId?: string;
  contactId?: string;
  missionId?: string;
  costUsd?: number;
  durationMs?: number;
  result: 'SUCCESS' | 'FAILURE' | 'CACHED' | 'RATE_LIMITED' | 'APPROVAL_REQUIRED';
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface IIntelligenceAuditLog {
  record(ctx: TenantContext, entry: IntelligenceAuditEntry): Promise<void>;
}
