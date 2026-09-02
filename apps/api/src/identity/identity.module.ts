import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { asTenantId } from '@projectx/shared';
import { ConsoleTelemetry } from '@projectx/infrastructure';
import { PostgresAuditLog } from '@projectx/infrastructure';
import { AzureKeyVaultSecretsProvider, EnvironmentSecretsProvider } from '@projectx/infrastructure';
import type { ISecretsProvider, ITelemetry, IAuditLog } from '@projectx/infrastructure';
import {
  AuthService,
  WorkspaceService,
  PostgresIdentityRepository,
  EntraOidcProvider,
  HmacTokenIssuer,
  FakeOidcProvider,
} from '@projectx/identity';
import { AuthController } from './auth.controller';
import { WorkspaceController } from './workspace.controller';
import { JwtAuthGuard, TenantGuard, PermissionsGuard } from './auth.guard';

async function resolveSecret(
  secrets: ISecretsProvider,
  envValue: string | undefined,
  secretReference: string | undefined,
): Promise<string | undefined> {
  if (envValue) return envValue;
  if (secretReference) {
    try {
      return await secrets.getSecret(secretReference);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

@Module({
  controllers: [AuthController, WorkspaceController],
  providers: [
    {
      provide: 'AUTH_SERVICE',
      useFactory: async (
        secrets: ISecretsProvider,
        audit: IAuditLog,
        telemetry: ITelemetry,
      ) => {
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        const repository = new PostgresIdentityRepository({ pool });

        const tokenSecret = (await resolveSecret(
          secrets,
          process.env.IDENTITY_TOKEN_SECRET,
          process.env.IDENTITY_TOKEN_SECRET_REFERENCE,
        )) ?? 'dev-token-secret-do-not-use-in-production';
        const tokenIssuer = new HmacTokenIssuer({
          secret: tokenSecret,
          issuer: process.env.IDENTITY_TOKEN_ISSUER ?? 'projectx',
          audience: process.env.IDENTITY_TOKEN_AUDIENCE ?? 'projectx-api',
        });

        const providerMode = process.env.IDENTITY_PROVIDER ?? 'entra';
        let identityProvider;
        if (providerMode === 'fake') {
          // E2E-only fake provider. Production composition must use entra.
          identityProvider = new FakeOidcProvider({
            email: process.env.FAKE_OIDC_EMAIL ?? 'e2e@projectx.test',
            name: process.env.FAKE_OIDC_NAME ?? 'E2E User',
            userId: process.env.FAKE_OIDC_USER_ID ?? '00000000-0000-0000-0000-000000000001',
            tenantId: process.env.FAKE_OIDC_TENANT_ID ?? '00000000-0000-0000-0000-000000000001',
            workspaceId: process.env.FAKE_OIDC_WORKSPACE_ID ?? '',
            roles: ['MEMBER'],
            permissions: ['workspace:read'],
          });
        } else {
          const jwksJson = await resolveSecret(
            secrets,
            process.env.ENTRA_JWKS,
            process.env.ENTRA_JWKS_SECRET_REFERENCE,
          );
          identityProvider = new EntraOidcProvider({
            issuer: process.env.ENTRA_ISSUER ?? '',
            clientId: process.env.ENTRA_CLIENT_ID ?? '',
            jwks: jwksJson ? (JSON.parse(jwksJson) as unknown[]) : [],
            allowedTenantId: asTenantId(process.env.ENTRA_ALLOWED_TENANT_ID ?? 'none'),
          });
        }

        return new AuthService({
          identityProvider,
          tokenIssuer,
          repository,
          audit,
          telemetry,
        });
      },
      inject: ['SECRETS_PROVIDER', 'AUDIT_LOG', 'TELEMETRY'],
    },
    {
      provide: 'WORKSPACE_SERVICE',
      useFactory: (audit: IAuditLog, telemetry: ITelemetry) => {
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        const repository = new PostgresIdentityRepository({ pool });
        return new WorkspaceService({ repository, audit, telemetry });
      },
      inject: ['AUDIT_LOG', 'TELEMETRY'],
    },
    {
      provide: 'SECRETS_PROVIDER',
      useFactory: () => {
        const vaultUrl = process.env.AZURE_KEY_VAULT_URL;
        if (vaultUrl) {
          return new AzureKeyVaultSecretsProvider({ vaultUrl });
        }
        return new EnvironmentSecretsProvider();
      },
    },
    {
      provide: 'TELEMETRY',
      useFactory: () => {
        return new ConsoleTelemetry({ serviceName: 'projectx-api' });
      },
    },
    {
      provide: 'AUDIT_LOG',
      useFactory: () => {
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        return new PostgresAuditLog({ pool });
      },
    },
    JwtAuthGuard,
    TenantGuard,
    PermissionsGuard,
  ],
})
export class IdentityModule {}
