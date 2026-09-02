import { Module } from '@nestjs/common';

/**
 * Generic background worker host.
 * Handles outbound integrations, analytics projections, audit ingestion,
 * and other asynchronous work outside the AI execution path.
 */
@Module({
  imports: [],
  providers: [],
})
export class BackgroundWorkerModule {}
