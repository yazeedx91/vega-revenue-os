import type { ITelemetry } from './telemetry.interface';

export interface ConsoleTelemetryConfig {
  readonly serviceName?: string;
}

/**
 * Deterministic development/test telemetry adapter that emits sanitized
 * metrics, histograms, and log lines to stdout. No external collector is
 * required, so unit tests remain hermetic.
 */
export class ConsoleTelemetry implements ITelemetry {
  constructor(private readonly config: ConsoleTelemetryConfig = {}) {}

  async span<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await operation();
      const durationMs = Date.now() - startedAt;
      this.emit('span_complete', { name, durationMs, outcome: 'success' });
      return result;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      this.emit('span_complete', {
        name,
        durationMs,
        outcome: 'error',
        error: err instanceof Error ? err.message : 'unknown',
      });
      throw err;
    }
  }

  increment(name: string, value = 1, tags?: Record<string, string>): void {
    this.emit('counter', { name, value, tags });
  }

  histogram(name: string, value: number, tags?: Record<string, string>): void {
    this.emit('histogram', { name, value, tags });
  }

  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void {
    this.emit('log', { level, message, meta: meta ? sanitizeMeta(meta) : undefined });
  }

  private emit(type: string, payload: Record<string, unknown>): void {
    const record = {
      type,
      service: this.config.serviceName ?? 'projectx',
      timestamp: new Date().toISOString(),
      ...payload,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(record));
  }
}

const SENSITIVE_KEY_PATTERNS = [/secret/i, /token/i, /password/i, /credential/i, /key$/i, /auth/i, /api.?key/i];

function sanitizeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
