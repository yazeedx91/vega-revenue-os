import type { TenantContext } from '@projectx/domain';
import type { IOutreachProvider } from './outreach-provider.interface';

export interface CalendarAvailabilityRequest { start: Date; end: Date; timeZone: string; }
export interface CalendarAvailabilitySlot { start: string; end: string; timeZone: string; }
export interface CalendarEvent { id: string; subject: string; start: string; end: string; timeZone: string; joinUrl?: string; }
export interface CreateCalendarMeetingRequest { subject: string; start: Date; end: Date; timeZone: string; attendeeAddresses: string[]; idempotencyKey: string; bodyHtml?: string; }
export interface UpdateCalendarMeetingRequest { subject?: string; start?: Date; end?: Date; timeZone?: string; }

export interface ICalendarProvider extends IOutreachProvider {
  readonly channel: 'calendar';
  getAvailability(ctx: TenantContext, request: CalendarAvailabilityRequest): Promise<CalendarAvailabilitySlot[]>;
  getEvent(ctx: TenantContext, eventId: string): Promise<CalendarEvent | null>;
  createMeeting(ctx: TenantContext, request: CreateCalendarMeetingRequest): Promise<CalendarEvent>;
  updateMeeting(ctx: TenantContext, eventId: string, request: UpdateCalendarMeetingRequest): Promise<CalendarEvent>;
  cancelMeeting(ctx: TenantContext, eventId: string): Promise<void>;
}
