export interface GraphDateTime { dateTime: string; timeZone: string; }
export interface GraphCalendarEventPayload { subject?: string; body?: { contentType: 'HTML'; content: string }; start?: GraphDateTime; end?: GraphDateTime; attendees?: Array<{ emailAddress: { address: string }; type: 'required' }>; transactionId?: string; }
export interface GraphCalendarEventResponse { id: string; subject?: string; start?: GraphDateTime; end?: GraphDateTime; onlineMeeting?: { joinUrl?: string }; }

export class GraphCalendarHttpError extends Error {
  constructor(readonly status: number) { super('Microsoft Graph calendar request failed'); this.name = 'GraphCalendarHttpError'; }
}

export interface IGraphCalendarHttpClient {
  getSchedule(token: string, mailbox: string, start: GraphDateTime, end: GraphDateTime): Promise<Array<{ start: GraphDateTime; end: GraphDateTime }>>;
  getEvent(token: string, mailbox: string, calendarId: string | undefined, eventId: string): Promise<GraphCalendarEventResponse | null>;
  createEvent(token: string, mailbox: string, calendarId: string | undefined, payload: GraphCalendarEventPayload): Promise<GraphCalendarEventResponse>;
  updateEvent(token: string, mailbox: string, calendarId: string | undefined, eventId: string, payload: GraphCalendarEventPayload): Promise<GraphCalendarEventResponse>;
  deleteEvent(token: string, mailbox: string, calendarId: string | undefined, eventId: string): Promise<void>;
}

export class FetchGraphCalendarHttpClient implements IGraphCalendarHttpClient {
  constructor(private readonly baseUrl = 'https://graph.microsoft.com/v1.0', private readonly fetchFn: typeof fetch = fetch) {}
  async getSchedule(token: string, mailbox: string, start: GraphDateTime, end: GraphDateTime) {
    const response = await this.request(token, `/users/${encodeURIComponent(mailbox)}/calendar/getSchedule`, { method: 'POST', body: JSON.stringify({ schedules: [mailbox], startTime: start, endTime: end, availabilityViewInterval: 30 }) });
    const body = await response!.json() as { value?: Array<{ scheduleItems?: Array<{ start: GraphDateTime; end: GraphDateTime }> }> };
    return body.value?.[0]?.scheduleItems ?? [];
  }
  async getEvent(token: string, mailbox: string, calendarId: string | undefined, eventId: string) {
    const response = await this.request(token, this.eventPath(mailbox, calendarId, eventId), { method: 'GET' }, true);
    return response ? await response!.json() as GraphCalendarEventResponse : null;
  }
  async createEvent(token: string, mailbox: string, calendarId: string | undefined, payload: GraphCalendarEventPayload) {
    const response = await this.request(token, this.eventsPath(mailbox, calendarId), { method: 'POST', body: JSON.stringify(payload) });
    return response!.json() as Promise<GraphCalendarEventResponse>;
  }
  async updateEvent(token: string, mailbox: string, calendarId: string | undefined, eventId: string, payload: GraphCalendarEventPayload) {
    const response = await this.request(token, this.eventPath(mailbox, calendarId, eventId), { method: 'PATCH', body: JSON.stringify(payload) });
    return response!.json() as Promise<GraphCalendarEventResponse>;
  }
  async deleteEvent(token: string, mailbox: string, calendarId: string | undefined, eventId: string) { await this.request(token, this.eventPath(mailbox, calendarId, eventId), { method: 'DELETE' }); }
  private eventsPath(mailbox: string, calendarId?: string) { return calendarId ? `/users/${encodeURIComponent(mailbox)}/calendars/${encodeURIComponent(calendarId)}/events` : `/users/${encodeURIComponent(mailbox)}/events`; }
  private eventPath(mailbox: string, calendarId: string | undefined, eventId: string) { return `${this.eventsPath(mailbox, calendarId)}/${encodeURIComponent(eventId)}`; }
  private async request(token: string, path: string, init: RequestInit, allowNotFound = false): Promise<Response | null> {
    let response: Response;
    try { response = await this.fetchFn(`${this.baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }); }
    catch { throw new GraphCalendarHttpError(503); }
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) throw new GraphCalendarHttpError(response.status);
    return response;
  }
}
