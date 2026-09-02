import type { ProviderHealth, ProviderSendRequest, ProviderSendResult, TenantContext } from '@projectx/domain';
import type { ITokenProvider } from '@projectx/infrastructure';
import type { IEmailProvider } from '../../ports/email-provider.interface';
import { classifyGraphError } from './graph-error-classifier';
import { GraphHttpNetworkError, GraphHttpTimeoutError } from './fetch-graph-http-client';
import type { IGraphHttpClient } from './graph-http-client.interface';

const DEFAULT_GRAPH_SCOPES = ['https://graph.microsoft.com/.default'];
const LIVE_EMAIL_ENABLED_ENV_VAR = 'OUTREACH_LIVE_EMAIL_ENABLED';

export interface GraphEmailProviderConfig {
  tokenProvider: ITokenProvider;
  httpClient: IGraphHttpClient;
  /** The mailbox the adapter sends from (`/users/{senderAddress}/sendMail`). */
  senderAddress: string;
  scopes?: string[];
  /**
   * Injectable for deterministic testing. Defaults to reading
   * `process.env.OUTREACH_LIVE_EMAIL_ENABLED`, requiring the exact string
   * `'true'` — missing, `'false'`, or any other value is treated as
   * disabled. This is the runtime kill-switch: it does not bypass, replace,
   * or duplicate any allowlist/suppression/approval/rate-limit/budget/
   * idempotency control in `SendSafetyGate` — it is an independent,
   * additional gate checked immediately before the Graph HTTP send.
   */
  isLiveEmailEnabled?: () => boolean;
}

/**
 * `IEmailProvider` implementation backed by the Microsoft Graph `sendMail`
 * REST API. Performs zero policy/safety decisions of its own — allowlist,
 * suppression, approval, rate limiting, budget, and idempotency are the
 * exclusive responsibility of `SendSafetyGate`; this adapter only executes
 * an already-authorized send request.
 *
 * Real external sends remain gated by `OUTREACH_LIVE_EMAIL_ENABLED`
 * (default false) and by this provider not being registered into any
 * production composition root — both must independently hold before a real
 * email can leave the system.
 */
export class GraphEmailProvider implements IEmailProvider {
  readonly providerId = 'graph-email';
  readonly channel = 'email' as const;

  private readonly scopes: string[];
  private readonly isLiveEmailEnabled: () => boolean;
  /** Per-provider-instance deduplication of already-accepted sends. Upstream
   * idempotency remains authoritative; this guard prevents a second Graph
   * sendMail call if the same idempotency key reaches the adapter twice. */
  private readonly accepted = new Map<string, { providerMessageId?: string; internetMessageId?: string }>();

  constructor(private readonly config: GraphEmailProviderConfig) {
    this.scopes = config.scopes ?? DEFAULT_GRAPH_SCOPES;
    this.isLiveEmailEnabled = config.isLiveEmailEnabled ?? (() => process.env[LIVE_EMAIL_ENABLED_ENV_VAR] === 'true');
  }

