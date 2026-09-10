import { asCorrelationId, asEventId, asICPProfileId, asICPProfileVersionId, asTenantId } from '@projectx/shared';
import { ICPProfile, ICPProfileInvariantError } from '../intelligence';

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

describe('ICPProfile immutable versioning', () => {
  describe('create v1', () => {
    it('creates version 1 with versionId and versionNumber', () => {
      const result = ICPProfile.create(defaultProfileProps(), corr(), evt());
      expect(result.success).toBe(true);
      if (!result.success) return;
      const v1 = result.value;
      expect(v1.id).toBe('icp-1');
      expect(v1.versionId).toBe('icp-1-v1');
      expect(v1.versionNumber).toBe(1);
      expect(v1.status).toBe('ACTIVE');
      expect(v1.domainEvents[0]?.eventType).toBe('ICPProfileCreated');
    });

    it('emits ICPProfileCreated with version identity', () => {
      const result = ICPProfile.create(defaultProfileProps(), corr(), evt());
      if (!result.success) return;
      const event = result.value.domainEvents[0] as any;
      expect(event.payload.profileId).toBe('icp-1');
      expect(event.payload.versionId).toBe('icp-1-v1');
      expect(event.payload.version).toBe(1);
    });
  });

  describe('createNextVersion', () => {
    it('creates v2 from v1 with same lineage ID', () => {
      const r1 = ICPProfile.create(defaultProfileProps(), corr(), evt());
      if (!r1.success) throw new Error('v1 creation failed');
      const v1 = r1.value;

      const r2 = v1.createNextVersion(
        { name: 'Manufacturing ICP v2' },
        asICPProfileVersionId('icp-1-v2'),
        corr(),
        evt(),
      );
      expect(r2.success).toBe(true);
      if (!r2.success) return;
      const v2 = r2.value;

      expect(v2.id).toBe('icp-1');
      expect(v2.versionId).toBe('icp-1-v2');
      expect(v2.versionNumber).toBe(2);
      expect(v2.name).toBe('Manufacturing ICP v2');
    });

    it('preserves v1 unchanged after creating v2', () => {
      const r1 = ICPProfile.create(defaultProfileProps(), corr(), evt());
      if (!r1.success) throw new Error('v1 creation failed');
      const v1 = r1.value;

      const originalName = v1.name;
      const originalVersionId = v1.versionId;
      const originalVersionNumber = v1.versionNumber;
      const originalThreshold = v1.qualificationThreshold;

      v1.createNextVersion(
        { name: 'Updated', qualificationThreshold: 0.8 },
        asICPProfileVersionId('icp-1-v2'),
        corr(),
        evt(),
      );

      expect(v1.name).toBe(originalName);
      expect(v1.versionId).toBe(originalVersionId);
      expect(v1.versionNumber).toBe(originalVersionNumber);
      expect(v1.qualificationThreshold).toBe(originalThreshold);
    });

    it('has different immutable version IDs for v1 and v2', () => {
      const r1 = ICPProfile.create(defaultProfileProps(), corr(), evt());
      if (!r1.success) throw new Error('v1 creation failed');

      const r2 = r1.value.createNextVersion(
        {},
        asICPProfileVersionId('icp-1-v2'),
        corr(),
        evt(),
      );
      if (!r2.success) throw new Error('v2 creation failed');

      expect(r1.value.versionId).not.toBe(r2.value.versionId);
    });

    it('increments version exactly once per createNextVersion call', () => {
      const r1 = ICPProfile.create(defaultProfileProps(), corr(), evt());
      if (!r1.success) throw new Error('v1 failed');

      const r2 = r1.value.createNextVersion({}, asICPProfileVersionId('v2'), corr(), evt());
      if (!r2.success) throw new Error('v2 failed');

      const r3 = r2.value.createNextVersion({}, asICPProfileVersionId('v3'), corr(), evt());
      if (!r3.success) throw new Error('v3 failed');

      expect(r1.value.versionNumber).toBe(1);
      expect(r2.value.versionNumber).toBe(2);
      expect(r3.value.versionNumber).toBe(3);
    });

    it('emits ICPProfileVersionCreated with previous version reference', () => {
      const r1 = ICPProfile.create(defaultProfileProps(), corr(), evt());
      if (!r1.success) throw new Error('v1 failed');

      const r2 = r1.value.createNextVersion({}, asICPProfileVersionId('icp-1-v2'), corr(), evt());
      if (!r2.success) throw new Error('v2 failed');

      const event = r2.value.domainEvents[0] as any;
      expect(event.eventType).toBe('ICPProfileVersionCreated');
      expect(event.payload.profileId).toBe('icp-1');
      expect(event.payload.versionId).toBe('icp-1-v2');
      expect(event.payload.version).toBe(2);
      expect(event.payload.previousVersionId).toBe('icp-1-v1');
    });

    it('inherits unchanged fields from previous version', () => {
      const r1 = ICPProfile.create(defaultProfileProps(), corr(), evt());
      if (!r1.success) throw new Error('v1 failed');

      const r2 = r1.value.createNextVersion(
        { name: 'New Name' },
        asICPProfileVersionId('v2'),
        corr(),
        evt(),
      );
      if (!r2.success) throw new Error('v2 failed');
      const v2 = r2.value;

      expect(v2.name).toBe('New Name');
      expect(v2.hardFilters).toEqual(r1.value.hardFilters);
      expect(v2.softCriteria).toEqual(r1.value.softCriteria);
      expect(v2.scoringWeights).toEqual(r1.value.scoringWeights);
      expect(v2.qualificationThreshold).toBe(r1.value.qualificationThreshold);
      expect(v2.reviewThreshold).toBe(r1.value.reviewThreshold);
      expect(v2.minimumConfidence).toBe(r1.value.minimumConfidence);
    });
  });

  describe('version invariant validation', () => {
    it('rejects version 0', () => {
      const props = { ...defaultProfileProps(), version: 0 };
      const result = ICPProfile.create(props, corr(), evt());
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBeInstanceOf(ICPProfileInvariantError);
    });

    it('rejects negative version', () => {
      const props = { ...defaultProfileProps(), version: -1 };
      const result = ICPProfile.create(props, corr(), evt());
      expect(result.success).toBe(false);
    });

    it('rejects NaN version', () => {
      const props = { ...defaultProfileProps(), version: NaN };
      const result = ICPProfile.create(props, corr(), evt());
      expect(result.success).toBe(false);
    });

    it('rejects fractional version', () => {
      const props = { ...defaultProfileProps(), version: 1.5 };
      const result = ICPProfile.create(props, corr(), evt());
      expect(result.success).toBe(false);
    });

    it('enforces scoring weight validation on next version', () => {
      const r1 = ICPProfile.create(defaultProfileProps(), corr(), evt());
      if (!r1.success) throw new Error('v1 failed');

      const r2 = r1.value.createNextVersion(
        { scoringWeights: { icpMatch: 0.9, signal: 0.9, intent: 0, evidenceConfidence: 0 } },
        asICPProfileVersionId('v2'),
        corr(),
        evt(),
      );
      expect(r2.success).toBe(false);
    });

    it('enforces threshold validation on next version', () => {
      const r1 = ICPProfile.create(defaultProfileProps(), corr(), evt());
      if (!r1.success) throw new Error('v1 failed');

      const r2 = r1.value.createNextVersion(
        { qualificationThreshold: 1.5 },
        asICPProfileVersionId('v2'),
        corr(),
        evt(),
      );
      expect(r2.success).toBe(false);
    });
  });

  describe('archive', () => {
    it('archives a versioned profile and retains identity', () => {
      const r1 = ICPProfile.create(defaultProfileProps(), corr(), evt());
      if (!r1.success) throw new Error('v1 failed');
      const v1 = r1.value;

      v1.archive(corr(), evt());
      expect(v1.status).toBe('ARCHIVED');
      expect(v1.versionId).toBe('icp-1-v1');
      expect(v1.versionNumber).toBe(1);
      expect(v1.id).toBe('icp-1');
    });
  });

  describe('reconstitute', () => {
    it('restores from snapshot with correct version identity', () => {
      const props = {
        ...defaultProfileProps(),
        versionId: asICPProfileVersionId('icp-1-v3'),
        version: 3,
        status: 'ACTIVE' as const,
      };
      const profile = ICPProfile.reconstitute(props, 5);

      expect(profile.id).toBe('icp-1');
      expect(profile.versionId).toBe('icp-1-v3');
      expect(profile.versionNumber).toBe(3);
      expect(profile.version).toBe(5);
      expect(profile.loadedVersion).toBe(5);
      expect(profile.domainEvents).toHaveLength(0);
    });

    it('reconstituted ARCHIVED version retains status', () => {
      const props = {
        ...defaultProfileProps(),
        status: 'ARCHIVED' as const,
      };
      const profile = ICPProfile.reconstitute(props, 2);
      expect(profile.status).toBe('ARCHIVED');
    });
  });
});
