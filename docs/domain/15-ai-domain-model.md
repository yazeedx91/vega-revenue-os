# AI Domain Model

## AI-Native Domain Concepts

The domain model treats AI agents as controlled business actors. LLM provider details are infrastructure concerns and do not appear in the core domain.

## Core AI Domain Concepts

| Concept | Classification | Definition | Context |
|---|---|---|---|
| Agent | Aggregate Root | A configured AI actor with identity, capabilities, and versions | AI Agent Management |
| AgentRole | Entity | A role that an agent can fulfill | AI Agent Management |
| AgentCapability | Value Object / Entity | A specific skill or tool the agent can use | AI Agent Management |
| AgentVersion | Entity | An immutable snapshot of agent configuration | AI Agent Management |
| AgentExecution | Aggregate Root | A single run of an agent task | AI Agent Management |
| AgentTask | Entity | A unit of work assigned to an agent | AI Agent Management |
| AgentOutcome | Value Object / Entity | The result of an agent execution | AI Agent Management |
| AgentFailure | Entity | A failure record for an execution | AI Agent Management |
| AgentDecision | Value Object / Domain Event | A recorded choice made by an agent | AI Agent Management |
| AgentEscalation | Domain Event / Entity | A request for human intervention | AI Agent Management |

## Agent Aggregate

- **Aggregate Root**: Agent
- **Owned entities**: AgentRole, AgentVersion, AgentCapability references
- **Invariants**:
  - An agent must have at least one capability.
  - Published versions are immutable.
- **Commands**: CreateAgent, RegisterCapability, PublishVersion, Activate, Deactivate
- **Events**: AgentCreated, CapabilityRegistered, AgentVersionPublished

## AgentExecution Aggregate

- **Aggregate Root**: AgentExecution
- **Owned entities**: AgentTask, AgentOutcome, AgentFailure
- **Invariants**:
  - State transitions follow the execution state machine.
  - Awaiting approval requires an approval record.
- **Commands**: CreateExecution, StartExecution, CompleteExecution, FailExecution, CancelExecution, RollbackExecution
- **Events**: AgentExecutionStarted, AgentExecutionCompleted, AgentExecutionFailed, AgentExecutionAwaitingApproval, AgentExecutionCancelled, AgentExecutionRolledBack

## Agent as a Business Actor

An agent has:

- **Identity**: AgentId
- **Authority**: Defined by capabilities and policies
- **Permissions**: Derived from roles and policies
- **Responsibilities**: Fulfilling assigned tasks within policy
- **Boundaries**: Cannot act beyond capabilities or policy
- **Accountability**: Every action is recorded in AgentExecution and Audit

## Agent and Mission Relationship

- Mission Management requests tasks from AI Agent Management.
- AI Agent Management executes tasks and emits events.
- Mission Management reacts to events (completed, failed, awaiting approval).
- AI Agent Management does not own mission objectives or success criteria.

## Agent and Governance Relationship

- AI Governance & Policy defines policies and autonomy levels.
- AI Agent Management evaluates policies before/during execution.
- High-risk or policy-blocked actions escalate to AI Governance/Approval.

## AI Domain Value Objects

| Value Object | Definition |
|---|---|
| AgentId | Unique agent identifier |
| ExecutionId | Unique execution identifier |
| CapabilityId | Unique capability identifier |
| ConfidenceScore | Normalized confidence in an agent outcome |
| ExecutionStatus | State of an agent execution |
| TaskDefinition | Description of the work assigned |
| AgentDecisionReason | Explanation for an agent decision |

## AI Domain Services

| Service | Purpose |
|---|---|
| AutonomyDecisionService | Decide if an agent may act autonomously |
| PolicyEvaluationService | Evaluate an action against policies |
| AgentCapabilityValidationService | Verify an agent has required capabilities |
| AgentVersionSelectionService | Select appropriate agent version for a task |

## AI Domain Events

- AgentCreated
- CapabilityRegistered
- AgentVersionPublished
- AgentExecutionStarted
- AgentExecutionCompleted
- AgentExecutionFailed
- AgentExecutionAwaitingApproval
- AgentExecutionCancelled
- AgentExecutionRolledBack

## Boundaries with Infrastructure

- LLM provider clients are infrastructure.
- Prompt templates may be stored as value objects or in Knowledge Management, depending on governance requirements.
- Model routing and provider selection are infrastructure/application concerns.
- Token usage and cost are tracked in Billing & Subscription via events.
