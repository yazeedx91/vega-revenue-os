/**
 * Canonical `ReplyIngressEvent` now lives in `@projectx/domain` so that
 * `packages/outreach`'s inbound-ingress pipeline (Phase 14 Milestone 6) can
 * produce this shape without creating an `outreach` -> `conversation`
 * dependency. Re-exported here unchanged for backward compatibility with
 * every existing caller of this port.
 */
export type { ReplyIngressEvent } from '@projectx/domain';
import type { ReplyIngressEvent } from '@projectx/domain';

export interface IReplyIngress {
  next(): Promise<ReplyIngressEvent | null>;
}
