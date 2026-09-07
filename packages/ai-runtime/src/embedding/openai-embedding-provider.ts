import type {
  EmbeddingProviderConfig,
  EmbeddingRequest,
  EmbeddingResult,
  IEmbeddingProvider,
} from './embedding-provider.interface';
import { EmbeddingProviderError } from './embedding-provider.interface';
import { buildVectorSpace } from './embedding-profile';

/**
 * OpenAI embeddings provider. It declares the exact vector spaces it can serve
 * (one per configured model/version/dimension) and refuses to serve any other
 * profile — the router relies on `servesVectorSpace` for exact-profile pinning.
 */
export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  readonly providerId: string;

  /**
   * The set of exact vector spaces this provider can serve. Each entry is a
   * canonical `provider:model:version:dimensions:metric` identity.
   */
  private readonly servedVectorSpaces: ReadonlySet<string>;

  constructor(
    private readonly config: EmbeddingProviderConfig,
    servedModels: readonly { modelId: string; modelVersion: string; dimensions: number; distanceMetric?: string }[],
  ) {
    this.providerId = config.providerId;
    this.servedVectorSpaces = new Set(
      servedModels.map((m) =>
        buildVectorSpace({
          providerId: this.providerId,
          modelId: m.modelId,
          modelVersion: m.modelVersion,
          dimensions: m.dimensions,
          distanceMetric: m.distanceMetric ?? 'cosine',
        }),
      ),
    );
  }

  servesVectorSpace(vectorSpace: string): boolean {
    return this.servedVectorSpaces.has(vectorSpace);
  }

  async checkReadiness(): Promise<void> {
    try {
      await this.config.secretProvider.getSecret(this.config.secretName);
    } catch (err) {
      throw new EmbeddingProviderError(
        `OpenAI embedding provider not ready: secret ${this.config.secretName} unavailable`,
        this.providerId,
        'MISSING_SECRET',
        false,
        err,
      );
    }
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const startedAt = new Date();
    const profile = request.profile;

    if (!this.servesVectorSpace(profile.vectorSpace)) {
      throw new EmbeddingProviderError(
        `OpenAI embedding provider does not serve vector space ${profile.vectorSpace}`,
        this.providerId,
        'VECTOR_SPACE_NOT_SERVED',
        false,
      );
    }
    if (request.deadline && startedAt > request.deadline) {
      throw new EmbeddingProviderError(
        'OpenAI embedding request deadline has already passed',
        this.providerId,
        'DEADLINE_EXCEEDED',
        false,
      );
    }

    let apiKey: string;
    try {
      apiKey = await this.config.secretProvider.getSecret(this.config.secretName);
    } catch (err) {
      throw new EmbeddingProviderError(
        `OpenAI embedding secret unavailable: ${this.config.secretName}`,
        this.providerId,
        'MISSING_SECRET',
        false,
        err,
      );
    }

    const body = {
      model: profile.modelId,
      input: request.texts.slice(),
      dimensions: profile.dimensions,
    };

    const url = `${this.config.baseUrl.replace(/\/$/, '')}/v1/embeddings`;
    const timeoutMs = request.deadline
      ? Math.max(0, request.deadline.getTime() - startedAt.getTime())
      : this.config.timeoutMs ?? 60_000;

    let response: Response;
    try {
      const fetchImpl = this.config.fetchImpl ?? fetch;
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: request.abortSignal ?? (timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined),
      });
    } catch (err) {
      throw new EmbeddingProviderError(
        `OpenAI embedding request failed: ${err instanceof Error ? err.message : String(err)}`,
        this.providerId,
        'TIMEOUT',
        true,
        err,
        true,
      );
    }

    const completedAt = new Date();
    const latencyMs = completedAt.getTime() - startedAt.getTime();

    if (!response.ok) {
      const status = response.status;
      const text = await response.text().catch(() => 'unknown');
      const { retryable, code } = this.classifyHttpError(status);
      throw new EmbeddingProviderError(
        `OpenAI embeddings returned ${status}: ${text}`,
        this.providerId,
        code,
        retryable,
        undefined,
        true,
      );
    }

    const json = (await response.json()) as Record<string, unknown>;
    const providerRequestId = (json.id as string) ?? undefined;
    const data = (json.data as Array<Record<string, unknown>>) ?? [];
    const vectors = data
      .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
      .map((d) => (d.embedding as number[]) ?? []);
    const usage = (json.usage as Record<string, number>) ?? {};
    const inputTokens = Math.floor(usage.prompt_tokens ?? usage.total_tokens ?? 0);

    return {
      providerId: this.providerId,
      modelId: profile.modelId,
      modelVersion: profile.modelVersion,
      embeddingProfileId: profile.embeddingProfileId,
      vectorSpace: profile.vectorSpace,
      vectors,
      dimensions: profile.dimensions,
      inputTokens,
      latencyMs,
      providerRequestId,
      startedAt,
      completedAt,
    };
  }

  private classifyHttpError(status: number): { retryable: boolean; code: string } {
    if (status === 429) return { retryable: true, code: 'RATE_LIMIT' };
    if (status >= 500) return { retryable: true, code: 'PROVIDER_ERROR' };
    if (status === 401 || status === 403) return { retryable: false, code: 'AUTH' };
    if (status >= 400 && status < 500) return { retryable: false, code: 'BAD_REQUEST' };
    return { retryable: true, code: 'UNKNOWN' };
  }
}
