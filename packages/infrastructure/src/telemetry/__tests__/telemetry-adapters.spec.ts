import { ConsoleTelemetry } from '../console-telemetry';
import { NoOpTelemetry } from '../noop-telemetry';
import { OpenTelemetryAdapter } from '../open-telemetry-adapter';

describe('telemetry adapters', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('NoOpTelemetry', () => {
    it('does not throw and does not emit output', async () => {
      const telemetry = new NoOpTelemetry();
      const result = await telemetry.span('noop_span', async () => 'value');
      telemetry.increment('counter');
      telemetry.histogram('histogram', 42);
      telemetry.log('info', 'message');
      expect(result).toBe('value');
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('ConsoleTelemetry', () => {
    it('logs sanitized metric and log lines', async () => {
      const telemetry = new ConsoleTelemetry({ serviceName: 'test' });
      const result = await telemetry.span('test_span', async () => 'value');
      telemetry.increment('counter', 1, { tenantId: 't1' });
      telemetry.histogram('latency_ms', 12, { missionId: 'm1' });
      telemetry.log('info', 'hello', { tenantId: 't1', secret: 'should-not-appear' });

      expect(result).toBe('value');
      const output = consoleSpy.mock.calls.map((call: unknown[]) => call[0]).join('');
      expect(output).toContain('test_span');
      expect(output).toContain('counter');
      expect(output).toContain('latency_ms');
      expect(output).toContain('hello');
      expect(output).toContain('tenantId');
      expect(output).not.toContain('should-not-appear');
      expect(output).toContain('[REDACTED]');
    });
  });

  describe('OpenTelemetryAdapter', () => {
    it('wraps operations and records metrics without throwing', async () => {
      const telemetry = new OpenTelemetryAdapter({ serviceName: 'test' });
      const result = await telemetry.span('otel_span', async () => 'otel-value');
      telemetry.increment('otel_counter', 1, { tenantId: 't1' });
      telemetry.histogram('otel_latency_ms', 5, { sequenceId: 's1' });
      telemetry.log('warn', 'caution', { executionId: 'e1' });
      expect(result).toBe('otel-value');
    });
  });
});
