export type MissionId = string & { readonly __brand: 'MissionId' };
export type AgentId = string & { readonly __brand: 'AgentId' };
export type ExecutionId = string & { readonly __brand: 'ExecutionId' };
export type TaskId = string & { readonly __brand: 'TaskId' };
export type CapabilityId = string & { readonly __brand: 'CapabilityId' };
export type PolicyId = string & { readonly __brand: 'PolicyId' };
export type ApprovalId = string & { readonly __brand: 'ApprovalId' };
export type AuditRecordId = string & { readonly __brand: 'AuditRecordId' };
export type UserId = string & { readonly __brand: 'UserId' };
export type ICPProfileId = string & { readonly __brand: 'ICPProfileId' };
export type AccountId = string & { readonly __brand: 'AccountId' };
export type ContactId = string & { readonly __brand: 'ContactId' };
export type LeadId = string & { readonly __brand: 'LeadId' };
export type EvidenceId = string & { readonly __brand: 'EvidenceId' };
export type ResearchRequestId = string & { readonly __brand: 'ResearchRequestId' };
export type CampaignId = string & { readonly __brand: 'CampaignId' };
export type SequenceId = string & { readonly __brand: 'SequenceId' };
export type OutreachMessageId = string & { readonly __brand: 'OutreachMessageId' };
export type OutreachExecutionId = string & { readonly __brand: 'OutreachExecutionId' };
export type ConversationId = string & { readonly __brand: 'ConversationId' };
export type ReplyMessageId = string & { readonly __brand: 'ReplyMessageId' };
export type SignalId = string & { readonly __brand: 'SignalId' };
export type ResearchRunId = string & { readonly __brand: 'ResearchRunId' };
export type ICPProfileVersionId = string & { readonly __brand: 'ICPProfileVersionId' };

export function asMissionId(value: string): MissionId {
  return value as MissionId;
}

export function asAgentId(value: string): AgentId {
  return value as AgentId;
}

export function asExecutionId(value: string): ExecutionId {
  return value as ExecutionId;
}

export function asTaskId(value: string): TaskId {
  return value as TaskId;
}

export function asCapabilityId(value: string): CapabilityId {
  return value as CapabilityId;
}

export function asPolicyId(value: string): PolicyId {
  return value as PolicyId;
}

export function asApprovalId(value: string): ApprovalId {
  return value as ApprovalId;
}

export function asAuditRecordId(value: string): AuditRecordId {
  return value as AuditRecordId;
}

export function asUserId(value: string): UserId {
  return value as UserId;
}

export function asICPProfileId(value: string): ICPProfileId {
  return value as ICPProfileId;
}

export function asAccountId(value: string): AccountId {
  return value as AccountId;
}

export function asContactId(value: string): ContactId {
  return value as ContactId;
}

export function asLeadId(value: string): LeadId {
  return value as LeadId;
}

export function asEvidenceId(value: string): EvidenceId {
  return value as EvidenceId;
}

export function asResearchRequestId(value: string): ResearchRequestId {
  return value as ResearchRequestId;
}

export function asCampaignId(value: string): CampaignId {
  return value as CampaignId;
}

export function asSequenceId(value: string): SequenceId {
  return value as SequenceId;
}

export function asOutreachMessageId(value: string): OutreachMessageId {
  return value as OutreachMessageId;
}

export function asOutreachExecutionId(value: string): OutreachExecutionId {
  return value as OutreachExecutionId;
}

export function asConversationId(value: string): ConversationId {
  return value as ConversationId;
}

export function asReplyMessageId(value: string): ReplyMessageId {
  return value as ReplyMessageId;
}

export function asSignalId(value: string): SignalId {
  return value as SignalId;
}

export function asResearchRunId(value: string): ResearchRunId {
  return value as ResearchRunId;
}

export function asICPProfileVersionId(value: string): ICPProfileVersionId {
  return value as ICPProfileVersionId;
}
