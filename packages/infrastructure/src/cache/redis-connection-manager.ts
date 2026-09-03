import type { RedisClientType } from 'redis';

export interface RedisConnectionManagerConfig {
  readonly url: string;
}

export class RedisConnectionManager {
  private client?: RedisClientType;
  private healthy = false;
  private lastError?: string;

  constructor(private readonly config: RedisConnectionManagerConfig) {}

  getClient(): RedisClientType {
    if (!this.client) {
      throw new Error('Redis client has not been connected yet');
    }
    return this.client;
  }

  async isHealthy(): Promise<boolean> {
    try {
      if (!this.healthy || !this.client) return false;
      await this.client.ping();
      return true;
    } catch (err) {
      this.healthy = false;
      this.lastError = err instanceof Error ? err.message : 'unknown';
      return false;
    }
  }

  async connect(): Promise<void> {
    const { createClient } = await import('redis');
    this.client = createClient({ url: this.config.url }) as unknown as RedisClientType;

    this.client.on('connect', () => {
      this.healthy = true;
      this.lastError = undefined;
    });

    this.client.on('ready', () => {
      this.healthy = true;
      this.lastError = undefined;
    });

    this.client.on('error', (err: Error) => {
      this.healthy = false;
      this.lastError = err.message;
    });

    this.client.on('end', () => {
      this.healthy = false;
    });

    this.client.on('reconnecting', () => {
      this.healthy = false;
    });

    await this.client.connect();
    this.healthy = true;
  }

  async quit(): Promise<void> {
    try {
      await this.client?.quit();
    } catch (err) {
      // Best-effort cleanup; do not throw during shutdown.
    }
    this.healthy = false;
  }

  getLastError(): string | undefined {
    return this.lastError;
  }
}
