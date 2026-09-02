import type { TenantId } from '../types/tenant-id';
import type { TaskContract } from './task-contract';

/**
 * Mission and plan contract.
 * Aligned with docs/technology/18-mission-contract.md.
 */
export interface MissionContract {
  missionId: string;
  tenantId: TenantId;
  name: string;
  objective: string;
  icpId: string;
  territory: string[];
  channels: string[];
  budget: MissionBudget;
  autonomyLevel: number;
  constraints: MissionConstraints;
  successCriteria: MissionSuccessCriteria;
  deadline?: Date;
  ownerUserId: string;
  status: MissionStatus;
  plan: PlanContract;
  tasks: TaskContract[];
  approvals: unknown[];
  outcomes: MissionOutcomes;
  createdAt: Date;
  updatedAt: Date;
}

export interface MissionBudget {
  maxAiCostUsd: number;
  maxOutreachCount?: number;
}

export interface MissionConstraints {
  workingHours?: string;
  noContactDomains?: string[];
  minimumCompanySize?: number;
}

export interface MissionSuccessCriteria {
  targetMeetings?: number;
  targetOpportunities?: number;
}

export type MissionStatus =
  | 'DRAFT'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PLANNING'
  | 'EXECUTING'
  | 'PAUSED'
  | 'AWAITING_APPROVAL'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'ARCHIVED';

export interface PlanContract {
  planId: string;
  missionId: string;
  version: number;
  objectives: unknown[];
  phases: PlanPhase[];
  approvalGates: unknown[];
  fallbackBranches: unknown[];
}

export interface PlanPhase {
  phaseId: string;
  name: string;
  tasks: TaskContract[];
  approvalGate?: unknown;
  fallback?: unknown;
}

export interface MissionOutcomes {
  meetingsBooked?: number;
  opportunitiesCreated?: number;
}
