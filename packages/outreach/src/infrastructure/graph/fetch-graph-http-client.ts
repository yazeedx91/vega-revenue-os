import type { GraphHttpResponse, GraphSendMailRequest, GraphSentMessage, IGraphHttpClient } from './graph-http-client.interface';

export interface FetchGraphHttpClientConfig {
  /** Defaults to the production Microsoft Graph v1.0 endpoint. */
  baseUrl?: string;
  /** Request timeout in milliseconds; a timeout is treated as retryable by the adapter. */
  timeoutMs?: number;
}

/** Raised when the Graph HTTP request itself times out or fails at the network layer (not an HTTP error status). */
export class GraphHttpTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphHttpTimeoutError';
  }
}

export class GraphHttpNetworkError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'GraphHttpNetworkError';
  }
}

const DEFAULT_BASE_URL = 'https://graph.microsoft.com/v1.0';
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Native-`fetch`-based implementation of `IGraphHttpClient`, calling the
 * Microsoft Graph `sendMail` REST endpoint directly (no Graph SDK).
 */
export class FetchGraphHttpClient implements IGraphHttpClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config?: FetchGraphHttpClientConfig) {
    this.baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async sendMail(accessToken: string, request: GraphSendMailRequest): Promise<GraphHttpResponse> {
    const url = `${this.baseUrl}/users/${encodeURIComponent(request.senderAddress)}/sendMail`;
    const payload = {
      message: {
        subject: request.subject,
        body: { contentType: 'HTML', content: request.bodyHtml },
        toRecipients: request.toRecipients.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name] = value;
      });

      return { status: response.status, headers, body };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new GraphHttpTimeoutError(`Graph sendMail request timed out after ${this.timeoutMs}ms`);
      }
      throw new GraphHttpNetworkError(err instanceof Error ? err.message : 'Unknown Graph HTTP network failure', err);
    } finally {
      clearTimeout(timeout);
    }
  }

  async getSentMessage(
    accessToken: string,
    options: { senderAddress: string; subject: string; recipientAddress: string; sentAfter: Date },
  ): Promise<GraphSentMessage | null> {
    const filterParts = [
      `sentDateTime ge ${options.sentAfter.toISOString()}`,
      `subject eq '${options.subject.replace(/'/g, "''")}'`,
    ];
    const filter = encodeURIComponent(filterParts.join(' and '));
    const url = `${this.baseUrl}/users/${encodeURIComponent(options.senderAddress)}/mailFolders/sentitems/messages?$filter=${filter}&$select=id,internetMessageId,toRecipients&$top=10&$orderby=sentDateTime desc`;
    const response = await this.request(url, accessToken);
    if (!response.ok) {
      throw new GraphHttpNetworkError(`Graph Sent Items lookup failed with status ${response.status}`);
    }
    const body = (await response.json()) as {
      value?: Array<{
        id: string;
        internetMessageId: string;
        toRecipients: Array<{ emailAddress?: { address?: string } }>;
      }>;
    };
    const messages = body.value ?? [];
    const normalizedRecipient = options.recipientAddress.toLowerCase();
    for (const message of messages) {
      const recipients = message.toRecipients ?? [];
      if (recipients.some((r) => r.emailAddress?.address?.toLowerCase() === normalizedRecipient)) {
        return { id: message.id, internetMessageId: message.internetMessageId };
      }
    }
    return null;
  }

  private async request(url: string, accessToken?: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }
      return await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new GraphHttpTimeoutError(`Graph request timed out after ${this.timeoutMs}ms`);
      }
      throw new GraphHttpNetworkError(err instanceof Error ? err.message : 'Unknown Graph HTTP network failure', err);
    } finally {
      clearTimeout(timeout);
    }
  }
}
