# Domain Assumptions

## Domain-Level Assumption Register

| ID | Description | Reason | Impact | Confidence | Validation Method | Owner | Status |
|---|---|---|---|---|---|---|---|
| DA-001 | An Agent is modeled as an aggregate root | AI is a first-class business actor | AI Agent Management context | High | DDD review | Domain Architect | Accepted |
| DA-002 | AgentExecution is a separate aggregate from Mission | Avoid giant mission aggregate | Mission and AI Agent Management boundaries | High | DDD review | Domain Architect | Accepted |
| DA-003 | Tenant is an explicit aggregate root | Multi-tenancy is a first-class concern | Tenant boundaries | High | ADR-054, DDD review | Domain Architect | Accepted |
| DA-004 | Company and Contact are separate aggregates | Different lifecycles and ownership | Intelligence contexts | High | DDD review | Domain Architect | Accepted |
| DA-005 | Lead is a separate aggregate from Company/Contact | Lead has its own qualification lifecycle | Lead Management | High | DDD review | Domain Architect | Accepted |
| DA-006 | Conversation owns Messages | Messages have no meaning outside a conversation | Conversation Management | High | DDD review | Domain Architect | Accepted |
| DA-007 | Meeting is independent from Opportunity | Meeting can exist before opportunity | Meeting & Scheduling | High | DDD review | Domain Architect | Accepted |
| DA-008 | Opportunity references Lead and Meeting but does not own them | Clear aggregate boundaries | Opportunity Management | High | DDD review | Domain Architect | Accepted |
| DA-009 | Policy and Approval are in AI Governance context | Policies govern behavior across contexts | AI Governance | High | DDD review | Domain Architect | Accepted |
| DA-010 | CRM Synchronization uses anti-corruption layer | Provider neutrality requirement | CRM Synchronization | High | ADR-004, DDD review | Domain Architect | Accepted |
| DA-011 | Revenue Analytics is a read-model context | Analytics does not own source data | Revenue Analytics | High | DDD review | Domain Architect | Accepted |
| DA-012 | Billing is lightweight in domain model | Commercial details are assumptions | Billing & Subscription | Medium | Business validation | Finance | Proposed |
| DA-013 | Knowledge Management is eventually consistent | Knowledge is derived from executions | Knowledge Management | Medium | Implementation review | AI Architect | Proposed |
| DA-014 | Human and AI actors share an actor abstraction at the policy level | Both make decisions requiring audit | AI Governance | High | DDD review | Domain Architect | Accepted |
| DA-015 | Product Constitution will not materially contradict the domain model | Constitution missing | May require model revision if constitution conflicts | Low | Receive constitution | Domain Architect | Open |

## Open Assumptions

- DA-015 depends on the missing Product Constitution. The domain model will be reconciled if contradictions are discovered.

## Assumption Management

- Assumptions are documented with validation methods and owners.
- Accepted assumptions inform invariants and aggregate boundaries.
- Proposed assumptions require validation before they become constraints.
