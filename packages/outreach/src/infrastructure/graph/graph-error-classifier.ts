import type { RetryClassification } from '@projectx/domain';
import type { GraphHttpResponse } from './graph-http-client.interface';

export interface GraphErrorClassification {
  classification: RetryClassification;
  errorCode: string;
  errorMessage: string;
  retryAfterMs?: number;
}

/**
 * Maps a Graph `sendMail` HTTP response (any non-2xx status) to the
 * provider-neutral retry classification used by `ProviderSendResult`.
 * Malformed/unparseable error bodies are treated conservatively as
 * NON_RETRYABLE rather than silently retried.
 */
export function classifyGraphError(response: GraphHttpResponse): GraphErrorClassification {
  const { status } = response;

  if (status === 429) {
    const retryAfterHeader = response.headers['retry-after'];
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;
    return {
      classification: 'RATE_LIMITED',
      errorCode: 'GRAPH_RATE_LIMITED',
      errorMessage: extractGraphErrorMessage(response) ?? 'Microsoft Graph rate limit exceeded',
      retryAfterMs: retryAfterSeconds !== undefined && !Number.isNaN(retryAfterSeconds) ? retryAfterSeconds * 1000 : 60_000,
    };
  }

  if (status === 401) {
    return {
      classification: 'NON_RETRYABLE',
      errorCode: 'GRAPH_UNAUTHORIZED',
      errorMessage: extractGraphErrorMessage(response) ?? 'Microsoft Graph rejected the access token (401)',
    };
  }

  if (status === 403) {
    return {
      classification: 'NON_RETRYABLE',
      errorCode: 'GRAPH_FORBIDDEN',
      errorMessage: extractGraphErrorMessage(response) ?? 'Microsoft Graph denied permission for this operation (403)',
    };
  }

  if (status >= 500 && status < 600) {
    return {
      classification: 'RETRYABLE',
      errorCode: 'GRAPH_SERVER_ERROR',
      errorMessage: extractGraphErrorMessage(response) ?? `Microsoft Graph server error (${status})`,
    };
  }

  if (status >= 400 && status < 500) {
    return {
      classification: 'NON_RETRYABLE',
      errorCode: 'GRAPH_CLIENT_ERROR',
      errorMessage: extractGraphErrorMessage(response) ?? `Microsoft Graph rejected the request (${status})`,
    };
  }

  return {
    classification: 'NON_RETRYABLE',
    errorCode: 'GRAPH_UNEXPECTED_RESPONSE',
    errorMessage: `Unexpected Microsoft Graph response status (${status})`,
  };
}

function extractGraphErrorMessage(response: GraphHttpResponse): string | undefined {
  if (!response.body) return undefined;
  try {
    const parsed = JSON.parse(response.body) as { error?: { message?: string; code?: string } };
    if (parsed.error?.message) {
      return parsed.error.code ? `${parsed.error.code}: ${parsed.error.message}` : parsed.error.message;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
