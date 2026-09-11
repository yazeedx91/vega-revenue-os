import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AdminModule } from './admin/admin.module';
import { ApprovalModule } from './approval/approval.module';
import { GraphInboundModule } from './graph-inbound/graph-inbound.module';
import { IdentityModule } from './identity/identity.module';
import { MissionModule } from './mission/mission.module';
import { OperatorApiModule } from './operator/operator-api.module';
import { ApiExceptionFilter } from './shared/api-exception.filter';
import { CalendarModule } from './calendar/calendar.module';
import { DynamicsModule } from './crm/dynamics.module';
import { HealthController } from './health.controller';

/**
 * Modular monolith entry point.
 * Bounded contexts (Mission, Agent, Lead, Outreach, Conversation, Meeting, CRM, Governance)
 * will be added as independent NestJS modules in subsequent implementation phases.
 */
@Module({
  imports: [GraphInboundModule, ApprovalModule, AdminModule, IdentityModule, MissionModule, OperatorApiModule, CalendarModule, DynamicsModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
