import type { ITokenProvider } from '@projectx/infrastructure';
import type { GraphMessagePayload } from './graph-inbound.types';
import type { IGraphInboundMessageFetcher } from './graph-inbound-message-fetcher.interface';

export interface FetchGraphInboundMessageFetcherConfig {
  readonly tokenProvider: ITokenProvider;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly scopes?: string[];
}

const DEFAULT_BASE_URL = 'https://graph.microsoft.com/v1.0';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SCOPES = ['https://graph.microsoft.com/.default'];
const MESSAGE_SELECT =
  'id,internetMessageId,subject,from,toRecipients,body,bodyPreview,receivedDateTime,hasAttachments,internetMessageHeaders';

export class GraphInboundFetchError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'GraphInboundFetchError';
  }
}

/**
 * Real `IGraphInboundMessageFetcher` implementation: native `fetch` +
 * `ITokenProvider` (e.g. `MsalTokenProvider`), no Graph SDK. Built and unit
 * tested, but not the default binding in `apps/api`'s composition (see the
 * Milestone 6 completion report) — no real Graph credentials exist in this
 * environment.
 */
export class FetchGraphInboundMessageFetcher implements IGraphInboundMessageFetcher {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly scopes: string[];

  constructor(private readonly config: FetchGraphInboundMessageFetcherConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.scopes = config.scopes ?? DEFAULT_SCOPES;
  }

  async getMessage(mailbox: string, messageId: string): Promise<GraphMessagePayload | null> {
    const url = `${this.baseUrl}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}?$select=${MESSAGE_SELECT}`;
    const response = await this.request(url);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new GraphInboundFetchError(`Graph getMessage failed with status ${response.status}`);
    }
    return (await response.json()) as GraphMessagePayload;
  }

  async listChangedMessages(mailbox: string, since: Date): Promise<GraphMessagePayload[]> {
    const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);
    const url = `${this.baseUrl}/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?$filter=${filter}&$select=${MESSAGE_SELECT}`;
    const response = await this.request(url);
    if (!response.ok) {
      throw new GraphInboundFetchError(`Graph listChangedMessages failed with status ${response.status}`);
    }
    const body = (await response.json()) as { value?: GraphMessagePayload[] };
    return body.value ?? [];
  }

  private async request(url: string): Promise<Response> {
    const accessToken = await this.config.tokenProvider.getAccessToken(this.scopes);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
    } catch (err) {
      throw new GraphInboundFetchError(err instanceof Error ? err.message : 'Unknown Graph inbound fetch failure', err);
    } finally {
      clearTimeout(timeout);
    }
  }
}
