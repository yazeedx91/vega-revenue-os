# ADR-001-R: Anemic CRUD with direct database access from controllers (Rejected)

- **ADR ID:** ADR-001-R
- **Status:** Rejected
- **Date:** 2026-08-08
- **Decision Owners:** Architecture Board

## Context

This document records the alternative that was rejected for Core Architectural Style.

## Problem

The same problem as ADR-001: Core Architectural Style.

## Decision

Reject Anemic CRUD with direct database access from controllers in favor of the alternative selected in ADR-001.

## Rationale

Clean Architecture and DDD provide clear boundaries, testability, and domain language alignment. Event-Driven Architecture naturally supports autonomous agents and decoupled integrations. Microservices from launch add operational cost and coupling without proven scale.

## Consequences

This option is not implemented. The accepted path is documented in [ADR-001](decisions/ADR-001.md).

## Related ADRs

- [ADR-001](decisions/ADR-001.md)
