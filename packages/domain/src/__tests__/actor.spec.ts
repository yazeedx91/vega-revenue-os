import { Actor } from '../actor/actor';
import { asTenantId, asUserId } from '@projectx/shared';

describe('Actor', () => {
  it('creates a human actor attributed to a tenant', () => {
    const tenantId = asTenantId('tenant-1');
    const actor = Actor.human(asUserId('user-1'), tenantId);
    expect(actor.type).toBe('human');
    expect(actor.id).toBe('user-1');
    expect(actor.tenantId).toBe(tenantId);
  });

  it('creates agent, system, and external actors', () => {
    const tenantId = asTenantId('tenant-1');
    expect(Actor.agent('agent-1', tenantId).type).toBe('agent');
    expect(Actor.system('scheduler-1', tenantId).type).toBe('system');
    expect(Actor.external('dynamics-1', tenantId).type).toBe('external');
  });
});
