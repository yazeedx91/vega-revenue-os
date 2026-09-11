import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { GraphCalendarProvider } from '@projectx/outreach';
import { asCorrelationId } from '@projectx/shared';
import { CurrentUser, JwtAuthGuard, PermissionsGuard, RequirePermissions, TenantGuard, type RequestUser } from '../identity/auth.guard';
import { ResourceIdPipe } from '../operator/resource-id.pipe';
import { CALENDAR_PROVIDER } from './calendar.module';

@Controller('calendar')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermissions('workspace:read')
export class CalendarController {
  constructor(@Inject(CALENDAR_PROVIDER) private readonly calendar: GraphCalendarProvider) {}

  @Get('availability')
  availability(@CurrentUser() user: RequestUser, @Query('start') start: string, @Query('end') end: string, @Query('timeZone') timeZone: string) {
    return this.calendar.getAvailability(this.ctx(user), { start: this.date(start), end: this.date(end), timeZone: this.text(timeZone, 100) });
  }

  @Get('events/:id')
  event(@CurrentUser() user: RequestUser, @Param('id', ResourceIdPipe) id: string) { return this.calendar.getEvent(this.ctx(user), id); }

  @RequirePermissions('mission:execute')
  @Post('events')
  create(@CurrentUser() user: RequestUser, @Body() body: any) {
    return this.calendar.createMeeting(this.ctx(user), { subject: this.text(body.subject, 500), start: this.date(body.start), end: this.date(body.end), timeZone: this.text(body.timeZone, 100), attendeeAddresses: this.attendees(body.attendeeAddresses), idempotencyKey: this.text(body.idempotencyKey, 512), bodyHtml: typeof body.bodyHtml === 'string' ? this.text(body.bodyHtml, 20_000) : undefined });
  }

  @RequirePermissions('mission:execute')
  @Patch('events/:id')
  update(@CurrentUser() user: RequestUser, @Param('id', ResourceIdPipe) id: string, @Body() body: any) {
    return this.calendar.updateMeeting(this.ctx(user), id, { subject: body.subject === undefined ? undefined : this.text(body.subject, 500), start: body.start === undefined ? undefined : this.date(body.start), end: body.end === undefined ? undefined : this.date(body.end), timeZone: body.timeZone === undefined ? undefined : this.text(body.timeZone, 100) });
  }

  @RequirePermissions('mission:cancel')
  @Delete('events/:id')
  async cancel(@CurrentUser() user: RequestUser, @Param('id', ResourceIdPipe) id: string) { await this.calendar.cancelMeeting(this.ctx(user), id); return { status: 'CANCELLED' }; }

  private ctx(user: RequestUser) { return { tenantId: user.tenantId, workspaceId: user.workspaceId, userId: user.userId, correlationId: asCorrelationId(`calendar:${user.userId}`) }; }
  private date(value: unknown): Date { const date = typeof value === 'string' ? new Date(value) : new Date(Number.NaN); if (!Number.isFinite(date.getTime())) throw new BadRequestException('Invalid date'); return date; }
  private text(value: unknown, max: number): string { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new BadRequestException('Invalid calendar request'); return value.trim(); }
  private attendees(value: unknown): string[] { if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== 'string' || item.length > 320 || !item.includes('@'))) throw new BadRequestException('Invalid attendees'); return value; }
}
