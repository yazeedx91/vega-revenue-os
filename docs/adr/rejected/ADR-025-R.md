# ADR-025-R: Single monolithic agent (Rejected)

- **ADR ID:** ADR-025-R
- **Status:** Rejected
- **Date:** 2026-08-08
- **Decision Owners:** Architecture Board

## Context

This document records the alternative that was rejected for Agent Orchestration Architecture.

## Problem

The same problem as ADR-025: Agent Orchestration Architecture.

## Decision

Reject Single monolithic agent in favor of the alternative selected in ADR-025.

## Rationale

A multi-agent architecture separates concerns, enables specialization, and supports scaling. A supervisor pattern provides coordination without a single point of failure.

## Consequences

This option is not implemented. The accepted path is documented in [ADR-025](decisions/ADR-025.md).

## Related ADRs

- [ADR-025](decisions/ADR-025.md)
