/**
 * Re-export the real `@temporalio/client`-backed adapter from the canonical
 * home in `packages/temporal-client` (ADR-127). Preserves the local import
 * path used by existing tests while ensuring `apps/temporal-worker` and
 * `apps/api` share the same implementation.
 */
export { TemporalSignalDispatcher, type TemporalWorkflowClientConfig as TemporalSignalDispatcherConfig } from '@projectx/temporal-client';
