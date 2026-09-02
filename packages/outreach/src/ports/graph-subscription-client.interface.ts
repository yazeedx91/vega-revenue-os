import type { TenantContext } from '@projectx/domain';

export interface CreateGraphSubscriptionRequest {
  readonly resource: string;
  readonly notificationUrl: string;
  readonly expirationDateTime: Date;
  readonly clientState: string;
}

export interface GraphSubscription {
  readonly id: string;
  readonly resource: string;
  readonly notificationUrl: string;
  readonly expirationDateTime: Date;
  readonly clientState: string;
}

export interface GraphSubscriptionClientError {
  readonly statusCode?: number;
  readonly code: string;
  readonly message: string;
  readonly retryAfterSeconds?: number;
}

export type GraphSubscriptionResult<T> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly error: GraphSubscriptionClientError };

/**
 * Provider-neutral boundary for managing Microsoft Graph webhook subscriptions.
 * All Graph-specific types and transport concerns stay inside the adapter.
 */
export interface IGraphSubscriptionClient {
  createSubscription(
    ctx: TenantContext,
    request: CreateGraphSubscriptionRequest,
  ): Promise<GraphSubscriptionResult<GraphSubscription>>;

  listSubscriptions(ctx: TenantContext): Promise<GraphSubscriptionResult<GraphSubscription[]>>;

  deleteSubscription(ctx: TenantContext, subscriptionId: string): Promise<GraphSubscriptionResult<void>>;
}
