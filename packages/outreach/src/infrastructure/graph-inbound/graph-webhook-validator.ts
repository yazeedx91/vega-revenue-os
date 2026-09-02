import { timingSafeEqual } from 'crypto';
import type { ISecretsProvider } from '@projectx/infrastructure';
import type { GraphChangeNotification } from './graph-inbound.types';

export type GraphWebhookValidationOutcome =
  | { readonly status: 'VALID' }
  | { readonly status: 'INVALID_CLIENT_STATE'; readonly reason: string }
  | { readonly status: 'MALFORMED'; readonly reason: string }
  | { readonly status: 'OVERSIZED'; readonly reason: string };

export interface GraphWebhookValidatorConfig {
  readonly secretsProvider: ISecretsProvider;
  /** Maximum accepted size (bytes) of a single notification's JSON-serialized form. */
  readonly maxNotificationBytes?: number;
}

const DEFAULT_MAX_NOTIFICATION_BYTES = 256 * 1024;

/**
 * Validates a single Graph change notification: structural shape, size cap,
 * and the `clientState` shared-secret check (a plain string comparison
 * against the tenant's registered secret — Graph change notifications are
 * not cryptographically signed; `clientState` is Graph's own authenticity
 * mechanism). Tenant resolution happens separately
 * (`graph-tenant-resolver.ts`) since `clientState` can only be checked once
 * a tenant (and therefore a `webhookSecretReference`) is known.
 */
export class GraphWebhookValidator {
  private readonly maxNotificationBytes: number;

  constructor(private readonly config: GraphWebhookValidatorConfig) {
    this.maxNotificationBytes = config.maxNotificationBytes ?? DEFAULT_MAX_NOTIFICATION_BYTES;
  }

  validateShape(notification: unknown): GraphWebhookValidationOutcome {
    const size = Buffer.byteLength(JSON.stringify(notification ?? {}), 'utf8');
    if (size > this.maxNotificationBytes) {
      return { status: 'OVERSIZED', reason: `Notification exceeds ${this.maxNotificationBytes} bytes` };
    }

    if (!notification || typeof notification !== 'object') {
      return { status: 'MALFORMED', reason: 'Notification is not an object' };
    }

    const candidate = notification as Partial<GraphChangeNotification>;
    if (typeof candidate.subscriptionId !== 'string' || !candidate.subscriptionId) {
      return { status: 'MALFORMED', reason: 'Missing subscriptionId' };
    }
    if (typeof candidate.resource !== 'string' || !candidate.resource) {
      return { status: 'MALFORMED', reason: 'Missing resource' };
    }
    if (typeof candidate.changeType !== 'string' || !candidate.changeType) {
      return { status: 'MALFORMED', reason: 'Missing changeType' };
    }

    return { status: 'VALID' };
  }

  /** Requires the resolved tenant's `webhookSecretReference` so the caller has already run tenant resolution. */
  async validateClientState(
    notification: GraphChangeNotification,
    webhookSecretReference: string | undefined,
  ): Promise<GraphWebhookValidationOutcome> {
    if (!webhookSecretReference) {
      return { status: 'INVALID_CLIENT_STATE', reason: 'Tenant has no webhook secret configured' };
    }
    const expected = await this.config.secretsProvider.getSecret(webhookSecretReference);
    if (!notification.clientState) {
      return { status: 'INVALID_CLIENT_STATE', reason: 'clientState does not match the registered secret' };
    }
    const expectedBuf = Buffer.from(expected, 'utf8');
    const actualBuf = Buffer.from(notification.clientState, 'utf8');
    if (expectedBuf.length !== actualBuf.length) {
      return { status: 'INVALID_CLIENT_STATE', reason: 'clientState does not match the registered secret' };
    }
    if (!timingSafeEqual(expectedBuf, actualBuf)) {
      return { status: 'INVALID_CLIENT_STATE', reason: 'clientState does not match the registered secret' };
    }
    return { status: 'VALID' };
  }
}
