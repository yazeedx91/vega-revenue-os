import { Module } from '@nestjs/common';

/**
 * Temporal Worker host.
 * Registers mission-orchestration workflows and activities.
 * The concrete Temporal server platform (ACA vs AKS) is a Phase 07 validation item.
 */
@Module({
  imports: [],
  providers: [],
})
export class TemporalWorkerModule {}
