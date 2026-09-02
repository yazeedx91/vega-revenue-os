# ADR-002-R: Microservices from launch (Rejected)

- **ADR ID:** ADR-002-R
- **Status:** Rejected
- **Date:** 2026-08-08
- **Decision Owners:** Architecture Board

## Context

This document records the alternative that was rejected for Modular Monolith with Bounded Contexts.

## Problem

The same problem as ADR-002: Modular Monolith with Bounded Contexts.

## Decision

Reject Microservices from launch in favor of the alternative selected in ADR-002.

## Rationale

A modular monolith delivers speed and operational simplicity while preserving the option to extract services. Explicit bounded contexts prevent the monolith from becoming a big ball of mud.

## Consequences

This option is not implemented. The accepted path is documented in [ADR-002](decisions/ADR-002.md).

## Related ADRs

- [ADR-002](decisions/ADR-002.md)
