import { metrics, trace } from '@opentelemetry/api';
import type { ITelemetry } from './telemetry.interface';

export interface OpenTelemetryAdapterConfig {
  readonly serviceName?: string;
}

/**
 * ITelemetry adapter backed by the OpenTelemetry API (metrics + traces).
 *
 * This adapter does NOT register an OpenTelemetry SDK; it relies on the
 * application host to register a MeterProvider/TracerProvider. If none is
 * registered, the API returns no-op instruments and telemetry is silently
 * discarded, making this adapter safe to construct even when OTel is not
 * enabled.
 */
export class OpenTelemetryAdapter implements ITelemetry {
  constructor(private readonly config: OpenTelemetryAdapterConfig = {}) {}

  async span<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const tracer = trace.getTracer(this.config.serviceName ?? 'projectx');
    return tracer.startActiveSpan(name, async (span) => {
      try {
        const result = await operation();
        span.setStatus({ code: 1 }); // SpanStatusCode.OK
        return result;
      } catch (err) {
        span.setStatus({ code: 2, message: err instanceof Error ? err.message : 'unknown' }); // SpanStatusCode.ERROR
        span.recordException(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        span.end();
      }
    });
  }

  increment(name: string, value = 1, tags?: Record<string, string>): void {
    const meter = metrics.getMeter(this.config.serviceName ?? 'projectx');
    const counter = meter.createCounter(name);
    counter.add(value, tags);
  }

  histogram(name: string, value: number, tags?: Record<string, string>): void {
    const meter = metrics.getMeter(this.config.serviceName ?? 'projectx');
    const histogram = meter.createHistogram(name);
    histogram.record(value, tags);
  }

  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void {
    // OpenTelemetry Logs API is not yet stable in @opentelemetry/api; emit a
    // structured console line tagged with the OTel service name so logs can
    // be collected by the host's log pipeline.
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        otel: true,
        service: this.config.serviceName ?? 'projectx',
        level,
        message,
        meta,
        timestamp: new Date().toISOString(),
      }),
    );
  }
}
