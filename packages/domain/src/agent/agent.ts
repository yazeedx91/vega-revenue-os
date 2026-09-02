import type { AgentId, PolicyId, TenantId } from '@projectx/shared';
import { fail, ok, type Result } from '@projectx/shared';
import type { CorrelationId, EventId } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import { AgentInvariantError, InvalidStateTransitionError } from '../errors/domain-errors';
import type { Actor } from '../actor/actor';
import { AgentVersion, type AgentConfigurationSnapshot } from './agent-version';
import { Capability } from './capability';
import type { AgentLifecycle } from './agent-status';
import * as AgentEvents from './events';

export interface AgentProps {
  readonly id: AgentId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly role: string;
  readonly description: string;
  readonly capabilities: Capability[];
  readonly tools: string[];
  readonly policies: { policyId: PolicyId; version: string }[];
  readonly modelPolicy: AgentConfigurationSnapshot['modelPolicy'];
  readonly memoryPolicy: AgentConfigurationSnapshot['memoryPolicy'];
  readonly knowledgePolicy: AgentConfigurationSnapshot['knowledgePolicy'];
  readonly autonomyLevelDefault: number;
  readonly evaluationPolicy: AgentConfigurationSnapshot['evaluationPolicy'];
  readonly owner: string;
}

export class Agent extends AggregateRoot<AgentId> {
  public readonly name: string;
  public readonly role: string;
  public readonly description: string;
  private readonly _capabilities: Capability[] = [];
  public readonly tools: string[];
  public readonly policies: { policyId: PolicyId; version: string }[];
  public readonly modelPolicy: AgentConfigurationSnapshot['modelPolicy'];
  public readonly memoryPolicy: AgentConfigurationSnapshot['memoryPolicy'];
  public readonly knowledgePolicy: AgentConfigurationSnapshot['knowledgePolicy'];
  public readonly autonomyLevelDefault: number;
  public readonly evaluationPolicy: AgentConfigurationSnapshot['evaluationPolicy'];
  public readonly owner: string;
  public readonly createdAt: Date;
  public updatedAt: Date;
  private _lifecycle: AgentLifecycle = 'DRAFT';
  private readonly _versions: AgentVersion[] = [];
  private _currentVersion: string | null = null;

  get lifecycle(): AgentLifecycle {
    return this._lifecycle;
  }

  get capabilities(): readonly Capability[] {
    return this._capabilities;
  }

  get currentVersion(): string | null {
    return this._currentVersion;
  }

  get versions(): readonly AgentVersion[] {
    return this._versions;
  }

  private constructor(props: AgentProps) {
    super(props.tenantId, props.id);
    this.name = props.name;
    this.role = props.role;
    this.description = props.description;
    this._capabilities.push(...props.capabilities);
    this.tools = props.tools;
    this.policies = props.policies;
    this.modelPolicy = props.modelPolicy;
    this.memoryPolicy = props.memoryPolicy;
    this.knowledgePolicy = props.knowledgePolicy;
    this.autonomyLevelDefault = props.autonomyLevelDefault;
    this.evaluationPolicy = props.evaluationPolicy;
    this.owner = props.owner;
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }

  static create(
    props: AgentProps,
    actor: Actor,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<Agent, AgentInvariantError> {
    if (!props.capabilities || props.capabilities.length === 0) {
      return fail(new AgentInvariantError('Agent must have at least one capability'));
    }
    if (props.autonomyLevelDefault < 0 || props.autonomyLevelDefault > 5) {
      return fail(new AgentInvariantError('Autonomy level must be between 0 and 5'));
    }

    const agent = new Agent(props);
    agent.applyEvent(
      new AgentEvents.AgentCreated(eventId, props.tenantId, correlationId, {
        agentId: props.id,
        name: props.name,
        role: props.role,
      }),
    );
    return ok(agent);
  }

  registerCapability(
    capability: Capability,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, AgentInvariantError> {
    if (this._capabilities.some((c) => c.id === capability.id)) {
      return fail(new AgentInvariantError('Capability already registered'));
    }
    this._capabilities.push(capability);
    this.updatedAt = new Date();
    this.applyEvent(
      new AgentEvents.CapabilityRegistered(eventId, this.tenantId, correlationId, {
        agentId: this.id,
        capabilityId: capability.id,
      }),
    );
    return ok(undefined);
  }

  publishVersion(
    version: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, AgentInvariantError> {
    if (this._versions.some((v) => v.id === version)) {
      return fail(new AgentInvariantError('Version already published and is immutable'));
    }
    const snapshot: AgentConfigurationSnapshot = {
      capabilities: this._capabilities.slice(),
      tools: this.tools.slice(),
      policies: this.policies.slice(),
      modelPolicy: { ...this.modelPolicy },
      memoryPolicy: { ...this.memoryPolicy },
      knowledgePolicy: { ...this.knowledgePolicy },
      autonomyLevelDefault: this.autonomyLevelDefault,
      evaluationPolicy: { ...this.evaluationPolicy },
    };
    const agentVersion = new AgentVersion(version, snapshot);
    this._versions.push(agentVersion);
    this._currentVersion = version;
    this.updatedAt = new Date();
    this.applyEvent(
      new AgentEvents.AgentVersionPublished(eventId, this.tenantId, correlationId, {
        agentId: this.id,
        version,
      }),
    );
    return ok(undefined);
  }

  activate(correlationId: CorrelationId, eventId: EventId): Result<void, InvalidStateTransitionError> {
    if (this._lifecycle === 'RETIRED') {
      return fail(new InvalidStateTransitionError('Cannot activate a retired agent'));
    }
    this._lifecycle = 'ACTIVE';
    this.updatedAt = new Date();
    this.applyEvent(
      new AgentEvents.AgentActivated(eventId, this.tenantId, correlationId, { agentId: this.id }),
    );
    return ok(undefined);
  }

  deactivate(correlationId: CorrelationId, eventId: EventId): Result<void, InvalidStateTransitionError> {
    if (this._lifecycle === 'RETIRED') {
      return fail(new InvalidStateTransitionError('Cannot deactivate a retired agent'));
    }
    this._lifecycle = 'DEPRECATED';
    this.updatedAt = new Date();
    this.applyEvent(
      new AgentEvents.AgentDeactivated(eventId, this.tenantId, correlationId, { agentId: this.id }),
    );
    return ok(undefined);
  }
}
