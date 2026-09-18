import { asAccountId, asCorrelationId, asEventId, asEvidenceId, asFacilityId, asTenantId } from '@projectx/shared';
import { Facility, FacilityInvariantError, FacilityStatus, FacilityType } from '../facility';

const tenantId = () => asTenantId('tenant-1');
const corr = () => asCorrelationId('corr-1');
const evt = () => asEventId('evt-1');

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    id: asFacilityId('fac-1'),
    tenantId: tenantId(),
    workspaceId: 'ws-1',
    accountId: asAccountId('acc-1'),
    name: 'Main Manufacturing Plant',
    facilityType: 'MANUFACTURING_PLANT' as FacilityType,
    ...overrides,
  };
}

describe('Facility', () => {
  describe('creation', () => {
    it('should create valid facility', () => {
      const facility = Facility.create(baseProps(), corr(), evt());
      expect(facility.id).toBe(asFacilityId('fac-1'));
      expect(facility.name).toBe('Main Manufacturing Plant');
      expect(facility.facilityType).toBe('MANUFACTURING_PLANT');
      expect(facility.status).toBe('UNKNOWN');
      expect(facility.accountId).toBe(asAccountId('acc-1'));
    });

    it('should reject empty name', () => {
      expect(() => Facility.create(baseProps({ name: '' }), corr(), evt())).toThrow(FacilityInvariantError);
      expect(() => Facility.create(baseProps({ name: '' }), corr(), evt())).toThrow('Facility name is required');
    });

    it('should reject empty workspace ID', () => {
      expect(() => Facility.create(baseProps({ workspaceId: '' }), corr(), evt())).toThrow(FacilityInvariantError);
      expect(() => Facility.create(baseProps({ workspaceId: '' }), corr(), evt())).toThrow('Workspace ID is required');
    });

    it('should set default status to UNKNOWN', () => {
      const facility = Facility.create(baseProps(), corr(), evt());
      expect(facility.status).toBe('UNKNOWN');
    });

    it('should accept custom status', () => {
      const facility = Facility.create(baseProps({ status: 'ACTIVE' as FacilityStatus }), corr(), evt());
      expect(facility.status).toBe('ACTIVE');
    });

    it('should generate domain event on creation', () => {
      const facility = Facility.create(baseProps(), corr(), evt());
      expect(facility.domainEvents.length).toBe(1);
      expect(facility.domainEvents[0].eventType).toBe('FacilityCreated');
    });
  });

  describe('reconstitution', () => {
    it('should reconstitute facility from snapshot', () => {
      const props = baseProps({ status: 'ACTIVE' as FacilityStatus });
      const facility = Facility.reconstitute(props, 5);
      expect(facility.id).toBe(asFacilityId('fac-1'));
      expect(facility.version).toBe(5);
      expect(facility.domainEvents.length).toBe(0);
    });
  });

  describe('updates', () => {
    it('should update facility name', () => {
      const facility = Facility.create(baseProps(), corr(), evt());
      facility.updateName('Updated Name', corr(), evt());
      expect(facility.name).toBe('Updated Name');
    });

    it('should reject empty name on update', () => {
      const facility = Facility.create(baseProps(), corr(), evt());
      expect(() => facility.updateName('', corr(), evt())).toThrow(FacilityInvariantError);
    });

    it('should update facility location', () => {
      const facility = Facility.create(baseProps(), corr(), evt());
      facility.updateLocation('New Location', corr(), evt());
      expect(facility.location).toBe('New Location');
    });

    it('should set location to undefined', () => {
      const facility = Facility.create(baseProps({ location: 'Old Location' }), corr(), evt());
      facility.updateLocation(undefined, corr(), evt());
      expect(facility.location).toBeUndefined();
    });

    it('should update facility status', () => {
      const facility = Facility.create(baseProps(), corr(), evt());
      facility.setStatus('ACTIVE', corr(), evt());
      expect(facility.status).toBe('ACTIVE');
    });

    it('should add evidence references', () => {
      const facility = Facility.create(baseProps(), corr(), evt());
      const evidenceId = asEvidenceId('ev-1');
      facility.addEvidenceReferences([evidenceId], corr(), evt());
      expect(facility.evidenceReferences).toContain(evidenceId);
    });

    it('should generate domain events on updates', () => {
      const facility = Facility.create(baseProps(), corr(), evt());
      facility.updateName('Updated Name', corr(), evt());
      expect(facility.domainEvents.length).toBe(2);
    });
  });

  describe('workspace isolation', () => {
    it('should preserve workspace ID', () => {
      const facility = Facility.create(baseProps({ workspaceId: 'ws-2' }), corr(), evt());
      expect(facility.workspaceId).toBe('ws-2');
    });

    it('should carry workspace ID through updates', () => {
      const facility = Facility.create(baseProps({ workspaceId: 'ws-2' }), corr(), evt());
      facility.updateName('Updated Name', corr(), evt());
      expect(facility.workspaceId).toBe('ws-2');
    });
  });

  describe('facility types', () => {
    it('should accept all valid facility types', () => {
      const types: FacilityType[] = [
        'MANUFACTURING_PLANT',
        'DISTRIBUTION_CENTER',
        'WAREHOUSE',
        'RESEARCH_FACILITY',
        'OFFICE',
        'OTHER',
      ];

      types.forEach((type) => {
        const facility = Facility.create(baseProps({ facilityType: type }), corr(), evt());
        expect(facility.facilityType).toBe(type);
      });
    });
  });

  describe('timestamps', () => {
    it('should set created timestamp on creation', () => {
      const before = new Date();
      const facility = Facility.create(baseProps(), corr(), evt());
      const after = new Date();
      expect(facility.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(facility.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should update timestamp on updates', () => {
      const facility = Facility.create(baseProps(), corr(), evt());
      const beforeUpdate = facility.updatedAt;
      facility.updateName('Updated Name', corr(), evt());
      expect(facility.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
    });
  });
});