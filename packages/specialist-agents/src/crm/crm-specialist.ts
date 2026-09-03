import { BaseSpecialist } from '../base-specialist';
import type { AgentImplementationRuntime } from '@projectx/ai-runtime';
import type { AIExecutionRequest, ExecutionOutcome } from '@projectx/shared';

export interface CrmRequest {
  readonly operation: 'contact_update' | 'activity_log' | 'sync';
  readonly contact?: { id?: string; email?: string; company?: string };
  readonly activity?: { type: string; summary?: string };
}

export class CrmSpecialist extends BaseSpecialist {
  readonly implementationKey = 'specialist.crm.v1' as const;
  readonly capabilities = ['crm_sync', 'contact_update', 'activity_logging'] as const;
  readonly riskCategory = 'crm';

  protected async executeCore(request: AIExecutionRequest, _runtime: AgentImplementationRuntime): Promise<ExecutionOutcome> {
    const target = (request.context.target ?? {}) as unknown as CrmRequest;
    if (!target.operation) {
      throw new Error('CRM operation is required');
    }

    const changes: unknown[] = [];
    if (target.operation === 'contact_update' && target.contact) {
      changes.push({ type: 'contact', contact: target.contact });
    }
    if (target.operation === 'activity_log' && target.activity) {
      if (!target.activity.type) throw new Error('Activity type is required for activity logging');
      changes.push({ type: 'activity', activity: target.activity });
    }

    return {
      summary: `CRM ${target.operation} prepared with ${changes.length} change(s). Real Dynamics/CRM integration is read-only and deferred to Slice 13.`,
      decisions: [{ operation: target.operation, changeCount: changes.length }],
      actions: [
        { type: 'prepare_crm_operation', operation: target.operation },
        { type: 'request_tool', toolCategory: 'crm', slice: 13 },
      ],
      evidence: changes,
    };
  }
}

