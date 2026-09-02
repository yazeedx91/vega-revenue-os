# Ubiquitous Language

## Account

A target organization being tracked or engaged. In the domain model this is represented by `Company` / `Account`. See `Company`.

## Agent

A domain actor that performs revenue-related work. An `Agent` is configured, versioned, and executes `AgentTask`s within policies. Distinct from an automation script because it has identity, authority, and accountability.

## Agent Execution

A single run of an agent task within a mission. Tracks status, inputs, outputs, and decisions. Auditable.

## Agent Task

A discrete unit of work assigned to an agent by the Mission Management context.

## Approval

A human authorization of an AI action or decision. Has status, reason, and timestamp.

## Autonomy Level

The configured degree to which an agent may act without human approval. See `/docs/business/24-autonomy-model.md`.

## Buying Signal

Evidence that a company or contact may have a need for the customer's offering. Has source, confidence, and date.

## Company

A provider-neutral representation of an organization in the system. May be enriched with research, signals, and contacts.

## Contact

A provider-neutral representation of a person associated with a company.

## Conversation

A thread of messages or interactions between an AI agent and a prospect.

## Customer

The paying organization that operates the platform (the tenant).

## Decision

A domain-level choice made by an agent or human, recorded for audit and explainability.

## Engagement

Any interaction initiated by or received from a prospect.

## Human Approval

Explicit authorization by a human user before an agent performs an action.

## ICP (Ideal Customer Profile)

A tenant-configurable description of the companies and contacts to target. Encapsulates filters, signals, evidence rules, and thresholds.

## Intent

An inferred likelihood that a company or contact is interested in the customer's offering. May be captured as a confidence score or classification.

## Lead

A contact or company identified as a candidate for engagement. A lead transitions through qualification states.

## Meeting

A scheduled synchronous interaction between the customer's sales team and a prospect.

## Message

A single communication in a conversation, such as an email or LinkedIn message.

## Mission

A scoped, measurable, time-bound business task assigned to the AI employee. The central aggregate of the Mission Management context.

## Opportunity

A provider-neutral representation of a potential deal. Created after qualification and a meeting.

## Outcome

A measured result of a mission, conversation, or meeting. Used for attribution and learning.

## Pipeline

The total value of opportunities at various stages. Derived from opportunities.

## Policy

A tenant-configurable rule that governs what agents may do. Owned by AI Governance.

## Prospect

An account or contact being targeted by the AI but not yet a customer of the platform.

## Qualified Lead

A lead that meets the customer-defined qualification criteria.

## Qualified Meeting

A scheduled meeting with a prospect that meets the customer-defined qualification criteria.

## Signal

A piece of evidence that affects scoring or qualification. See `Buying Signal`.

## Target Contact

A relevant decision-maker or influencer at a target account.

## Task

A domain command or unit of work within a mission. Distinct from `AgentTask` in that it represents the mission-level work, not the agent-level execution.

## Tenant

The paying customer organization. A first-class aggregate root that owns configuration and policies.
