/**
 * Thin, provider-specific HTTP boundary for Microsoft Graph. No Graph SDK
 * types cross this interface — only plain data. Kept narrow (a single
 * `sendMail` operation) rather than a general-purpose HTTP client, matching
 * the one operation `GraphEmailProvider` actually needs.
 */
export interface GraphSendMailRequest {
  /** The mailbox performing the send, used to build the `/users/{sender}/sendMail` path. */
  senderAddress: string;
  subject: string;
  /** HTML body content. */
  bodyHtml: string;
  toRecipients: string[];
}

export interface GraphHttpResponse {
  status: number;
  headers: Record<string, string>;
  /** Raw response body text (Graph's sendMail returns an empty body on success). */
  body: string;
}

export interface GraphSentMessage {
  /** Graph message id (opaque). */
  id: string;
  /** RFC 2822 Message-ID captured from the Sent Items copy. */
  internetMessageId: string;
}

export interface IGraphHttpClient {
  sendMail(accessToken: string, request: GraphSendMailRequest): Promise<GraphHttpResponse>;

  /**
   * Look up the copy of a sent message from the sender's Sent Items folder.
   * Used to recover the real `internetMessageId` because Graph `sendMail`
   * returns an empty 202 response.
   */
  getSentMessage(
    accessToken: string,
    options: { senderAddress: string; subject: string; recipientAddress: string; sentAfter: Date },
  ): Promise<GraphSentMessage | null>;
}