  async send(_ctx: TenantContext, request: ProviderSendRequest): Promise<ProviderSendResult> {
    // Runtime kill-switch — checked before any external HTTP request.
    // Default-false; must not be bypassed by any value other than the exact
    // string 'true'. Does not authorize unrestricted sending on its own —
    // SendSafetyGate's allowlist/approval/rate-limit/budget/idempotency
    // checks have already run upstream and remain mandatory.
    const liveEnabled = this.isLiveEmailEnabled();
    this.emitInfo('GRAPH_EMAIL_PROVIDER_SEND_INVOKED', {
      providerId: this.providerId,
      channel: this.channel,
      senderAddress: this.config.senderAddress,
      recipientAddress: request.recipientAddress,
      subject: request.subject,
      liveEnabled,
    });

    const alreadyAccepted = this.accepted.get(request.idempotencyKey as string);
    if (alreadyAccepted) {
      this.emitInfo('GRAPH_EMAIL_PROVIDER_DUPLICATE_SKIPPED', {
        providerId: this.providerId,
        senderAddress: this.config.senderAddress,
        recipientAddress: request.recipientAddress,
        idempotencyKey: request.idempotencyKey,
        providerMessageId: alreadyAccepted.providerMessageId,
        internetMessageId: alreadyAccepted.internetMessageId,
      });
      return {
        providerMessageId: alreadyAccepted.providerMessageId,
        internetMessageId: alreadyAccepted.internetMessageId,
        status: 'PROVIDER_ACCEPTED',
        costUsd: 0,
      };
    }

    if (!liveEnabled) {
      this.emitInfo('GRAPH_EMAIL_PROVIDER_LIVE_DISABLED', {
        providerId: this.providerId,
        envVar: LIVE_EMAIL_ENABLED_ENV_VAR,
        resultStatus: 'FAILED',
        providerErrorCode: 'LIVE_EMAIL_DISABLED',
      });
      return {
        status: 'FAILED',
        retryClassification: 'NON_RETRYABLE',
        providerErrorCode: 'LIVE_EMAIL_DISABLED',
        providerErrorMessage: `Live email sending is disabled (${LIVE_EMAIL_ENABLED_ENV_VAR} is not 'true')`,
        costUsd: 0,
      };
    }

    let accessToken: string;
    try {
      accessToken = await this.config.tokenProvider.getAccessToken(this.scopes);
    } catch (err) {
      return {
        status: 'FAILED',
        retryClassification: 'NON_RETRYABLE',
        providerErrorCode: 'GRAPH_TOKEN_ACQUISITION_FAILED',
        providerErrorMessage: err instanceof Error ? err.message : 'Microsoft Graph token acquisition failed',
        costUsd: 0,
      };
    }

    try {
      const response = await this.config.httpClient.sendMail(accessToken, {
        senderAddress: this.config.senderAddress,
        subject: request.subject ?? '',
        bodyHtml: request.body,
        toRecipients: [request.recipientAddress],
      });
      this.emitInfo('GRAPH_SENDMAIL_RESPONSE', {
        providerId: this.providerId,
        senderAddress: this.config.senderAddress,
        recipientAddress: request.recipientAddress,
        status: response.status,
      });

      if (response.status >= 200 && response.status < 300) {
        // Graph's sendMail endpoint returns 202 Accepted with an empty body
        // and does not return a message ID synchronously. We therefore look
        // up the copy saved to Sent Items and use its internetMessageId for
        // reliable reply correlation. We never synthesize an ID from the
        // internal idempotency/correlation key.
        let providerMessageId: string | undefined;
        let internetMessageId: string | undefined;
        try {
          const sentAfter = new Date(Date.now() - 60_000);
          const sentMessage = await this.config.httpClient.getSentMessage(accessToken, {
            senderAddress: this.config.senderAddress,
            subject: request.subject ?? '',
            recipientAddress: request.recipientAddress,
            sentAfter,
          });
          if (sentMessage?.internetMessageId) {
            internetMessageId = sentMessage.internetMessageId;
            providerMessageId = internetMessageId;
          }
        } catch (lookupErr) {
          // Log lookup failure without failing the send; correlation simply
          // remains absent until a reconciliation poller fills it in.
          this.emitWarning('GRAPH_SENT_ITEMS_LOOKUP_FAILED', lookupErr);
        }
        this.accepted.set(request.idempotencyKey as string, { providerMessageId, internetMessageId });
        this.emitInfo('GRAPH_EMAIL_PROVIDER_SEND_RESULT', {
          providerId: this.providerId,
          senderAddress: this.config.senderAddress,
          recipientAddress: request.recipientAddress,
          status: 'PROVIDER_ACCEPTED',
          providerMessageId,
          internetMessageId,
        });
        return {
          providerMessageId,
          internetMessageId,
          status: 'PROVIDER_ACCEPTED',
          costUsd: 0,
        };
      }

      const classified = classifyGraphError(response);

      // 401/403 and other 4xx (except 429) are deterministic pre-submission
      // failures: Graph did not accept the email.
      if (classified.classification === 'NON_RETRYABLE' && response.status !== 429) {
        this.emitInfo('GRAPH_EMAIL_PROVIDER_SEND_RESULT', {
          providerId: this.providerId,
          senderAddress: this.config.senderAddress,
          recipientAddress: request.recipientAddress,
          status: 'FAILED',
          providerErrorCode: classified.errorCode,
        });
        return {
          status: 'FAILED',
          retryClassification: 'NON_RETRYABLE',
          providerErrorCode: classified.errorCode,
          providerErrorMessage: classified.errorMessage,
          costUsd: 0,
        };
      }

      // 429 and 5xx responses from Graph after the request was sent are
      // ambiguous: the email may or may not have been accepted. Never retry
      // automatically; the caller must reconcile.
      const ambiguousCode = classified.classification === 'RATE_LIMITED' ? 'GRAPH_RATE_LIMITED_AMBIGUOUS' : 'GRAPH_SERVER_ERROR_AMBIGUOUS';
      this.emitInfo('GRAPH_EMAIL_PROVIDER_SEND_RESULT', {
        providerId: this.providerId,
        senderAddress: this.config.senderAddress,
        recipientAddress: request.recipientAddress,
        status: 'AMBIGUOUS',
        providerErrorCode: ambiguousCode,
      });
      return {
        status: 'AMBIGUOUS',
        providerErrorCode: ambiguousCode,
        providerErrorMessage: classified.errorMessage,
        costUsd: 0,
      };
    } catch (err) {
      // Any exception after the request was dispatched is ambiguous: we cannot
      // know whether Graph accepted the email before the response was lost.
      let providerErrorCode: string;
      let providerErrorMessage: string;
      if (err instanceof GraphHttpTimeoutError) {
        providerErrorCode = 'GRAPH_TIMEOUT_AMBIGUOUS';
        providerErrorMessage = err.message;
      } else if (err instanceof GraphHttpNetworkError) {
        providerErrorCode = 'GRAPH_NETWORK_ERROR_AMBIGUOUS';
        providerErrorMessage = err.message;
      } else {
        providerErrorCode = 'GRAPH_UNKNOWN_ERROR_AMBIGUOUS';
        providerErrorMessage = err instanceof Error ? err.message : 'Unknown Microsoft Graph send failure';
      }
      this.emitInfo('GRAPH_EMAIL_PROVIDER_SEND_RESULT', {
        providerId: this.providerId,
        senderAddress: this.config.senderAddress,
        recipientAddress: request.recipientAddress,
        status: 'AMBIGUOUS',
        providerErrorCode,
      });
      return {
        status: 'AMBIGUOUS',
        providerErrorCode,
        providerErrorMessage,
        costUsd: 0,
      };
    }
  }

  private emitInfo(code: string, details: Record<string, unknown>): void {
    console.info(
      JSON.stringify({
        level: 'info',
        provider: 'graph-email',
        code,
        ...details,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  private emitWarning(code: string, err: unknown): void {
    console.warn(
      JSON.stringify({
        level: 'warn',
        provider: 'graph-email',
        code,
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      }),
    );
  }

  async checkHealth(_ctx: TenantContext): Promise<ProviderHealth> {
    try {
      await this.config.tokenProvider.getAccessToken(this.scopes);
      return { healthy: true };
    } catch (err) {
      return { healthy: false, reason: err instanceof Error ? err.message : 'Microsoft Graph token acquisition failed' };
    }
  }
}
