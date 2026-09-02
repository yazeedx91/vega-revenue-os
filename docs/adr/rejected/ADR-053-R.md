# ADR-053-R: Custom authentication and session tokens (Rejected)

- **ADR ID:** ADR-053-R
- **Status:** Rejected
- **Date:** 2026-08-08
- **Decision Owners:** Architecture Board

## Context

This document records the alternative that was rejected for Identity and Access Management.

## Problem

The same problem as ADR-053: Identity and Access Management.

## Decision

Reject Custom authentication and session tokens in favor of the alternative selected in ADR-053.

## Rationale

OIDC and OAuth2 are industry standards with broad identity-provider support, enabling secure multi-tenant SSO.

## Consequences

This option is not implemented. The accepted path is documented in [ADR-053](decisions/ADR-053.md).

## Related ADRs

- [ADR-053](decisions/ADR-053.md)
