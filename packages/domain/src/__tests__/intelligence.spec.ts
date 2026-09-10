import { asAccountId, asContactId, asCorrelationId, asEventId, asEvidenceId, asICPProfileId, asICPProfileVersionId, asLeadId, asResearchRequestId, asResearchRunId, asTenantId } from '@projectx/shared';
import {
  Account,
  Contact,
  ICPProfile,
  ICPProfileInvariantError,
  Lead,
  LeadInvariantError,
  ResearchEvidence,
} from '../intelligence';

const tenantId = () => asTenantId('tenant-1');
const corr = () => asCorrelationId('corr-1');
const evt = () => asEventId('evt-1');

function defaultProfileProps() {
  return {
    id: asICPProfileId('icp-1'),
    versionId: asICPProfileVersionId('icp-1-v1'),
    version: 1,
    tenantId: tenantId(),
    workspaceId: 'ws-1',
    name: 'Manufacturing ICP',
    hardFilters: {
      industries: ['Manufacturing'],
      minEmployees: 50,
      territories: ['US'],
    },
    softCriteria: [{ criterion: 'uses cloud ERP', weight: 0.2 }],
    positiveSignals: ['hiring engineers'],
    negativeSignals: ['layoffs'],
    disqualifiers: ['competitor locked-in'],
    scoringWeights: { icpMatch: 0.4, signal: 0.25, intent: 0.15, evidenceConfidence: 0.2 },
    qualificationThreshold: 0.75,
    reviewThreshold: 0.55,
    minimumConfidence: 0.6,
  };
}

describe('ICPProfile', () => {
  it('creates a valid profile', () => {
    const profile = ICPProfile.create(defaultProfileProps(), corr(), evt());
    expect(profile.success).toBe(true);
    if (!profile.success) return;
    expect(profile.value.status).toBe('ACTIVE');
    expect(profile.value.domainEvents[0]?.eventType).toBe('ICPProfileCreated');
  });

  it('rejects invalid thresholds', () => {
    const props = { ...defaultProfileProps(), qualificationThreshold: 1.5 };
    const result = ICPProfile.create(props, corr(), evt());
    expect(result.success).toBe(false);
    expect((result as any).error).toBeInstanceOf(ICPProfileInvariantError);
  });

  it('rejects weights that do not sum to 1', () => {
    const props = { ...defaultProfileProps(), scoringWeights: { icpMatch: 0.5, signal: 0.4, intent: 0, evidenceConfidence: 0 } };
    const result = ICPProfile.create(props, corr(), evt());
    expect(result.success).toBe(false);
  });
});

describe('Account', () => {
  it('discovers and enriches an account', () => {
    const account = Account.discover(
      {
        id: asAccountId('acc-1'),
        tenantId: tenantId(),
        workspaceId: 'ws-1',
        name: 'Acme Corp',
        domain: 'acme.com',
        industry: 'Manufacturing',
        employeeCount: 500,
      },
      'provider',
      corr(),
      evt(),
    );
    expect(account.status).toBe('DISCOVERED');
    account.enrich({ territories: ['US'] }, [asEvidenceId('ev-1')], corr(), evt());
    expect(account.status).toBe('ENRICHED');
    expect(account.domainEvents.some((e) => e.eventType === 'AccountEnriched')).toBe(true);
  });

  it('marks a duplicate', () => {
    const account = Account.discover(
      { id: asAccountId('acc-2'), tenantId: tenantId(), workspaceId: 'ws-1', name: 'Acme' },
      'provider',
      corr(),
      evt(),
    );
    account.markDuplicate(asAccountId('acc-1'), 'duplicate name', corr(), evt());
    expect(account.status).toBe('DUPLICATE');
    expect(account.duplicateOf).toBe('acc-1');
  });

  it('disqualifies an account', () => {
    const account = Account.discover(
      { id: asAccountId('acc-3'), tenantId: tenantId(), workspaceId: 'ws-1', name: 'Bad Fit' },
      'provider',
      corr(),
      evt(),
    );
    account.disqualify('territory mismatch', corr(), evt());
    expect(account.status).toBe('DISQUALIFIED');
  });
});

describe('Contact', () => {
  it('discovers, enriches, and validates a contact', () => {
    const contact = Contact.discover(
      {
        id: asContactId('con-1'),
        tenantId: tenantId(),
        workspaceId: 'ws-1',
        accountId: asAccountId('acc-1'),
        name: 'Jane Doe',
      },
      'provider',
      corr(),
      evt(),
    );
    expect(contact.status).toBe('DISCOVERED');
    contact.enrich({ title: 'VP Sales' }, [asEvidenceId('ev-1')], corr(), evt());
    expect(contact.status).toBe('ENRICHED');
    contact.validate(corr(), evt());
    expect(contact.status).toBe('VALIDATED');
  });

  it('suppresses a contact', () => {
    const contact = Contact.discover(
      { id: asContactId('con-2'), tenantId: tenantId(), workspaceId: 'ws-1', accountId: asAccountId('acc-1'), name: 'Spam' },
      'provider',
      corr(),
      evt(),
    );
    contact.suppress('opt-out', corr(), evt());
    expect(contact.status).toBe('SUPPRESSED');
  });
});

