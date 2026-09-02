import type { HealthProbe } from '../health/health';

export interface Shutdownable {
  shutdown(): Promise<void> | void;
}

export interface ProcessLifecycleOptions {
  readonly healthProbe?: HealthProbe;
  readonly drainTimeoutMs?: number;
  readonly onShutdown?: () => Promise<void> | void;
  readonly logger?: (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;
}

export class ProcessLifecycle {
  private readonly shutdownables: Shutdownable[] = [];
  private readonly healthProbe?: HealthProbe;
  private readonly drainTimeoutMs: number;
  private readonly onShutdown?: () => Promise<void> | void;
  private readonly log: (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;
  private isShuttingDown = false;
  private setupCalled = false;

  constructor(options: ProcessLifecycleOptions = {}) {
    this.healthProbe = options.healthProbe;
    this.drainTimeoutMs = options.drainTimeoutMs ?? 30_000;
    this.onShutdown = options.onShutdown;
    this.log = options.logger ?? ((level, message, meta) => console[level](JSON.stringify({ level, message, ...meta, timestamp: new Date().toISOString() })));
  }

  addShutdownable(shutdownable: Shutdownable): this {
    this.shutdownables.push(shutdownable);
    return this;
  }

  start(): void {
    if (this.setupCalled) return;
    this.setupCalled = true;
    process.on('SIGTERM', () => void this.shutdown(0));
    process.on('SIGINT', () => void this.shutdown(0));
  }

  async shutdown(exitCode = 0): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    this.log('info', 'Shutting down: stopping new work and draining in-flight work', { drainTimeoutMs: this.drainTimeoutMs });

    await this.waitForDrain();

    let failed = false;
    for (const shutdownable of [...this.shutdownables].reverse()) {
      try {
        await shutdownable.shutdown();
      } catch (err) {
        failed = true;
        this.log('error', 'Shutdown handler failed', { error: err instanceof Error ? err.message : 'unknown' });
      }
    }

    if (this.onShutdown) {
      try {
        await this.onShutdown();
      } catch (err) {
        failed = true;
        this.log('error', 'Final shutdown hook failed', { error: err instanceof Error ? err.message : 'unknown' });
      }
    }

    if (this.healthProbe) {
      try {
        const report = await this.healthProbe.checkAll();
        this.log('info', 'Final health check', { healthy: report.healthy });
      } catch (err) {
        this.log('warn', 'Health check failed during shutdown', { error: err instanceof Error ? err.message : 'unknown' });
      }
    }

    const finalExitCode = failed ? 1 : exitCode;
    this.log('info', 'Exiting', { exitCode: finalExitCode });
    process.exit(finalExitCode);
  }

  private async waitForDrain(): Promise<void> {
    if (this.drainTimeoutMs <= 0) return;
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, this.drainTimeoutMs);
      timeout.unref?.();
    });
  }
}
