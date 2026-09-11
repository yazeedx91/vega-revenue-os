import type { TenantContext } from '@projectx/domain';

export interface CalendarAuthority {
  tenantId: string;
  workspaceId: string;
  mailbox: string;
  calendarId?: string;
  entraTenantId: string;
  clientIdSecretReference: string;
  clientSecretReference: string;
}

export interface ICalendarAuthorityResolver {
  resolve(ctx: TenantContext): Promise<CalendarAuthority | null>;
}

export class StaticWorkspaceCalendarAuthorityResolver implements ICalendarAuthorityResolver {
  private readonly authorities = new Map<string, CalendarAuthority>();
  constructor(authorities: CalendarAuthority[]) {
    for (const authority of authorities) this.authorities.set(`${authority.tenantId}:${authority.workspaceId}`, authority);
  }
  async resolve(ctx: TenantContext): Promise<CalendarAuthority | null> {
    if (!ctx.workspaceId) return null;
    return this.authorities.get(`${ctx.tenantId}:${ctx.workspaceId}`) ?? null;
  }
}
