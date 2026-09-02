import type { IRepository } from '../repository/repository.interface';
import type { Agent } from './agent';
import type { AgentId } from '../types';

export interface IAgentRepository extends IRepository<Agent, AgentId> {}
