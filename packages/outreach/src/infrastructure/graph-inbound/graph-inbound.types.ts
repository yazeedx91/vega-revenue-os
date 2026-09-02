/**
 * Raw Microsoft Graph change-notification / message JSON shapes. These
 * types never cross into `packages/domain`/`packages/conversation` —
 * `graph-message-normalizer.ts` is the one place that maps them into the
 * canonical `ReplyIngressEvent`.
 */
export interface GraphChangeNotification {
  readonly subscriptionId: string;
  readonly clientState?: string;
  readonly changeType: string;
  /** e.g. `Users/{mailboxId}/Messages/{messageId}`. */
  readonly resource: string;
  readonly resourceData?: {
    readonly id?: string;
    readonly [key: string]: unknown;
  };
}

export interface GraphChangeNotificationPayload {
  readonly value: GraphChangeNotification[];
}

export interface GraphEmailAddress {
  readonly emailAddress?: {
    readonly name?: string;
    readonly address?: string;
  };
}

export interface GraphMessagePayload {
  readonly id: string;
  readonly internetMessageId?: string;
  readonly subject?: string;
  readonly from?: GraphEmailAddress;
  readonly toRecipients?: GraphEmailAddress[];
  readonly body?: {
    readonly contentType?: 'text' | 'html';
    readonly content?: string;
  };
  readonly bodyPreview?: string;
  readonly receivedDateTime?: string;
  readonly hasAttachments?: boolean;
  /** Raw RFC822 header values Graph exposes via `$select=internetMessageHeaders`. */
  readonly internetMessageHeaders?: Array<{ name: string; value: string }>;
}