function leadProps(overrides: Record<string, unknown> = {}) {
  return {
    id: asLeadId('lead-1'),
    tenantId: tenantId(),
    workspaceId: 'ws-1',
    accountId: asAccountId('acc-1'),
    contactId: asContactId('con-1'),
    icpProfileId: asICPProfileId('icp-1'),
    icpProfileVersionId: asICPProfileVersionId('icp-1-v1'),
    ...overrides,
  };
}

function evalInput(overrides: Record<string, unknown> = {}) {
  return {
    scores: { icpMatch: 0.9, signalScore: 0.8, intentScore: 0.85, evidenceConfidence: 0.9, overall: 0.85 },
    qualificationThreshold: 0.75,
    reviewThreshold: 0.55,
    hardFilterResults: [],
    evidenceIds: [asEvidenceId('ev-1')],
    signalIds: [],
    normalizedFeatures: {},
    snapshotSchemaVersion: '1.0',
    scoringPolicyVersion: '1.0',
    algorithmVersion: '1.0',
    evaluatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('Lead', () => {
  it('qualifies when score is above threshold', () => {
    const lead = Lead.create(leadProps(), corr(), evt());
    const result = lead.evaluate(evalInput() as any, corr(), evt());
    expect(result.success).toBe(true);
    expect(lead.status).toBe('QUALIFIED');
    expect(lead.domainEvents.some((e) => e.eventType === 'LeadQualified')).toBe(true);
  });

  it('requires review between thresholds', () => {
    const lead = Lead.create(leadProps({ id: asLeadId('lead-2') }), corr(), evt());
    const scores = { icpMatch: 0.6, signalScore: 0.5, intentScore: 0.55, evidenceConfidence: 0.6, overall: 0.6 };
    lead.evaluate(evalInput({ scores }) as any, corr(), evt());
    expect(lead.status).toBe('NEEDS_REVIEW');
  });

  it('disqualifies below review threshold', () => {
    const lead = Lead.create(leadProps({ id: asLeadId('lead-3') }), corr(), evt());
    const scores = { icpMatch: 0.3, signalScore: 0.2, intentScore: 0.25, evidenceConfidence: 0.3, overall: 0.3 };
    lead.evaluate(evalInput({ scores, evidenceIds: [] }) as any, corr(), evt());
    expect(lead.status).toBe('NOT_QUALIFIED');
  });

  it('rejects invalid overall scores', () => {
    const lead = Lead.create(leadProps({ id: asLeadId('lead-4') }), corr(), evt());
    const scores = { icpMatch: 0, signalScore: 0, intentScore: 0, evidenceConfidence: 0, overall: 1.5 };
    const result = lead.evaluate(evalInput({ scores, evidenceIds: [] }) as any, corr(), evt());
    expect(result.success).toBe(false);
    expect((result as any).error).toBeInstanceOf(LeadInvariantError);
  });

  it('approves a lead under review', () => {
    const lead = Lead.create(leadProps({ id: asLeadId('lead-5') }), corr(), evt());
    const scores = { icpMatch: 0.6, signalScore: 0.5, intentScore: 0.55, evidenceConfidence: 0.6, overall: 0.6 };
    lead.evaluate(evalInput({ scores, evidenceIds: [] }) as any, corr(), evt());
    lead.approve(corr(), evt());
    expect(lead.status).toBe('QUALIFIED');
  });
});

describe('ResearchEvidence', () => {
  it('stores evidence with provenance and freshness', () => {
    const now = new Date().toISOString();
    const expiry = new Date(Date.now() + 86_400_000).toISOString();
    const evidence = new ResearchEvidence({
      evidenceId: asEvidenceId('ev-1'),
      tenantId: tenantId(),
      workspaceId: 'ws-1',
      requestId: asResearchRequestId('req-1'),
      runId: asResearchRunId('run-1'),
      accountId: asAccountId('acc-1'),
      claimType: 'EMPLOYEE_COUNT',
      normalizedValue: 500,
      source: 'provider',
      reliabilityTier: 'PREMIUM_PROVIDER',
      observedAt: now,
      freshnessExpiry: expiry,
      confidence: 0.85,
      confidenceBreakdown: { sourceReliability: 0.8, extractionConfidence: 0.9, corroboration: 0 },
      provenance: [{ step: 'provider-lookup', inputSummary: 'lookup', outputSummary: '500', occurredAt: now }],
      evidenceFingerprint: 'fp-abc123',
    });
    expect(evidence.isFresh()).toBe(true);
    expect(evidence.confidence).toBe(0.85);
  });

  it('preserves contradictions from creation', () => {
    const now = new Date().toISOString();
    const expiry = new Date(Date.now() + 86_400_000).toISOString();
    const evidence = new ResearchEvidence({
      evidenceId: asEvidenceId('ev-1'),
      tenantId: tenantId(),
      workspaceId: 'ws-1',
      requestId: asResearchRequestId('req-1'),
      runId: asResearchRunId('run-1'),
      claimType: 'EMPLOYEE_COUNT',
      normalizedValue: 500,
      source: 'provider',
      reliabilityTier: 'PREMIUM_PROVIDER',
      observedAt: now,
      freshnessExpiry: expiry,
      confidence: 0.85,
      confidenceBreakdown: { sourceReliability: 0.8, extractionConfidence: 0.9, corroboration: 0 },
      provenance: [],
      contradictions: [{ conflictingEvidenceId: asEvidenceId('ev-2'), reason: 'different count', resolution: 'UNRESOLVED' }],
      evidenceFingerprint: 'fp-def456',
    });
    expect(evidence.props.contradictions?.length).toBe(1);
  });
});
