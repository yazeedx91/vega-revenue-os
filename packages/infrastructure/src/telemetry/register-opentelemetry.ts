import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';

let sdk: NodeSDK | undefined;

export interface RegisterOpenTelemetryOptions {
  readonly serviceName: string;
  readonly otlpEndpoint?: string;
}

/**
 * Registers a real OpenTelemetry NodeSDK with OTLP HTTP trace and metric
 * exporters. Safe to call multiple times; subsequent calls are no-ops.
 *
 * A failure to start the SDK is logged and swallowed so that telemetry
 * problems can never block a safety-critical persistence action or trigger
 * an outbound resend.
 */
export function registerOpenTelemetry(options: RegisterOpenTelemetryOptions): void {
  if (sdk) {
    return;
  }

  const endpoint = options.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const resource = resourceFromAttributes({ 'service.name': options.serviceName });

  sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({
      url: endpoint ? `${endpoint.replace(/\/$/, '')}/v1/traces` : undefined,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: endpoint ? `${endpoint.replace(/\/$/, '')}/v1/metrics` : undefined,
      }),
      exportIntervalMillis: 60000,
    }),
    instrumentations: [],
  });

  try {
    sdk.start();
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        code: 'OTEL_SDK_START_FAILED',
        error: err instanceof Error ? err.message : 'unknown',
      }),
    );
    sdk = undefined;
  }
}

/**
 * Best-effort shutdown of the registered NodeSDK. Should be called during
 * process graceful shutdown after all safety-critical work has completed.
 */
export async function shutdownOpenTelemetry(): Promise<void> {
  if (!sdk) return;
  const toShutdown = sdk;
  sdk = undefined;
  try {
    await toShutdown.shutdown();
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        code: 'OTEL_SDK_SHUTDOWN_FAILED',
        error: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }
}
