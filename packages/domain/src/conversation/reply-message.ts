import type { ReplyMessageId } from '@projectx/shared';

export interface ReplyMessageProps {
  readonly id: ReplyMessageId;
  readonly providerMessageId: string;
  readonly channel: string;
  readonly content: string;
  readonly receivedAt: Date;
  /** Canonical `Message-Id` header of this message. */
  readonly messageIdHeader?: string;
  readonly sender?: string;
  readonly recipientAddress?: string;
  readonly subject?: string;
  /** Sanitized rich-text body, when available. `content` remains the canonical plain-text representation. */
  readonly htmlBody?: string;
  readonly inReplyTo?: string;
  readonly references?: string[];
}

export class ReplyMessage {
  constructor(private readonly props: ReplyMessageProps) {}

  get id(): ReplyMessageId {
    return this.props.id;
  }

  get providerMessageId(): string {
    return this.props.providerMessageId;
  }

  get channel(): string {
    return this.props.channel;
  }

  get content(): string {
    return this.props.content;
  }

  get receivedAt(): Date {
    return this.props.receivedAt;
  }

  get messageIdHeader(): string | undefined {
    return this.props.messageIdHeader;
  }

  get sender(): string | undefined {
    return this.props.sender;
  }

  get recipientAddress(): string | undefined {
    return this.props.recipientAddress;
  }

  get subject(): string | undefined {
    return this.props.subject;
  }

  get htmlBody(): string | undefined {
    return this.props.htmlBody;
  }

  get inReplyTo(): string | undefined {
    return this.props.inReplyTo;
  }

  get references(): string[] | undefined {
    return this.props.references;
  }
}
