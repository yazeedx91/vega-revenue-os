import { Module } from '@nestjs/common';
import type { ISecretsProvider } from '@projectx/infrastructure';
import { FetchGraphCalendarHttpClient, GraphCalendarProvider, MsalCalendarTokenProviderFactory, StaticWorkspaceCalendarAuthorityResolver, type CalendarAuthority } from '@projectx/outreach';
import { IdentityModule } from '../identity/identity.module';
import { CalendarController } from './calendar.controller';
import { CALENDAR_PROVIDER } from './calendar.constants';

function authorities(): CalendarAuthority[] {
  const raw = process.env.CALENDAR_GRAPH_AUTHORITIES_JSON;
  if (!raw) return [];
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value)) throw new Error('CALENDAR_GRAPH_AUTHORITIES_JSON must be an array');
  return value.map((item: any) => {
    const authority = item as CalendarAuthority;
    if (!authority.tenantId || !authority.workspaceId || !authority.mailbox || !authority.entraTenantId || !authority.clientIdSecretReference || !authority.clientSecretReference) throw new Error('Calendar authority configuration is invalid');
    return authority;
  });
}

@Module({
  imports: [IdentityModule],
  controllers: [CalendarController],
  providers: [{
    provide: CALENDAR_PROVIDER,
    useFactory: (secretsProvider: ISecretsProvider) => new GraphCalendarProvider({
      authorityResolver: new StaticWorkspaceCalendarAuthorityResolver(authorities()),
      secretsProvider,
      tokenProviderFactory: new MsalCalendarTokenProviderFactory(),
      httpClient: new FetchGraphCalendarHttpClient(),
    }),
    inject: ['SECRETS_PROVIDER'],
  }],
})
export class CalendarModule {}
