import type { IOutreachProvider } from './outreach-provider.interface';

export interface ICalendarProvider extends IOutreachProvider {
  readonly channel: 'calendar';
}
