# ADR-007-R: Synchronous processing for all missions (Rejected)

- **ADR ID:** ADR-007-R
- **Status:** Rejected
- **Date:** 2026-08-08
- **Decision Owners:** Architecture Board

## Context

This document records the alternative that was rejected for Asynchronous-First Processing.

## Problem

The same problem as ADR-007: Asynchronous-First Processing.

## Decision

Reject Synchronous processing for all missions in favor of the alternative selected in ADR-007.

## Rationale

Asynchronous processing improves resilience, throughput, and agent autonomy while avoiding blocking callers for long work.

## Consequences

This option is not implemented. The accepted path is documented in [ADR-007](decisions/ADR-007.md).

## Related ADRs

- [ADR-007](decisions/ADR-007.md)
