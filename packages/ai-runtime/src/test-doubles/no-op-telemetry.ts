import type { ITelemetry } from '@projectx/infrastructure';

export class NoOpTelemetry implements ITelemetry {
  async span<T>(name: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  increment(_name: string, _value?: number, _tags?: Record<string, string>): void {}

  histogram(_name: string, _value: number, _tags?: Record<string, string>): void {}

  log(_level: 'debug' | 'info' | 'warn' | 'error', _message: string, _meta?: Record<string, unknown>): void {}
}
