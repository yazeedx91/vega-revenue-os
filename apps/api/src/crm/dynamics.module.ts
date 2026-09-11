import { Module } from '@nestjs/common';
import type { ISecretsProvider } from '@projectx/infrastructure';
import { DynamicsIntelligenceAdapter, FetchDataverseReadHttpClient, MsalDynamicsTokenProviderFactory, StaticWorkspaceDynamicsAuthorityResolver, type DynamicsAuthority } from '@projectx/intelligence';
import { IdentityModule } from '../identity/identity.module';
import { DynamicsController } from './dynamics.controller';
import { DynamicsQueryService } from './dynamics-query.service';

export const DYNAMICS_QUERY_SERVICE = 'DYNAMICS_QUERY_SERVICE';

function authorities(): DynamicsAuthority[] {
  const raw = process.env.DYNAMICS_AUTHORITIES_JSON;
  if (!raw) return [];
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value)) throw new Error('DYNAMICS_AUTHORITIES_JSON must be an array');
  return value as DynamicsAuthority[];
}

@Module({
  imports: [IdentityModule], controllers: [DynamicsController],
  providers: [{
    provide: DYNAMICS_QUERY_SERVICE,
    useFactory: (secrets: ISecretsProvider) => new DynamicsQueryService(new DynamicsIntelligenceAdapter({ authorityResolver: new StaticWorkspaceDynamicsAuthorityResolver(authorities()), secretsProvider: secrets, tokenProviderFactory: new MsalDynamicsTokenProviderFactory(), httpClient: new FetchDataverseReadHttpClient() })),
    inject: ['SECRETS_PROVIDER'],
  }],
})
export class DynamicsModule {}
