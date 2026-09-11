import { createHash } from 'crypto';
import type { ProviderHealth, ProviderSendRequest, ProviderSendResult, TenantContext } from '@projectx/domain';
import type { ISecretsProvider, ITokenProvider } from '@projectx/infrastructure';
import { MsalTokenProvider } from '@projectx/infrastructure';
import type { CalendarAvailabilityRequest, CalendarAvailabilitySlot, CalendarEvent, CreateCalendarMeetingRequest, ICalendarProvider, UpdateCalendarMeetingRequest } from '../../ports/calendar-provider.interface';
import type { CalendarAuthority, ICalendarAuthorityResolver } from './calendar-authority-resolver';
import type { GraphCalendarEventPayload, GraphCalendarEventResponse, GraphDateTime, IGraphCalendarHttpClient } from './graph-calendar-http-client';

const scopes = ['https://graph.microsoft.com/.default'];

export class CalendarProviderError extends Error {
  constructor(message: string) { super(message); this.name = 'CalendarProviderError'; }
}

export interface CalendarTokenProviderFactory {
  create(config: { tenantId: string; clientId: string; clientSecret: string }): ITokenProvider;
}

export class MsalCalendarTokenProviderFactory implements CalendarTokenProviderFactory {
  create(config: { tenantId: string; clientId: string; clientSecret: string }): ITokenProvider { return new MsalTokenProvider(config); }
}

export interface GraphCalendarProviderConfig {
  authorityResolver: ICalendarAuthorityResolver;
  secretsProvider: ISecretsProvider;
  tokenProviderFactory: CalendarTokenProviderFactory;
  httpClient: IGraphCalendarHttpClient;
}

export class GraphCalendarProvider implements ICalendarProvider {
  readonly providerId = 'graph-calendar';
  readonly channel = 'calendar' as const;
  private readonly created = new Map<string, CalendarEvent>();
  constructor(private readonly config: GraphCalendarProviderConfig) {}

  async getAvailability(ctx: TenantContext, request: CalendarAvailabilityRequest): Promise<CalendarAvailabilitySlot[]> {
    this.validateRange(request.start, request.end);
    const { authority, token } = await this.authorize(ctx);
    const start = this.graphDateTime(request.start, request.timeZone);
    const end = this.graphDateTime(request.end, request.timeZone);
    try {
      return (await this.config.httpClient.getSchedule(token, authority.mailbox, start, end)).map((slot) => ({ start: slot.start.dateTime, end: slot.end.dateTime, timeZone: slot.start.timeZone }));
    } catch { throw new CalendarProviderError('Calendar availability request failed'); }
  }

  async getEvent(ctx: TenantContext, eventId: string): Promise<CalendarEvent | null> {
    this.validateId(eventId);
    const { authority, token } = await this.authorize(ctx);
    try { const event = await this.config.httpClient.getEvent(token, authority.mailbox, authority.calendarId, eventId); return event ? this.mapEvent(event) : null; }
    catch { throw new CalendarProviderError('Calendar event lookup failed'); }
  }

  async createMeeting(ctx: TenantContext, request: CreateCalendarMeetingRequest): Promise<CalendarEvent> {
    this.validateMeeting(request);
    const key = `${ctx.tenantId}:${ctx.workspaceId}:${request.idempotencyKey}`;
    const existing = this.created.get(key);
    if (existing) return existing;
    const { authority, token } = await this.authorize(ctx);
    const payload: GraphCalendarEventPayload = {
      subject: request.subject,
      body: { contentType: 'HTML', content: request.bodyHtml ?? '' },
      start: this.graphDateTime(request.start, request.timeZone),
      end: this.graphDateTime(request.end, request.timeZone),
      attendees: request.attendeeAddresses.map((address) => ({ emailAddress: { address }, type: 'required' })),
      transactionId: createHash('sha256').update(key).digest('hex').slice(0, 32),
    };
    try { const event = this.mapEvent(await this.config.httpClient.createEvent(token, authority.mailbox, authority.calendarId, payload)); this.created.set(key, event); return event; }
    catch { throw new CalendarProviderError('Calendar meeting creation failed'); }
  }

