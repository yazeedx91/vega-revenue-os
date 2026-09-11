import { randomUUID } from 'crypto';
import { asCorrelationId, asTenantId } from '@projectx/shared';
import { FetchGraphCalendarHttpClient } from '../graph-calendar-http-client';
import { GraphCalendarProvider } from '../graph-calendar-provider';
import { StaticWorkspaceCalendarAuthorityResolver } from '../calendar-authority-resolver';

const workspaceA = 'workspace-a';
const ctx = { tenantId: asTenantId('tenant-a'), workspaceId: workspaceA, correlationId: asCorrelationId('calendar-test') };
const accessToken = randomUUID();
const secretValue = randomUUID();
const clientIdReference = randomUUID();
const clientSecretReference = randomUUID();
let createCount = 0;
let forcedStatus = 0;
let lastPath = '';
let lastBody: any;

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function graphFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  lastPath = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname;
  lastBody = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
  const headers = new Headers(init?.headers);
  if (forcedStatus) return json(forcedStatus, { error: { message: 'sensitive provider detail' } });
  if (headers.get('authorization') !== `Bearer ${accessToken}`) return json(401);
  if (lastPath.endsWith('/calendar/getSchedule')) return json(200, { value: [{ scheduleItems: [{ start: { dateTime: '2026-01-15T09:00:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-01-15T10:00:00', timeZone: 'America/New_York' } }] }] });
  if (init?.method === 'DELETE') return json(204);
  if (init?.method === 'GET') return json(200, { id: 'event-1', subject: 'Meeting', start: { dateTime: '2026-01-15T09:00:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-01-15T10:00:00', timeZone: 'America/New_York' } });
  if (init?.method === 'POST') createCount += 1;
  return json(200, { id: 'event-1', subject: lastBody?.subject ?? 'Meeting', start: lastBody?.start ?? { dateTime: '2026-01-15T09:00:00', timeZone: 'America/New_York' }, end: lastBody?.end ?? { dateTime: '2026-01-15T10:00:00', timeZone: 'America/New_York' }, onlineMeeting: { joinUrl: 'https://meeting.example.test/1' } });
}

beforeEach(() => { createCount = 0; forcedStatus = 0; lastBody = undefined; });

function provider(token = accessToken) {
  return new GraphCalendarProvider({
    authorityResolver: new StaticWorkspaceCalendarAuthorityResolver([{ tenantId: 'tenant-a', workspaceId: workspaceA, mailbox: 'calendar-a@example.test', calendarId: 'primary', entraTenantId: 'entra-a', clientIdSecretReference: clientIdReference, clientSecretReference }]),
    secretsProvider: { getSecret: async (name: string) => name === clientIdReference ? randomUUID() : secretValue, getCertificate: async () => Buffer.alloc(0) },
    tokenProviderFactory: { create: () => ({ getAccessToken: async () => token }) },
    httpClient: new FetchGraphCalendarHttpClient('https://graph.test/v1.0', graphFetch as typeof fetch),
  });
}

const meeting = { subject: 'Discovery', start: new Date('2026-01-15T14:00:00Z'), end: new Date('2026-01-15T15:00:00Z'), timeZone: 'America/New_York', attendeeAddresses: ['attendee@example.test'], idempotencyKey: 'meeting-1' };

describe('GraphCalendarProvider deterministic HTTP transport integration', () => {
  it('looks up timezone-correct availability using trusted mailbox authority', async () => {
    const slots = await provider().getAvailability(ctx, { start: meeting.start, end: meeting.end, timeZone: meeting.timeZone });
    expect(slots).toEqual([{ start: '2026-01-15T09:00:00', end: '2026-01-15T10:00:00', timeZone: 'America/New_York' }]);
    expect(lastPath).toContain(encodeURIComponent('calendar-a@example.test'));
    expect(lastBody.startTime).toEqual({ dateTime: '2026-01-15T09:00:00', timeZone: 'America/New_York' });
  });

  it('creates a meeting once for duplicate idempotency keys', async () => {
    const calendar = provider();
    const first = await calendar.createMeeting(ctx, meeting);
    const second = await calendar.createMeeting(ctx, meeting);
    expect(first).toEqual(second);
    expect(createCount).toBe(1);
    expect(lastBody.transactionId).toMatch(/^[a-f0-9]{32}$/);
  });

  it('gets, updates, and cancels an event through Graph', async () => {
    const calendar = provider();
    expect((await calendar.getEvent(ctx, 'event-1'))?.id).toBe('event-1');
    expect((await calendar.updateMeeting(ctx, 'event-1', { subject: 'Updated' })).subject).toBe('Updated');
    await expect(calendar.cancelMeeting(ctx, 'event-1')).resolves.toBeUndefined();
  });

  it('denies cross-workspace and cross-tenant calendar access', async () => {
    await expect(provider().getEvent({ ...ctx, workspaceId: 'workspace-b' }, 'event-1')).rejects.toThrow('Calendar access denied');
    await expect(provider().getEvent({ ...ctx, tenantId: asTenantId('tenant-b') }, 'event-1')).rejects.toThrow('Calendar access denied');
  });

  it('does not accept an arbitrary mailbox override', async () => {
    await provider().getEvent(ctx, 'event-1');
    expect(lastPath).toContain(encodeURIComponent('calendar-a@example.test'));
    expect(lastPath).not.toContain('attacker');
  });

  it('maps invalid tokens and Graph 4xx/5xx to sanitized failures', async () => {
    await expect(provider(randomUUID()).getEvent(ctx, 'event-1')).rejects.toThrow('Calendar event lookup failed');
    forcedStatus = 403;
    await expect(provider().getEvent(ctx, 'event-1')).rejects.toThrow('Calendar event lookup failed');
    forcedStatus = 503;
    await expect(provider().createMeeting(ctx, meeting)).rejects.toThrow('Calendar meeting creation failed');
  });

  it('never exposes secret values or provider response details in errors', async () => {
    forcedStatus = 500;
    const error = await provider().getEvent(ctx, 'event-1').catch((value) => value as Error);
    expect(error.message).not.toContain(secretValue);
    expect(error.message).not.toContain('sensitive provider detail');
  });

  it('fails safely for invalid timezone and malformed event IDs', async () => {
    await expect(provider().createMeeting(ctx, { ...meeting, timeZone: 'Not/AZone' })).rejects.toThrow('Invalid calendar timezone');
    await expect(provider().getEvent(ctx, '../mailbox')).rejects.toThrow('Invalid calendar event ID');
  });
});
