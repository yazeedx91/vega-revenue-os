import type { IAgentImplementation } from './agent-implementation.interface';

export interface IAgentImplementationRegistry {
  resolve(implementationKey: string): IAgentImplementation | null;
  register?(implementation: IAgentImplementation): void;
}