import type { TenantContext } from '@projectx/domain';
import { asTenantId } from '@projectx/shared';
import {
  ValidatedEmbeddingRuntime,
  type EmbeddingRuntimeMode,
  type ResolvedEmbeddingRuntime,
} from '@projectx/ai-runtime';
import {
  PostgresClient,
  EnvironmentSecretsProvider,
  AzureKeyVaultSecretsProvider,
  type ISecretsProvider,
} from '@projectx/infrastructure';

let client: PostgresClient | undefined;
let runtime: ValidatedEmbeddingRuntime | undefined;

const SYSTEM_TENANT = asTenantId('00000000-0000-0000-0000-000000000000');
const SYSTEM_CTX: TenantContext = {
  tenantId: SYSTEM_TENANT,
  correlationId: 'embedding-runtime-startup',
} as TenantContext;

function createDefaultSecretsProvider(isProduction: boolean): ISecretsProvider {
  const vaultUrl = process.env.AZURE_KEY_VAULT_URL;
  if (isProduction) {
    if (!vaultUrl) {
      throw new Error(
        'AZURE_KEY_VAULT_URL is required in production; EnvironmentSecretsProvider is not allowed for embedding.',
      );
    }
    return new AzureKeyVaultSecretsProvider({ vaultUrl });
  }
  return new EnvironmentSecretsProvider();
}

/**
 * Bind the shared Postgres client to the embedding runtime. Must be called
 * before {@link getEmbeddingRouter} or {@link validateEmbeddingRuntime}.
 */
export function setPostgresClient(c: PostgresClient): void {
  client = c;
}

/**
 * The shared embedding router. The registry is populated by
 * {@link validateEmbeddingRuntime}, so callers must validate before any embed
 * request is made.
 */
export function getEmbeddingRouter(): ValidatedEmbeddingRuntime['router'] {
  if (!client) {
    throw new Error('Embedding runtime: setPostgresClient() must be called before getEmbeddingRouter()');
  }
  if (!runtime) {
    runtime = new ValidatedEmbeddingRuntime(client);
  }
  return runtime.router;
}

/**
 * Validate exactly one ACTIVE durable embedding profile, register a matching
 * provider, and fail closed before any mission or API request is served.
 *
 * In production this requires a real OpenAI-compatible provider and a valid
 * secret. In deterministic mode the provider is a local deterministic harness.
 */
export async function validateEmbeddingRuntime(
  mode: EmbeddingRuntimeMode,
  secrets?: ISecretsProvider,
): Promise<ResolvedEmbeddingRuntime> {
  if (!client) {
    throw new Error('Embedding runtime: setPostgresClient() must be called before validateEmbeddingRuntime()');
  }
  if (!runtime) {
    runtime = new ValidatedEmbeddingRuntime(client);
  }

  const isProduction = mode === 'production';
  const providerSecrets = secrets ?? createDefaultSecretsProvider(isProduction);

  return runtime.validate(SYSTEM_CTX, providerSecrets, {
    mode,
    openAiBaseUrl: process.env.OPENAI_BASE_URL,
    openAiSecretName: process.env.OPENAI_EMBEDDING_SECRET_NAME ?? 'openai/api-key',
    openAiTimeoutMs: process.env.OPENAI_EMBEDDING_TIMEOUT_MS
      ? Number(process.env.OPENAI_EMBEDDING_TIMEOUT_MS)
      : undefined,
    fetchImpl: fetch,
  });
}
