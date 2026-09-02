import type { ITokenProvider } from '@projectx/infrastructure';
import type { TenantContext } from '@projectx/domain';
import type {
  CreateGraphSubscriptionRequest,
  GraphSubscription,
  GraphSubscriptionClientError,
  GraphSubscriptionResult,
  IGraphSubscriptionClient,
} from '../../ports/graph-subscription-client.interface';

const DEFAULT_GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const DEFAULT_TIMEOUT_MS = 30_000;
const GRAPH_SCOPES = ['https://graph.microsoft.com/.default'];

export interface GraphSubscriptionClientConfig {
  readonly tokenProvider: ITokenProvider;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

export class GraphSubscriptionClient implements IGraphSubscriptionClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: GraphSubscriptionClientConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_GRAPH_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async createSubscription(
    ctx: TenantContext,
    request: CreateGraphSubscriptionRequest,
  ): Promise<GraphSubscriptionResult<GraphSubscription>> {
    const body = {
      changeType: 'created',
      notificationUrl: request.notificationUrl,
      resource: request.resource,
      expirationDateTime: request.expirationDateTime.toISOString(),
      clientState: request.clientState,
    };
    const result = await this.graphRequest(ctx, 'POST', '/subscriptions', body);
    if (!result.success) {
      return result;
    }
    const parsed = this.parseSubscription(result.value);
    if (!parsed) {
      return {
        success: false,
        error: { statusCode: result.value.status, code: 'GRAPH_MALFORMED_SUBSCRIPTION', message: 'Graph returned malformed subscription payload' },
      };
    }
    return { success: true, value: parsed };
  }

  async listSubscriptions(ctx: TenantContext): Promise<GraphSubscriptionResult<GraphSubscription[]>> {
    const result = await this.graphRequest(ctx, 'GET', '/subscriptions');
    if (!result.success) {
      return result;
    }
    const parsed = this.parseSubscriptionList(result.value);
    return { success: true, value: parsed };
  }

  async deleteSubscription(ctx: TenantContext, subscriptionId: string): Promise<GraphSubscriptionResult<void>> {
    const result = await this.graphRequest(ctx, 'DELETE', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
    if (!result.success) {
      return result;
    }
    return { success: true, value: undefined };
  }

  private async graphRequest(
    _ctx: TenantContext,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<GraphSubscriptionResult<{ status: number; bodyText: string }>> {
    let accessToken: string;
    try {
      accessToken = await this.config.tokenProvider.getAccessToken(GRAPH_SCOPES);
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'GRAPH_TOKEN_ACQUISITION_FAILED',
          message: err instanceof Error ? err.message : 'Token acquisition failed',
        },
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const bodyText = await response.text();

      if (response.status >= 200 && response.status < 300) {
        return { success: true, value: { status: response.status, bodyText } };
      }

      return { success: false, error: this.classifyError(response.status, bodyText) };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          success: false,
          error: { code: 'GRAPH_TIMEOUT', message: `Graph subscription request timed out after ${this.timeoutMs}ms` },
        };
      }
      return {
        success: false,
        error: {
          code: 'GRAPH_NETWORK_ERROR',
          message: err instanceof Error ? err.message : 'Graph subscription network failure',
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private classifyError(status: number, bodyText: string): GraphSubscriptionClientError {
    const message = this.extractGraphMessage(bodyText) ?? `Microsoft Graph returned ${status}`;
    if (status === 401) return { statusCode: status, code: 'GRAPH_UNAUTHORIZED', message };
    if (status === 403) return { statusCode: status, code: 'GRAPH_FORBIDDEN', message };
    if (status === 404) return { statusCode: status, code: 'GRAPH_NOT_FOUND', message };
    if (status === 409) return { statusCode: status, code: 'GRAPH_CONFLICT', message };
    if (status === 429) {
      // Retry-After parsing is omitted here because the fetch Response headers
      // are not retained in this minimal adapter; the application can apply a
      // safe default retry if needed.
      return { statusCode: status, code: 'GRAPH_RATE_LIMITED', message, retryAfterSeconds: 60 };
    }
    if (status >= 500 && status < 600) return { statusCode: status, code: 'GRAPH_SERVER_ERROR', message };
    return { statusCode: status, code: 'GRAPH_CLIENT_ERROR', message };
  }

  private extractGraphMessage(bodyText: string): string | undefined {
    if (!bodyText) return undefined;
    try {
      const parsed = JSON.parse(bodyText) as { error?: { message?: string; code?: string } };
      if (parsed.error?.message) {
        return parsed.error.code ? `${parsed.error.code}: ${parsed.error.message}` : parsed.error.message;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private parseSubscription(response: { status: number; bodyText: string }): GraphSubscription | null {
    if (!response.bodyText) return null;
    try {
      const parsed = JSON.parse(response.bodyText) as {
        id?: string;
        resource?: string;
        notificationUrl?: string;
        expirationDateTime?: string;
        clientState?: string;
      };
      if (!parsed.id || !parsed.resource || !parsed.notificationUrl || !parsed.expirationDateTime) {
        return null;
      }
      return {
        id: parsed.id,
        resource: parsed.resource,
        notificationUrl: parsed.notificationUrl,
        expirationDateTime: new Date(parsed.expirationDateTime),
        clientState: parsed.clientState ?? '',
      };
    } catch {
      return null;
    }
  }

  private parseSubscriptionList(response: { status: number; bodyText: string }): GraphSubscription[] {
    if (!response.bodyText) return [];
    try {
      const parsed = JSON.parse(response.bodyText) as {
        value?: Array<{
          id?: string;
          resource?: string;
          notificationUrl?: string;
          expirationDateTime?: string;
          clientState?: string;
        }>;
      };
      const values = parsed.value ?? [];
      return values
        .map((item) => {
          if (!item.id || !item.resource || !item.notificationUrl || !item.expirationDateTime) return null;
          return {
            id: item.id,
            resource: item.resource,
            notificationUrl: item.notificationUrl,
            expirationDateTime: new Date(item.expirationDateTime),
            clientState: item.clientState ?? '',
          };
        })
        .filter((item): item is GraphSubscription => item !== null);
    } catch {
      return [];
    }
  }
}
