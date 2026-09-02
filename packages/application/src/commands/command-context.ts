import type { Actor } from '@projectx/domain';
import type { CausationId, CorrelationId, IdempotencyKey, TenantId } from '@projectx/shared';

export interface CommandContext {
  readonly tenantId: TenantId;
  readonly actor: Actor;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  readonly idempotencyKey?: IdempotencyKey;
}
