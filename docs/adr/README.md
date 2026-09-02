# Architecture Decision Records (ADRs)

This directory records the architectural decisions for the AI-Native Autonomous Revenue Employee.

## Status Values

- **Accepted** — Decision has been reviewed and approved.
- **Proposed** — Decision is documented but awaiting validation of constraints.
- **Superseded** — Replaced by a newer ADR; the newer ADR is in `decisions/` and the old is in `superseded/`.
- **Rejected** — An alternative that was explicitly rejected; stored in `rejected/`.

## Directory Layout

```
/docs/adr/
  README.md                    # This file
  template.md                  # Standardized ADR template
  index.md                     # Master index
  decisions/                   # Accepted or Proposed ADRs
  superseded/                  # ADRs replaced by newer decisions
  rejected/                    # Rejected alternatives with rationale
```

## Lifecycle

1. Draft the ADR using `template.md`.
2. Open a review with the Architecture Board.
3. On acceptance, place the ADR in `decisions/` and update `index.md`.
4. If later superseded, move the old ADR to `superseded/` and link the replacement.
5. If an alternative is rejected, place the rejected option in `rejected/` and reference it from the accepted ADR.

## Current Status Summary

| Status    | Count |
|-----------|-------|
| Accepted | 43 |
| Proposed | 52 |

## How to Use

- Start with `index.md` to find a decision by domain or ID.
- Check `dependency-map.md` to understand the decision graph.
- Read `PHASE-01-COMPLETION-REPORT.md` for the phase gate evidence.
