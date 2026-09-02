# Architecture Assumptions

## Phase 04 Assumptions

| ID | Assumption | Basis | Risk |
|---|---|---|---|
| A-ARCH-001 | Initial runtime is a modular monolith plus independent worker pools | Reduces operational complexity while preserving domain boundaries | Future extraction effort required |
| A-ARCH-002 | Event-driven communication between contexts is viable | ADR-005 Event-Driven Architecture | Event infrastructure selection pending |
| A-ARCH-003 | LLM provider abstraction can be achieved with an internal gateway | ADR-004 Provider-neutral domain model | Provider-specific quirks may require adapter work |
| A-ARCH-004 | Tenant isolation can be enforced at API, service, DB, event, and AI layers | ADR-054 Multi-Tenancy Model | Requires rigorous implementation |
| A-ARCH-005 | Long-running missions can be implemented with durable workflows and checkpoints | Business architecture mission model | Workflow engine selection pending |
| A-ARCH-006 | Multiple CRM/ERP providers can be supported via anti-corruption layers | ADR-004 Provider-neutral domain model | Initial focus is Dynamics 365 |
| A-ARCH-007 | Human approval can be integrated as workflow steps | ADR-030 Human-in-the-Loop and Approval | Latency depends on human response |
| A-ARCH-008 | Revenue Analytics can be built as event projections | Domain analytics context | Analytics store selection pending |
| A-ARCH-009 | Audit records can be made tamper-resistant with append-only storage | Compliance requirements | Cryptographic guarantees require further design |
| A-ARCH-010 | Background workers can achieve tenant isolation via tenant-scoped job context | Multi-tenancy requirements | Worker design must enforce this |
| A-ARCH-011 | RPO of 1 hour and RTO of 4 hours are acceptable | Proposed DR targets | Requires business validation |
| A-ARCH-012 | The system will operate under standard public cloud security models | Security architecture | Compliance certifications may impose additional controls |
| A-ARCH-013 | AI-specific threats can be mitigated with input/output validation, policy enforcement, and human oversight | AI security requirements | Adversarial attacks continue to evolve |

## Validation Plan

- Assumptions A-ARCH-001, A-ARCH-002, A-ARCH-005, A-ARCH-008 require technology selection in Phase 05.
- Assumptions A-ARCH-004, A-ARCH-010 require implementation and penetration testing.
- Assumptions A-ARCH-011 requires business sign-off.
