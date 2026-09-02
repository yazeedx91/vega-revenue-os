import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ProcessLifecycle } from '@projectx/infrastructure';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);

  const lifecycle = new ProcessLifecycle({
    drainTimeoutMs: Number(process.env.API_GRACEFUL_DRAIN_MS ?? 30_000),
  });
  lifecycle.addShutdownable({
    shutdown: async () => {
      await app.close();
    },
  });
  lifecycle.start();

  await app.listen(port);
  console.log(JSON.stringify({ level: 'info', code: 'API_LISTENING', port }));
}

bootstrap().catch((err) => {
  console.error(JSON.stringify({ level: 'error', code: 'API_BOOTSTRAP_FAILED', error: err instanceof Error ? err.message : 'unknown' }));
  process.exit(1);
});
