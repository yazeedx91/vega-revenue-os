# Domain Model Overview

## Core Domain

The core domain of the system is **Autonomous Revenue Execution**. The first commercial specialization is **Microsoft Dynamics 365 ERP opportunity generation**, but the domain model remains provider-neutral wherever possible.

## Domain Modeling Approach

The domain is modeled using **Domain-Driven Design (DDD)** with the following patterns:

- **Bounded Contexts** to isolate language and responsibilities
- **Aggregates** with small, explicit consistency boundaries
- **Entities** with domain identity and lifecycle
- **Value Objects** for immutable, interchangeable concepts
- **Domain Events** for meaningful business facts across contexts
- **Domain Services** for operations that do not belong to a single entity
- **Domain Policies** and **Specifications** for reusable business rules
- **Commands** for explicit business intentions

## Domain Layers

### Core Domain

Concepts that create the competitive differentiation of the platform:

- Mission
- Autonomous revenue execution
- AI-driven lead qualification and outreach
- Buying signal intelligence
- Outcome attribution and learning

### Supporting Domains

Concepts required but not the primary differentiator:

- Tenant and organization management
- User and identity management
- CRM synchronization and adapter mappings
- Meeting and scheduling
- Conversation management
- Compliance and consent

### Generic Domains

Well-understood concerns that can use standard patterns or third-party solutions:

- Authentication and authorization
- Billing metering and subscription tracking
- Audit logging
- Notifications and email transport

### Platform / Infrastructure Concerns

Not part of the business domain but necessary for delivery:

- Database persistence
- Message broker
- LLM provider adapters
- Web/API transport
- Object storage
- Observability infrastructure

## Key Domain Principle

**The AI is a first-class business actor**, but LLM implementation details belong to infrastructure. The domain models the AI's authority, decisions, and outcomes, not the underlying model provider.

## Multi-Tenancy

Every tenant-scoped aggregate carries a tenant identity. Tenant is an explicit aggregate root that owns tenant-level configuration and policies, but other aggregates remain independent and reference the tenant only by identity.

## Provider Neutrality

Core domain objects are provider-neutral. Provider-specific concepts (e.g., Dynamics 365 Web API fields) are isolated behind anti-corruption layers in the CRM Synchronization context.

## Authoritative Sources

- Accepted ADRs under `/docs/adr/`
- Business Architecture under `/docs/business/`
- Phase 03 domain decisions
