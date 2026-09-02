import type { MessageExecutionStatus, OutreachMessageExecution } from '@projectx/domain';
import { ensureSameTenant, type TenantContext } from '@projectx/domain';
import type { OutreachExecutionId, SequenceId } from '@projectx/shared';
import type { IMessageExecutionRepository } from '../ports/outreach-repository.interface';

export class InMemoryMessageExecutionRepository implements IMessageExecutionRepository {
  private readonly store = new Map<string, OutreachMessageExecution>();

  private key(tenantId: string, executionId: string): string {
    return `${tenantId}:${executionId}`;
  }

  async save(ctx: TenantContext, execution: OutreachMessageExecution): Promise<void> {
    ensureSameTenant(ctx, execution.tenantId);
    this.store.set(this.key(ctx.tenantId as string, execution.id as string), execution);
  }

  async load(ctx: TenantContext, executionId: OutreachExecutionId): Promise<OutreachMessageExecution | null> {
    for (const execution of this.store.values()) {
      if (execution.id === executionId) {
        ensureSameTenant(ctx, execution.tenantId);
        return execution;
      }
    }
    return null;
  }

  async findBySequence(ctx: TenantContext, sequenceId: SequenceId): Promise<OutreachMessageExecution[]> {
    const results: OutreachMessageExecution[] = [];
    for (const execution of this.store.values()) {
      if (execution.tenantId === ctx.tenantId && execution.sequenceId === sequenceId) {
        results.push(execution);
      }
    }
    return results;
  }

  async findByIdempotencyKey(ctx: TenantContext, key: string): Promise<OutreachMessageExecution | null> {
    for (const execution of this.store.values()) {
      if (execution.tenantId === ctx.tenantId && execution.idempotencyKey === key) {
        return execution;
      }
    }
    return null;
  }

  async findByProviderMessageId(ctx: TenantContext, providerMessageId: string): Promise<OutreachMessageExecution | null> {
    for (const execution of this.store.values()) {
      if (execution.tenantId === ctx.tenantId && execution.providerMessageId === providerMessageId) {
        return execution;
      }
    }
    return null;
  }

  async findByRecipientAddress(ctx: TenantContext, address: string): Promise<OutreachMessageExecution[]> {
    const results: OutreachMessageExecution[] = [];
    for (const execution of this.store.values()) {
      if (execution.tenantId === ctx.tenantId && execution.recipientAddress === address) {
        results.push(execution);
      }
    }
    return results;
  }

  async findByStatus(ctx: TenantContext, status: MessageExecutionStatus[]): Promise<OutreachMessageExecution[]> {
    const results: OutreachMessageExecution[] = [];
    for (const execution of this.store.values()) {
      if (execution.tenantId === ctx.tenantId && status.includes(execution.status)) {
        results.push(execution);
      }
    }
    return results;
  }
}
