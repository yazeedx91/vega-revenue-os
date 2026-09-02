# Architecture Decision Matrix

| ADR | Decision | Primary Alternative | Status | Group |
|-----|----------|---------------------|--------|-------|
| ADR-001 | Adopt Clean Architecture, Domain-Driven Design, and Event-Driven Architecture as... | Fully distributed microservices from day one | Accepted | Foundational |
| ADR-002 | Implement the system as a modular monolith with bounded contexts, clear ports/ad... | Single monolithic codebase without bounded contexts | Accepted | Foundational |
| ADR-003 | Expose every capability through versioned REST and GraphQL APIs described by Ope... | Direct database access for specialized clients | Accepted | Presentation |
| ADR-004 | Define normalized domain objects (Company, Contact, Lead, Opportunity, Activity,... | Build per-provider coupled models without normalization | Accepted | Integrations |
| ADR-005 | Adopt an event-driven architecture with an internal event bus, canonical event s... | Database triggers and polling for state changes | Accepted | Messaging |
| ADR-006 | Align bounded contexts to business capabilities: Identity, CRM Adapter, AI Core,... | Monolithic shared data model | Accepted | Foundational |
| ADR-007 | Treat long-running and multi-step work as asynchronous by default; reserve synch... | Message-only with no synchronous API | Accepted | Foundational |
| ADR-008 | Separate the backend API from the web frontend; the backend owns all intelligenc... | Thick client with direct external API calls | Accepted | Presentation |
| ADR-009 | Use Node.js with TypeScript as the backend runtime for ecosystem velocity, JSON ... | Go backend | Proposed | Platform |
| ADR-010 | Use HTTP/REST with JSON for standard CRUD and synchronous operations; add GraphQ... | gRPC and REST mixed from day one | Proposed | Presentation |
| ADR-011 | Use OAuth2/OIDC for authentication, tenant-scoped JWTs for authorization, and se... | Unversioned APIs with breaking changes | Accepted | Presentation |
| ADR-012 | Use PostgreSQL as the primary operational database with row-level security and p... | Multi-document NoSQL store as primary | Proposed | Data |
| ADR-013 | Use pgvector in PostgreSQL for initial vector storage; evaluate Pinecone or Weav... | Self-hosted Weaviate | Proposed | Data |
| ADR-014 | Use a property graph layer on PostgreSQL/Aurora initially; Neo4j is an optional ... | No graph model; use only relational tables | Proposed | Data |
| ADR-015 | Use Redis for caches, agent conversation state, sessions, and rate limiting. | Custom in-memory cache | Proposed | Data |
| ADR-016 | Use an S3-compatible object store such as MinIO or a cloud-native S3 equivalent ... | Cloud-specific proprietary object store | Proposed | Data |
| ADR-017 | Use Redis Streams as the initial message broker; evaluate RabbitMQ, NATS, or Kaf... | RabbitMQ | Proposed | Messaging |
| ADR-018 | Use Temporal for durable, observable mission workflows; build a custom engine on... | Stateless task queues without orchestration | Proposed | Messaging |
| ADR-019 | Use versioned, idempotent schema migrations; seed data per tenant; and maintain ... | Schema-free NoSQL without migration control | Accepted | Data |
| ADR-020 | Adopt a polyglot persistence model only where justified; keep the operational so... | Many specialized stores from day one | Accepted | Data |
| ADR-021 | Model revenue employee tasks as durable, observable missions with explicit state... | Pure chat-style interaction without workflow boundaries | Accepted | Messaging |
| ADR-022 | Use event streaming and state snapshots; adopt event sourcing only for mission h... | No events; direct state mutations only | Proposed | Messaging |
| ADR-023 | Build a multi-provider abstraction with OpenAI and Anthropic as primary provider... | Self-hosted open-weight models | Proposed | AI |
| ADR-024 | Implement a model router that selects provider and model based on task complexit... | Manual human selection per model call | Proposed | AI |
| ADR-025 | Use a multi-agent system with an orchestration layer, planner, memory services, ... | Fully decentralized agents without orchestration | Accepted | AI |
| ADR-026 | Use Redis for short-term conversation memory, PostgreSQL for long-term structure... | A single memory store for every horizon | Proposed | AI |
| ADR-027 | Maintain a typed, versioned tool registry with JSON schemas, capability metadata... | Untrusted arbitrary plugins | Accepted | AI |
| ADR-028 | Require JSON schema or tool-calling outputs, validate against schema, and parse ... | XML-structured output | Accepted | AI |
| ADR-029 | Score every high-impact output with confidence, self-consistency checks, source ... | Generative output without source trace | Accepted | AI |
| ADR-030 | Require explicit human approval for high-impact actions, destructive operations,... | Manual approval for every action | Accepted | AI |
| ADR-031 | Use a hierarchical task planner with LLM-based planning plus deterministic guard... | Purely reactive agent with no planning | Proposed | AI |
| ADR-032 | Use RAG over pgvector, web search results, and knowledge graph to ground LLM res... | Vector-only retrieval with no external search | Proposed | AI |
| ADR-033 | Enrich RAG results with the knowledge graph so the model receives explicit entit... | Full graph reasoning without vectors | Proposed | AI |
| ADR-034 | Start with prompt engineering, retrieval, and evaluation; fine-tune only when co... | No fine-tuning ever | Proposed | AI |
| ADR-035 | Use OpenTelemetry plus LLM-specific observability to trace prompts, completions,... | Vendor-specific observability only | Proposed | AI |
| ADR-036 | Store prompt templates in source control with version tags, parameter injection,... | No prompt management | Proposed | AI |
| ADR-037 | Build a Dynamics 365 Dataverse and Web API adapter behind the normalized domain ... | Build a full ETL batch pipeline | Proposed | Integrations |
| ADR-038 | Use Microsoft Graph as the primary email and calendar adapter, abstracted behind... | Hard-code Exchange Online | Proposed | Integrations |
| ADR-039 | Use the Zoom API as the initial meeting provider and wrap it behind a provider-a... | Build a custom meeting stack | Proposed | Integrations |
| ADR-040 | Use a dedicated external research service with search APIs and controlled, rate-... | Build and operate an own crawler cluster | Proposed | Integrations |
| ADR-041 | Adapters are versioned, tested with contract tests, and released independently b... | Per-release full manual regression suite | Accepted | Integrations |
| ADR-042 | Apply per-tenant and per-provider rate limiting, retries with backoff, circuit b... | Simple global throttle | Accepted | Integrations |
| ADR-043 | Log and trace every external call with tenant, provider, request, response, and ... | No external tracing | Accepted | Integrations |
| ADR-044 | Maintain tenant-scoped user, company, and profile models in PostgreSQL with deri... | External customer data platform | Proposed | Intelligence |
| ADR-045 | Capture explicit preferences and derive behavioral signals; do not infer sensiti... | Static personas without learning | Proposed | Intelligence |
| ADR-046 | Combine rules, scoring, and LLM reasoning to generate explainable next-best acti... | Static rules with no model | Proposed | Intelligence |
| ADR-047 | Use a blend of opportunity data, activity signals, and LLM reasoning to score an... | Opaque model without explanation | Proposed | Intelligence |
| ADR-048 | Generate personalized communications using approved templates, profile data, and... | Fully autonomous copy without oversight | Proposed | Intelligence |
| ADR-049 | Use RAG over CRM, email, and research sources to produce concise, cited meeting ... | Static template briefs | Proposed | Intelligence |
| ADR-050 | Allow autonomous actions only inside policy guardrails and the tool registry; hi... | Full autonomous execution without guardrails | Proposed | Intelligence |
| ADR-051 | Capture explicit and implicit feedback to refine scoring, prompts, and actions; ... | Only manual human feedback | Proposed | Intelligence |
| ADR-052 | Audit recommendations for fairness, avoid protected-class inference, and surface... | Block all personalization | Proposed | Intelligence |
| ADR-053 | Use OIDC with OAuth2 for authentication, tenant-scoped JWTs, and RBAC for author... | No central identity | Accepted | Security |
| ADR-054 | Use tenant ID everywhere, per-tenant PostgreSQL schemas, row-level security, and... | Separate database per tenant | Accepted | Security |
| ADR-055 | Enforce tenant isolation through schema, RLS, encryption, and explicit no-cross-... | Full physical separation per tenant | Accepted | Security |
| ADR-056 | Role definitions and JWT claims carry tenant ID and are enforced at the API gate... | Per-tenant custom policy engine | Accepted | Security |
| ADR-057 | Use a cloud KMS or HashiCorp Vault with envelope encryption; store per-tenant pr... | Database plaintext credentials | Proposed | Security |
| ADR-058 | Use TLS for all transit, AES-256 or cloud-managed encryption at rest, and envelo... | No encryption | Accepted | Security |
| ADR-059 | Write append-only, tenant-scoped audit logs with actor identity, timestamp, acti... | No audit trail | Accepted | Security |
| ADR-060 | Apply rate limits per tenant, user, and endpoint using Redis with graduated resp... | Hard caps only | Accepted | Security |
| ADR-061 | Automate dependency scanning, container image scanning, and patch management wit... | No scanning | Accepted | Security |
| ADR-062 | Filter inputs and outputs for PII, toxic, disallowed, or harmful content and blo... | Block all AI output | Accepted | Security |
| ADR-063 | Use prompt boundaries, input validation, role separation, output sandboxing, and... | No LLM access | Accepted | Security |
| ADR-064 | Deploy tenant data in chosen regions with data-local storage and replicate metad... | Full sovereign isolation per tenant | Proposed | Security |
| ADR-065 | Daily backups, point-in-time recovery, and tenant-configurable retention with qu... | Continuous global replication everywhere | Proposed | Security |
| ADR-066 | Design for SOC 2, ISO 27001, and GDPR from day one and map controls to ADRs and ... | Certify before launch | Proposed | Security |
| ADR-067 | Capture consent, support right-of-access and right-to-delete, mask PII, and enfo... | Manual privacy process | Proposed | Security |
| ADR-068 | Annual third-party penetration tests, continuous red teaming for AI agents, and ... | Only internal tests | Proposed | Security |
| ADR-069 | Documented incident response playbooks, tenant notification, and automated conta... | Fully outsourced SOC | Proposed | Security |
| ADR-070 | Automated offboarding workflow that exports or deletes data per policy and provi... | Immediate hard delete without confirmation | Proposed | Security |
| ADR-071 | Package services as OCI containers with multi-stage builds, non-root images, and... | Uncontainerized binaries | Proposed | Platform |
| ADR-072 | Be Kubernetes-ready from day one but start on a managed container platform; migr... | Serverless functions only | Proposed | Platform |
| ADR-073 | Use Terraform or Pulumi to define all infrastructure, store state securely, and ... | Vendor-specific IaC only | Proposed | Platform |
| ADR-074 | Remain cloud-agnostic with containers and IaC; default evaluation targets are AW... | Multi-cloud active-active everywhere | Proposed | Platform |
| ADR-075 | Use GitHub Actions or cloud-native CI/CD with staged quality gates, signed artif... | Fully custom pipeline | Proposed | Platform |
| ADR-076 | Use ephemeral dev and test environments per branch, a stable staging environment... | Only production environment | Proposed | Platform |
| ADR-077 | Use OpenTelemetry for traces and metrics, structured logging, LLM-specific obser... | No observability | Proposed | Platform |
| ADR-078 | Distribute secrets and config via Vault or KMS plus runtime config injection; ne... | Dynamic DNS for secrets | Proposed | Platform |
| ADR-079 | Tag resources by tenant, set budgets, autoscale, and review costs monthly with t... | Fixed capacity forever | Proposed | Platform |
| ADR-080 | Run unit, integration, contract, E2E, and AI-agent eval suites in CI with clear ... | Only unit tests | Accepted | Quality |
| ADR-081 | Use Pact or Schemathesis for contract tests and validate OpenAPI/AsyncAPI specs ... | Postman collections only | Accepted | Quality |
| ADR-082 | Benchmark prompts, agent task plans, and model outputs with a continuous evaluat... | Manual model reviews | Accepted | Quality |
| ADR-083 | Use Playwright for critical user journeys against seeded tenant environments in ... | Only manual UI testing | Accepted | Quality |
| ADR-084 | Run SAST, DAST, dependency scanning, and AI red-teaming in CI with defined fix S... | Annual penetration test only | Proposed | Quality |
| ADR-085 | All architecture changes require an ADR using the allowed statuses and the lifec... | Only oral architecture decisions | Accepted | Governance |
| ADR-086 | Maintain a central schema registry, require OpenAPI/AsyncAPI review, and gate br... | No schema governance | Accepted | Governance |
| ADR-087 | Use a monorepo with clear CODEOWNERS, branch protection, and mandatory review fo... | No code review | Accepted | Governance |
| ADR-088 | Maintain an approved model list, prompt approval workflow, bias review, and mand... | No AI governance | Proposed | Governance |
| ADR-089 | Use semantic versioning, release notes, deprecation windows, and feature flags f... | No versioning | Accepted | Governance |
| ADR-090 | Define SLOs per bounded context, alert on error budgets, and review quarterly. | Alert on every error | Accepted | Governance |
| ADR-091 | Require security review for every release, maintain a control map, and perform a... | Security team gate on every change | Accepted | Governance |
| ADR-092 | Documentation and runbooks live with code, architecture diagrams are maintained ... | No documentation | Accepted | Governance |
| ADR-093 | Assess vendor risk, maintain an approved provider list, and have an exit plan fo... | No external vendors | Proposed | Governance |
| ADR-094 | Define end-of-life, publish migration guides, and follow a sunsetting process fo... | Delete without notice | Accepted | Governance |
| ADR-095 | Use canary and blue-green releases with tenant-aware rollout, feature flags, and... | Blue-green only | Accepted | Release |