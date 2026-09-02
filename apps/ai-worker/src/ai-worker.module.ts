import { Module } from '@nestjs/common';

/**
 * AI Execution Worker host.
 * Wires the custom agent runtime, Control Plane client, Tool Gateway client,
 * and LLM Gateway client while preserving all architectural boundaries.
 */
@Module({
  imports: [],
  providers: [],
})
export class AiWorkerModule {}
