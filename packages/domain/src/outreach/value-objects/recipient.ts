import type { ContactId } from '@projectx/shared';
import type { OutreachChannel } from './provider-contracts';

export interface Recipient {
  readonly contactId: ContactId;
  readonly name?: string;
  readonly email?: string;
  readonly linkedInHandle?: string;
  readonly channel: OutreachChannel;
  readonly address: string;
}
