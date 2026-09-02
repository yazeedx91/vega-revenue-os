import type { Conversation } from '@projectx/domain';
import type { NextBestAction } from '@projectx/domain';

export interface INextBestActionPolicy {
  decide(conversation: Conversation, autonomyLevel: number): NextBestAction;
}
