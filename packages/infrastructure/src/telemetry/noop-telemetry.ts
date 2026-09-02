import type { ITelemetry } from './telemetry.interface';

/**
 * No-op telemetry adapter. Used in unit tests and any context where telemetry
 * emission should be silently discarded.
 */
export class NoOpTelemetry implements ITelemetry {
  async span<T>(_name: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  increment(_name: string, _value?: number, _tags?: Record<string, string>): void {}

  histogram(_name: string, _value: number, _tags?: Record<string, string>): void {}

  log(_level: 'debug' | 'info' | 'warn' | 'error', _message: string, _meta?: Record<string, unknown>): void {}
}
