import type { TenantContext } from '@projectx/domain';
import type { IMessageExecutionRepository, OutreachRepositoryContext } from '../ports/outreach-repository.interface';

export interface ReconciliationExecutionView {
  readonly executionId: string;
  readonly tenantId: string;
  readonly campaignId: string;
  readonly sequenceId: string;
  readonly stepNumber: number;
  readonly recipientFingerprint?: string;
  readonly channel: string;
  readonly idempotencyKey: string;
  readonly status: string;
  readonly providerId?: string;
  readonly providerMessageId?: string;
  readonly internetMessageId?: string;
  readonly lastError?: string;
  readonly attempts: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class ReconciliationQueryService {
  constructor(private readonly executionRepository: IMessageExecutionRepository) {}

  async findUnknownOrRequiresReconciliation(ctx: OutreachRepositoryContext): Promise<ReconciliationExecutionView[]> {
    const executions = await this.executionRepository.findByStatus(ctx, ['DELIVERY_UNKNOWN', 'REQUIRES_RECONCILIATION']);
    return executions.map((execution) => ({
      executionId: execution.id as string,
      tenantId: execution.tenantId as string,
      campaignId: execution.campaignId as string,
      sequenceId: execution.sequenceId as string,
      stepNumber: execution.stepNumber,
      recipientFingerprint: execution.recipientFingerprint,
      channel: execution.channel,
      idempotencyKey: execution.idempotencyKey as string,
      status: execution.status,
      providerId: execution.providerId,
      providerMessageId: execution.providerMessageId,
      internetMessageId: execution.internetMessageId,
      lastError: execution.lastError,
      attempts: execution.attempts,
      createdAt: execution.createdAt,
      updatedAt: execution.updatedAt,
    }));
  }
}
