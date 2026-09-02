import { randomUUID } from 'crypto';
import { Agent, type IAgentRepository, type Capability } from '@projectx/domain';
import {
  asAgentId,
  asPolicyId,
  AuthorizationError,
  fail,
  type DomainError,
  type EventId,
  type PolicyId,
  type Result,
  type TenantId,
  ValidationError,
} from '@projectx/shared';
import type { CommandContext } from '../commands/command-context';
import { okOutcome, type CommandOutcome, type ICommandHandler } from '../commands/command-handler';
import type { IPolicyService } from '../ports/policy-service';

export interface CreateAgentCommand {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly description: string;
  readonly capabilities: Capability[];
  readonly tools: string[];
  readonly policies: { policyId: string; version: string }[];
  readonly modelPolicy: {
    preferredModelFamily: string;
    maxCostPerTaskUsd: number;
    maxTokensPerTask: number;
  };
  readonly memoryPolicy: {
    read: string[];
    write: string[];
    validationRequired: boolean;
  };
  readonly knowledgePolicy: {
    read: string[];
    write: string[];
  };
  readonly autonomyLevelDefault: number;
  readonly evaluationPolicy: {
    criteria: string[];
    minScore: number;
  };
  readonly owner: string;
  readonly tenantId: TenantId;
}

export interface ActivateAgentCommand {
  readonly agentId: string;
}

export interface PublishAgentVersionCommand {
  readonly agentId: string;
  readonly version: string;
}

function nextEventId(): EventId {
  return randomUUID() as EventId;
}

export class CreateAgentHandler implements ICommandHandler<CreateAgentCommand, Agent> {
  constructor(private readonly agentRepository: IAgentRepository) {}

  async execute(
    ctx: CommandContext,
    command: CreateAgentCommand,
  ): Promise<Result<CommandOutcome<Agent>, DomainError>> {
    const agentResult = Agent.create(
      {
        id: asAgentId(command.id),
        tenantId: ctx.tenantId,
        name: command.name,
        role: command.role,
        description: command.description,
        capabilities: command.capabilities,
        tools: command.tools,
        policies: command.policies.map((p) => ({ policyId: asPolicyId(p.policyId), version: p.version })),
        modelPolicy: command.modelPolicy,
        memoryPolicy: command.memoryPolicy,
        knowledgePolicy: command.knowledgePolicy,
        autonomyLevelDefault: command.autonomyLevelDefault,
        evaluationPolicy: command.evaluationPolicy,
        owner: command.owner,
      },
      ctx.actor,
      ctx.correlationId,
      nextEventId(),
    );

    if (!agentResult.success) {
      return fail(agentResult.error);
    }

    await this.agentRepository.save(ctx, agentResult.value);
    return { success: true, value: okOutcome(agentResult.value, 'Agent', agentResult.value.id) };
  }
}

export class ActivateAgentHandler implements ICommandHandler<ActivateAgentCommand, Agent> {
  constructor(
    private readonly agentRepository: IAgentRepository,
    private readonly policyService: IPolicyService,
  ) {}

  async execute(
    ctx: CommandContext,
    command: ActivateAgentCommand,
  ): Promise<Result<CommandOutcome<Agent>, DomainError>> {
    const agentId = asAgentId(command.agentId);
    const agent = await this.agentRepository.findById(ctx, agentId);
    if (!agent) {
      return fail(new ValidationError('Agent not found'));
    }

    const policyDecision = await this.policyService.evaluate(ctx, {
      actionType: 'ActivateAgent',
      resourceType: 'Agent',
      resourceId: agent.id,
      riskCategory: 'MEDIUM',
      autonomyLevel: agent.autonomyLevelDefault,
    });

    if (policyDecision === 'DENY') {
      return fail(new AuthorizationError('Policy denied agent activation'));
    }

    const result = agent.activate(ctx.correlationId, nextEventId());
    if (!result.success) {
      return fail(result.error);
    }

    await this.agentRepository.save(ctx, agent);
    return { success: true, value: okOutcome(agent, 'Agent', agent.id) };
  }
}

export class PublishAgentVersionHandler implements ICommandHandler<PublishAgentVersionCommand, Agent> {
  constructor(
    private readonly agentRepository: IAgentRepository,
    private readonly policyService: IPolicyService,
  ) {}

  async execute(
    ctx: CommandContext,
    command: PublishAgentVersionCommand,
  ): Promise<Result<CommandOutcome<Agent>, DomainError>> {
    const agentId = asAgentId(command.agentId);
    const agent = await this.agentRepository.findById(ctx, agentId);
    if (!agent) {
      return fail(new ValidationError('Agent not found'));
    }

    const policyDecision = await this.policyService.evaluate(ctx, {
      actionType: 'PublishAgentVersion',
      resourceType: 'Agent',
      resourceId: agent.id,
      riskCategory: 'HIGH',
      autonomyLevel: agent.autonomyLevelDefault,
    });

    if (policyDecision === 'DENY') {
      return fail(new AuthorizationError('Policy denied agent version publication'));
    }

    const result = agent.publishVersion(command.version, ctx.correlationId, nextEventId());
    if (!result.success) {
      return fail(result.error);
    }

    await this.agentRepository.save(ctx, agent);
    return { success: true, value: okOutcome(agent, 'Agent', agent.id) };
  }
}
