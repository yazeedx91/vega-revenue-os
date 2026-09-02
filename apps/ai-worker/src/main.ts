import { NestFactory } from '@nestjs/core';
import { AiWorkerModule } from './ai-worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AiWorkerModule);
  // Phase 07: wire consumer that polls Service Bus for AI execution commands.
  await app.init();
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
