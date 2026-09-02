import type { IOutreachProvider } from './outreach-provider.interface';

export interface IEmailProvider extends IOutreachProvider {
  readonly channel: 'email';
}
