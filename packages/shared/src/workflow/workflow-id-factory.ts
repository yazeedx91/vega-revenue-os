/**
 * Centralized, versionable, tenant-safe workflow-ID convention.
 *
 * This factory is intentionally provider-agnostic and domain-free. All
 * call sites that need to address a running Temporal workflow must use these
 * constructors; ad hoc concatenation is prohibited so that workflow identity
 * remains deterministic, tenant-isolated, and auditable across the entire
 * communication lifecycle.
 */
export class WorkflowIdFactory {
  private static readonly VERSION = 'v1';

  static forOutreachSequence(tenantId: string, sequenceId: string): string {
    return `outreach-sequence-${WorkflowIdFactory.VERSION}-${tenantId}-${sequenceId}`;
  }

  static forMission(tenantId: string, missionId: string): string {
    return `mission-${WorkflowIdFactory.VERSION}-${tenantId}-${missionId}`;
  }
}
