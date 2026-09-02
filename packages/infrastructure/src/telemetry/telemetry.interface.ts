export interface ITelemetry {
  span<T>(name: string, operation: () => Promise<T>): Promise<T>;
  increment(name: string, value?: number, tags?: Record<string, string>): void;
  histogram(name: string, value: number, tags?: Record<string, string>): void;
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void;
}
