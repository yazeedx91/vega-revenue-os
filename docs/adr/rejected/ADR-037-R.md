# ADR-037-R: Call Dynamics 365 entities directly from core logic (Rejected)

- **ADR ID:** ADR-037-R
- **Status:** Rejected
- **Date:** 2026-08-08
- **Decision Owners:** Architecture Board

## Context

This document records the alternative that was rejected for Dynamics 365 CRM Adapter.

## Problem

The same problem as ADR-037: Dynamics 365 CRM Adapter.

## Decision

Reject Call Dynamics 365 entities directly from core logic in favor of the alternative selected in ADR-037.

## Rationale

An adapter hides Dynamics specifics, maps to normalized domain objects, and lets the AI and business logic remain provider-agnostic.

## Consequences

This option is not implemented. The accepted path is documented in [ADR-037](decisions/ADR-037.md).

## Related ADRs

- [ADR-037](decisions/ADR-037.md)
