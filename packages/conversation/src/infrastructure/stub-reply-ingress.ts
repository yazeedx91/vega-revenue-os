import type { IReplyIngress, ReplyIngressEvent } from '../ports/reply-ingress.interface';

export class StubReplyIngress implements IReplyIngress {
  private queue: ReplyIngressEvent[] = [];

  enqueue(event: ReplyIngressEvent): void {
    this.queue.push(event);
  }

  async next(): Promise<ReplyIngressEvent | null> {
    return this.queue.shift() ?? null;
  }
}
