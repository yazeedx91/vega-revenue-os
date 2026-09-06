import type { TenantContext } from '@projectx/domain';
import type { ISecretsProvider } from '@projectx/infrastructure';
import type { ToolCallRequest, ToolProviderOutcome } from '@projectx/shared';
import type { IToolProvider } from '../tool-provider.interface';

/**
 * Privileged, server-side egress policy for the HTTP provider. This is
 * authoritative control-plane/server configuration — it is NEVER derived from
 * agent/tool input and ordinary agents or unprivileged tenant requests cannot
 * rewrite it. `ToolDefinition.config` may select a named route but can never
 * widen the allowlist or inject a destination.
 */
export interface HttpEgressPolicy {
  /** Allowed destination hostnames (exact match or *.suffix). */
  readonly allowedHosts: readonly string[];
  /** Allowed URL schemes. Production should be ['https'] only. */
  readonly allowedSchemes: readonly string[];
  /** Permit loopback/private/link-local/metadata destinations (test only). */
  readonly allowPrivateNetwork: boolean;
  /** Follow redirects at all; each redirect target is re-validated. */
  readonly allowRedirects: boolean;
  /** Optional named routes → fixed baseUrl, resolved server-side only. */
  readonly routes?: Record<string, { baseUrl: string; secretRef?: string }>;
}

export interface HttpToolProviderOptions {
  readonly providerId: string;
  readonly policy: HttpEgressPolicy;
  readonly secrets?: ISecretsProvider;
  /** Injectable fetch for deterministic tests. */
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

const PRIVATE_HOSTNAMES = new Set([
  'localhost', 'metadata.google.internal', 'instance-data', '169.254.169.254',
]);

function isPrivateIp(host: string): boolean {
  // IPv4 loopback/private/link-local + IPv6 loopback/ULA/link-local.
  if (/^127\./.test(host) || host === '::1') return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true; // link-local + cloud metadata
  if (/^fe80:/i.test(host) || /^f[cd]/i.test(host)) return true; // IPv6 ULA/link-local
  if (host === '0.0.0.0' || host === '0') return true;
  return false;
}

function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((a) => {
    const al = a.toLowerCase();
    if (al.startsWith('*.')) return h === al.slice(2) || h.endsWith(al.slice(1));
    return h === al;
  });
}

/**
 * SSRF/egress-hardened HTTP tool provider. The destination is resolved only
 * from the privileged server-side egress policy (a named route or an allowlisted
 * baseUrl in trusted config) — never from agent/tool arguments. Credentials are
 * injected only via `ISecretsProvider` and resolved secret values are never
 * persisted or logged.
 */
export class HttpToolProvider implements IToolProvider {
  readonly providerId: string;
  private readonly policy: HttpEgressPolicy;
  private readonly secrets?: ISecretsProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(opts: HttpToolProviderOptions) {
    this.providerId = opts.providerId;
    this.policy = opts.policy;
    this.secrets = opts.secrets;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? (() => new Date());
  }

  async execute(ctx: TenantContext, request: ToolCallRequest): Promise<ToolProviderOutcome> {
    // Resolve destination strictly from privileged server config.
    const dest = this.resolveDestination(request);
    if (!dest.ok) {
      return {
        submitted: false,
        resultKnown: true,
        retryable: false,
        failureClassification: 'EGRESS_DENIED',
        errorCode: 'EGRESS_DENIED',
        errorMessage: dest.reason,
      };
    }

    // Resolve credentials via ISecretsProvider only (never from tool input).
    let authHeader: string | undefined;
    if (dest.secretRef && this.secrets) {
      const secret = await this.secrets.getSecret(dest.secretRef);
      authHeader = `Bearer ${secret}`;
    }

    const timeoutMs = Math.max(1, request.timeoutSeconds) * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(dest.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authHeader ? { authorization: authHeader } : {}),
          'x-correlation-id': String(request.correlationId),
        },
        body: JSON.stringify({
          toolCallId: request.toolCallId,
          toolId: request.toolId,
          input: request.input,
        }),
        signal: controller.signal,
        redirect: this.policy.allowRedirects ? 'manual' : 'error',
      });

      // Re-validate any redirect target against the egress policy.
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        const redirectCheck = location ? this.validateUrl(location) : { ok: false as const, reason: 'redirect without location' };
        if (!redirectCheck.ok) {
          return {
            submitted: true,
            resultKnown: false,
            retryable: false,
            failureClassification: 'REDIRECT_DENIED',
            errorCode: 'REDIRECT_DENIED',
            errorMessage: 'redirect target not allowlisted',
          };
        }
      }

      const providerRequestId = res.headers.get('x-request-id') ?? undefined;
      if (!res.ok) {
        // Definitive provider rejection — submitted, result known.
        return {
          submitted: true,
          resultKnown: true,
          retryable: res.status >= 500,
          failureClassification: `HTTP_${res.status}`,
          providerRequestId,
          errorCode: `HTTP_${res.status}`,
          errorMessage: `provider responded ${res.status}`,
        };
      }
      const output = await res.json().catch(() => undefined);
      return {
        submitted: true,
        resultKnown: true,
        retryable: false,
        providerRequestId,
        output,
      };
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      // Timeout/abort AFTER the request may have been accepted → ambiguous.
      // Never infer timeout == not submitted.
      return {
        submitted: true,
        resultKnown: false,
        retryable: false,
        failureClassification: aborted ? 'TIMEOUT' : 'TRANSPORT_ERROR',
        errorCode: aborted ? 'TIMEOUT' : 'TRANSPORT_ERROR',
        errorMessage: aborted ? 'provider request timed out' : 'transport error',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Resolve the destination URL from privileged config only. A named route in
   * `request.metadata.route` selects a server-configured route; otherwise a
   * `baseUrl` may come only from trusted definition config — and is still
   * validated against the egress allowlist. Agent/tool input can never supply
   * or widen the destination.
   */
  private resolveDestination(
    request: ToolCallRequest,
  ): { ok: true; url: string; secretRef?: string } | { ok: false; reason: string } {
    const routeName = request.metadata?.route as string | undefined;
    if (routeName) {
      const route = this.policy.routes?.[routeName];
      if (!route) return { ok: false, reason: `unknown route ${routeName}` };
      const check = this.validateUrl(route.baseUrl);
      if (!check.ok) return { ok: false, reason: check.reason };
      return { ok: true, url: route.baseUrl, secretRef: route.secretRef };
    }
    // No route → no destination. baseUrl is never read from tool input.
    return { ok: false, reason: 'no privileged destination configured' };
  }

  private validateUrl(raw: string): { ok: true } | { ok: false; reason: string } {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return { ok: false, reason: 'invalid destination URL' };
    }
    const scheme = url.protocol.replace(':', '').toLowerCase();
    if (!this.policy.allowedSchemes.includes(scheme)) {
      return { ok: false, reason: `scheme ${scheme} not allowed` };
    }
    const host = url.hostname.toLowerCase();
    if (!this.policy.allowPrivateNetwork) {
      if (PRIVATE_HOSTNAMES.has(host) || isPrivateIp(host)) {
        return { ok: false, reason: 'private/loopback/metadata destination blocked' };
      }
    }
    if (!hostAllowed(host, this.policy.allowedHosts)) {
      return { ok: false, reason: `host ${host} not in egress allowlist` };
    }
    return { ok: true };
  }
}
