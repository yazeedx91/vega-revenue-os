import type { WorkspaceRole } from './roles';

export interface Membership {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: Date;
}
