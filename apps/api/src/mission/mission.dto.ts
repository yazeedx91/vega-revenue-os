export class CreateMissionDto {
  name!: string;
  objective!: string;
  icpId!: string;
  territory?: string[];
  channels?: string[];
  budget?: Record<string, unknown>;
  autonomyLevel?: number;
  constraints?: Record<string, unknown>;
  successCriteria?: Record<string, unknown>;
  deadline?: string;
}
