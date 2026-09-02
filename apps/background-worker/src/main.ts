import { NestFactory } from '@nestjs/core';
import { BackgroundWorkerModule } from './background-worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(BackgroundWorkerModule);
  // Phase 07: wire Service Bus command/event consumers for non-AI background tasks.
  await app.init();
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
