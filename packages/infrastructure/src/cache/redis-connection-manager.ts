import { createClient, type RedisClientType } from 'redis';

export interface RedisConnectionManagerConfig {
  readonly url: string;
}

export class RedisConnectionManager {
  private readonly client: RedisClientType;
  private healthy = false;
  private lastError?: string;

  constructor(config: RedisConnectionManagerConfig) {
    this.client = createClient({ url: config.url }) as unknown as RedisClientType;

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
  }

  getClient(): RedisClientType {
    return this.client;
  }

  async isHealthy(): Promise<boolean> {
    try {
      if (!this.healthy) return false;
      await this.client.ping();
      return true;
    } catch (err) {
      this.healthy = false;
      this.lastError = err instanceof Error ? err.message : 'unknown';
      return false;
    }
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.healthy = true;
  }

  async quit(): Promise<void> {
    try {
      await this.client.quit();
    } catch (err) {
      // Best-effort cleanup; do not throw during shutdown.
    }
    this.healthy = false;
  }

  getLastError(): string | undefined {
    return this.lastError;
  }
}
