# Business Architecture Overview

## Scope

This document defines the business architecture for the AI-Native Autonomous Revenue Employee. The system is an autonomous AI revenue employee that plans, executes, and learns how to generate qualified pipeline and booked meetings on behalf of a customer.

## Product Vision

The product receives a business objective such as "Generate qualified Microsoft Dynamics 365 opportunities in Saudi manufacturing companies" and then autonomously performs appropriate activities within its authorized policies.

## Primary Business Outcome

The primary business outcome is qualified pipeline and booked meetings, not email volume, contact lists, or raw activity.

## Business Actors

- **Paying Customer / Platform User**: Microsoft Dynamics 365 implementation partners, consultancies, resellers, and service providers that configure and operate the AI.
- **Targeted Prospect**: End-user organizations (e.g., manufacturing, logistics, retail) that may have a need for Microsoft Dynamics 365 or related services and are discovered and engaged by the AI.
- **Human Oversight Users**: Revenue managers, sales managers, compliance administrators, and executives who review, approve, or override AI actions.

## Business Lifecycle

```
Business Objective
      ↓
  Mission
      ↓
Market Discovery
      ↓
Company Intelligence
      ↓
Opportunity Scoring
      ↓
Decision-Maker Identification
      ↓
Personalized Outreach
      ↓
Conversation
      ↓
Qualification
      ↓
Meeting Scheduling
      ↓
CRM Opportunity
      ↓
Sales Handoff
      ↓
Outcome
      ↓
Learning / Evaluation
```

## Branching, Exceptions, and Escalation

Not every mission must follow this sequence. Missions may branch, pause, or escalate based on:

- Low confidence research or outreach
- Human approval thresholds
- Prospect opt-out or negative response
- Compliance guardrails
- Insufficient buying signals
- Calendar or CRM unavailability

## Relationship to Architecture

This business architecture aligns with the ADRs under `/docs/adr/`. In particular:

- ADR-001: Clean Architecture + DDD + EDA
- ADR-004: Provider-neutral domain model (Company, Contact, Lead, Opportunity, Activity, Meeting)
- ADR-025: Multi-agent orchestration
- ADR-030: Human-in-the-loop
- ADR-054/056: Multi-tenancy and tenant-scoped roles

## Missing Dependency

The Product Constitution at `/docs/000-product-constitution.md` was not found. Business decisions are therefore anchored to the accepted/proposed ADRs and the Phase 02 specification, not to a separate constitution. This is documented as an unresolved dependency and a constraint.
