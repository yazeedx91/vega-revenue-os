import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { ApprovalModule } from './approval/approval.module';
import { GraphInboundModule } from './graph-inbound/graph-inbound.module';
import { HealthController } from './health.controller';

/**
 * Modular monolith entry point.
 * Bounded contexts (Mission, Agent, Lead, Outreach, Conversation, Meeting, CRM, Governance)
 * will be added as independent NestJS modules in subsequent implementation phases.
 */
@Module({
  imports: [GraphInboundModule, ApprovalModule, AdminModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
