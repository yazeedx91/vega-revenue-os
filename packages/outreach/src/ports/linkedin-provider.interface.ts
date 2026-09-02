import type { IOutreachProvider } from './outreach-provider.interface';

export interface ILinkedInProvider extends IOutreachProvider {
  readonly channel: 'linkedin';
}
