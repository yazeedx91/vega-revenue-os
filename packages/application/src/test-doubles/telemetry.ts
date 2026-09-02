import type { ITelemetry } from '@projectx/infrastructure';

export class NoOpTelemetry implements ITelemetry {
  async span<T>(_name: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  increment(_name: string, _value?: number, _tags?: Record<string, string>): void {
    // no-op
  }

  histogram(_name: string, _value: number, _tags?: Record<string, string>): void {
    // no-op
  }

  log(
    _level: 'debug' | 'info' | 'warn' | 'error',
    _message: string,
    _meta?: Record<string, unknown>,
  ): void {
    // no-op
  }
}
