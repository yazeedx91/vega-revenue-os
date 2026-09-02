# ADR-004-R: Use Dynamics 365 entities directly in core business logic (Rejected)

- **ADR ID:** ADR-004-R
- **Status:** Rejected
- **Date:** 2026-08-08
- **Decision Owners:** Architecture Board

## Context

This document records the alternative that was rejected for Domain Model and Provider Abstraction.

## Problem

The same problem as ADR-004: Domain Model and Provider Abstraction.

## Decision

Reject Use Dynamics 365 entities directly in core business logic in favor of the alternative selected in ADR-004.

## Rationale

Normalized domain objects keep AI and business logic decoupled from Dynamics 365, enabling future CRM/ERP providers to be added without touching the intelligence layer.

## Consequences

This option is not implemented. The accepted path is documented in [ADR-004](decisions/ADR-004.md).

## Related ADRs

- [ADR-004](decisions/ADR-004.md)