  async updateMeeting(ctx: TenantContext, eventId: string, request: UpdateCalendarMeetingRequest): Promise<CalendarEvent> {
    this.validateId(eventId);
    const { authority, token } = await this.authorize(ctx);
    const payload: GraphCalendarEventPayload = { subject: request.subject };
    if (request.start || request.end) {
      if (!request.start || !request.end || !request.timeZone) throw new CalendarProviderError('Complete start, end, and timezone are required');
      this.validateRange(request.start, request.end);
      payload.start = this.graphDateTime(request.start, request.timeZone);
      payload.end = this.graphDateTime(request.end, request.timeZone);
    }
    try { return this.mapEvent(await this.config.httpClient.updateEvent(token, authority.mailbox, authority.calendarId, eventId, payload)); }
    catch { throw new CalendarProviderError('Calendar meeting update failed'); }
  }

  async cancelMeeting(ctx: TenantContext, eventId: string): Promise<void> {
    this.validateId(eventId);
    const { authority, token } = await this.authorize(ctx);
    try { await this.config.httpClient.deleteEvent(token, authority.mailbox, authority.calendarId, eventId); }
    catch { throw new CalendarProviderError('Calendar meeting cancellation failed'); }
  }

  async send(_ctx: TenantContext, _request: ProviderSendRequest): Promise<ProviderSendResult> {
    return { status: 'FAILED', retryClassification: 'NON_RETRYABLE', providerErrorCode: 'CALENDAR_COMMAND_REQUIRED', providerErrorMessage: 'Use the calendar scheduling command', costUsd: 0 };
  }

  async checkHealth(ctx: TenantContext): Promise<ProviderHealth> {
    try { await this.authorize(ctx); return { healthy: true }; } catch { return { healthy: false, reason: 'Calendar authorization unavailable' }; }
  }

  private async authorize(ctx: TenantContext): Promise<{ authority: CalendarAuthority; token: string }> {
    if (!ctx.workspaceId) throw new CalendarProviderError('Calendar access denied');
    const authority = await this.config.authorityResolver.resolve(ctx);
    if (!authority || authority.tenantId !== ctx.tenantId || authority.workspaceId !== ctx.workspaceId) throw new CalendarProviderError('Calendar access denied');
    try {
      const [clientId, clientSecret] = await Promise.all([this.config.secretsProvider.getSecret(authority.clientIdSecretReference), this.config.secretsProvider.getSecret(authority.clientSecretReference)]);
      const token = await this.config.tokenProviderFactory.create({ tenantId: authority.entraTenantId, clientId, clientSecret }).getAccessToken(scopes);
      if (!token) throw new Error('missing token');
      return { authority, token };
    } catch { throw new CalendarProviderError('Calendar authorization failed'); }
  }

  private graphDateTime(value: Date, timeZone: string): GraphDateTime {
    let parts: Intl.DateTimeFormatPart[];
    try { parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(value); }
    catch { throw new CalendarProviderError('Invalid calendar timezone'); }
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
    return { dateTime: `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`, timeZone };
  }

  private mapEvent(event: GraphCalendarEventResponse): CalendarEvent {
    if (!event.id || !event.start || !event.end) throw new CalendarProviderError('Calendar provider returned an invalid event');
    return { id: event.id, subject: event.subject ?? '', start: event.start.dateTime, end: event.end.dateTime, timeZone: event.start.timeZone, joinUrl: event.onlineMeeting?.joinUrl };
  }
  private validateRange(start: Date, end: Date) { if (!(start instanceof Date) || !(end instanceof Date) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new CalendarProviderError('Invalid calendar time range'); }
  private validateId(value: string) { if (!value || value.length > 512 || !/^[A-Za-z0-9._:@-]+$/.test(value)) throw new CalendarProviderError('Invalid calendar event ID'); }
  private validateMeeting(request: CreateCalendarMeetingRequest) { this.validateRange(request.start, request.end); if (!request.subject.trim() || request.subject.length > 500 || !request.idempotencyKey || request.idempotencyKey.length > 512 || request.attendeeAddresses.length > 100) throw new CalendarProviderError('Invalid calendar meeting request'); this.graphDateTime(request.start, request.timeZone); }
}
