# ADR Index

| ADR | Title | Status | Group | Dependencies | Related |
|-----|-------|--------|-------|--------------|---------|
| ADR-001 | Core Architectural Style | Accepted | Foundational | - | ADR-002; ADR-005; ADR-006 |
| ADR-002 | Modular Monolith with Bounded Contexts | Accepted | Foundational | ADR-001 | ADR-005; ADR-006 |
| ADR-003 | API-First Design | Accepted | Presentation | ADR-001 | ADR-010; ADR-011 |
| ADR-004 | Domain Model and Provider Abstraction | Accepted | Integrations | ADR-001 | ADR-037; ADR-038; ADR-039 |
| ADR-005 | Event-Driven Architecture | Accepted | Messaging | ADR-001 | ADR-006; ADR-021 |
| ADR-006 | Bounded Contexts and Service Boundaries | Accepted | Foundational | ADR-001; ADR-002 | ADR-004 |
| ADR-007 | Asynchronous-First Processing | Accepted | Foundational | ADR-001; ADR-005 | ADR-021 |
| ADR-008 | Backend and Frontend Separation | Accepted | Presentation | ADR-003 | ADR-010 |
| ADR-009 | Backend Language and Runtime | Proposed | Platform | ADR-001; ADR-002 | ADR-071; ADR-080 |
| ADR-010 | API Protocol | Proposed | Presentation | ADR-003 | ADR-011 |
| ADR-011 | API Security and Versioning | Accepted | Presentation | ADR-010 | ADR-053; ADR-056 |
| ADR-012 | Operational Database | Proposed | Data | ADR-001 | ADR-013; ADR-015 |
| ADR-013 | Vector Storage | Proposed | Data | ADR-012 | ADR-032; ADR-033 |
| ADR-014 | Knowledge Graph Storage | Proposed | Data | ADR-012 | ADR-033 |
| ADR-015 | Caching, Conversation, and Session Store | Proposed | Data | ADR-012 | ADR-017; ADR-021 |
| ADR-016 | Object Storage | Proposed | Data | ADR-012 | ADR-019 |
| ADR-017 | Message Broker | Proposed | Messaging | ADR-015 | ADR-005; ADR-021 |
| ADR-018 | Workflow Engine | Proposed | Messaging | ADR-017 | ADR-021; ADR-022 |
| ADR-019 | Schema Migration and Data Governance | Accepted | Data | ADR-012 | ADR-020 |
| ADR-020 | Multi-Model Persistence Strategy | Accepted | Data | ADR-012; ADR-013; ADR-014; ADR-015; ADR-016 | ADR-019 |
| ADR-021 | Mission Workflow Processing | Accepted | Messaging | ADR-005; ADR-017; ADR-018 | ADR-022; ADR-025 |
| ADR-022 | Event Streaming versus Event Sourcing | Proposed | Messaging | ADR-005 | ADR-021 |
| ADR-023 | LLM Provider Abstraction | Proposed | AI | ADR-001 | ADR-024; ADR-035 |
| ADR-024 | Model Routing and Fallback | Proposed | AI | ADR-023 | ADR-028 |
| ADR-025 | Agent Orchestration Architecture | Accepted | AI | ADR-001; ADR-005 | ADR-026; ADR-027 |
| ADR-026 | Memory and Context Management | Proposed | AI | ADR-015; ADR-012 | ADR-032 |
| ADR-027 | Tool Registry | Accepted | AI | ADR-025 | ADR-028 |
| ADR-028 | Structured Output and Parsing | Accepted | AI | ADR-027 | ADR-029; ADR-030 |
| ADR-029 | Confidence Scoring and Hallucination Mitigation | Accepted | AI | ADR-028 | ADR-030; ADR-032 |
| ADR-030 | Human-in-the-Loop and Approval | Accepted | AI | ADR-029 | ADR-025 |
| ADR-031 | Agent Planning and Task Decomposition | Proposed | AI | ADR-025 | ADR-027; ADR-030 |
| ADR-032 | Retrieval-Augmented Generation | Proposed | AI | ADR-013; ADR-023 | ADR-033; ADR-049 |
| ADR-033 | Knowledge Graph Integration with RAG | Proposed | AI | ADR-014; ADR-032 | ADR-029 |
| ADR-034 | Fine-Tuning versus Prompt Engineering | Proposed | AI | ADR-023 | ADR-035 |
| ADR-035 | LLM Observability | Proposed | AI | ADR-001; ADR-023 | ADR-077 |
| ADR-036 | Prompt Versioning and Management | Proposed | AI | ADR-023; ADR-034 | ADR-035 |
| ADR-037 | Dynamics 365 CRM Adapter | Proposed | Integrations | ADR-004 | ADR-041; ADR-042 |
| ADR-038 | Email and Calendar Adapter | Proposed | Integrations | ADR-004 | ADR-037 |
| ADR-039 | Meeting Provider Adapter | Proposed | Integrations | ADR-004 | ADR-038 |
| ADR-040 | External Research and Web Crawling | Proposed | Integrations | ADR-001; ADR-032 | ADR-049 |
| ADR-041 | Provider Adapter Lifecycle | Accepted | Integrations | ADR-004; ADR-037 | ADR-042 |
| ADR-042 | Integration Rate Limiting and Resilience | Accepted | Integrations | ADR-041 | ADR-043 |
| ADR-043 | Integration Observability and Audit | Accepted | Integrations | ADR-042 | ADR-059 |
| ADR-044 | User and Company Profile Model | Proposed | Intelligence | ADR-012; ADR-015 | ADR-045 |
| ADR-045 | Persona and Preference Learning | Proposed | Intelligence | ADR-044 | ADR-052 |
| ADR-046 | Recommendation and Next-Best-Action Engine | Proposed | Intelligence | ADR-044; ADR-045 | ADR-047 |
| ADR-047 | Sales Intelligence and Opportunity Scoring | Proposed | Intelligence | ADR-044; ADR-046 | ADR-046 |
| ADR-048 | Communication Personalization | Proposed | Intelligence | ADR-045; ADR-030 | ADR-050 |
| ADR-049 | Meeting Preparation and Briefing | Proposed | Intelligence | ADR-032; ADR-038; ADR-040 | ADR-048 |
| ADR-050 | Autonomous Action Execution | Proposed | Intelligence | ADR-030; ADR-027 | ADR-046 |
| ADR-051 | Feedback Loop and Continuous Improvement | Proposed | Intelligence | ADR-045; ADR-046 | ADR-082 |
| ADR-052 | Bias and Fairness Controls | Proposed | Intelligence | ADR-045 | ADR-062 |
| ADR-053 | Identity and Access Management | Accepted | Security | ADR-001 | ADR-056 |
| ADR-054 | Multi-Tenancy Model | Accepted | Security | ADR-012 | ADR-055 |
| ADR-055 | Tenant Isolation and Data Segregation | Accepted | Security | ADR-054 | ADR-056 |
| ADR-056 | Tenant-Scoped Roles and Permissions | Accepted | Security | ADR-053; ADR-054 | ADR-011 |
| ADR-057 | Secret and Credential Management | Proposed | Security | ADR-053 | ADR-058 |
| ADR-058 | Data Encryption at Rest and In Transit | Accepted | Security | ADR-057 | ADR-054 |
| ADR-059 | Audit Logging and Non-Repudiation | Accepted | Security | ADR-054 | ADR-069 |
| ADR-060 | API Rate Limiting and Abuse Prevention | Accepted | Security | ADR-015; ADR-011 | ADR-042 |
| ADR-061 | Vulnerability and Dependency Management | Accepted | Security | ADR-001 | ADR-068 |
| ADR-062 | AI Safety and Output Filtering | Accepted | Security | ADR-023 | ADR-063 |
| ADR-063 | Prompt Injection Defenses | Accepted | Security | ADR-062 | ADR-029 |
| ADR-064 | Data Residency and Region Strategy | Proposed | Security | ADR-054 | ADR-074 |
| ADR-065 | Backup, Disaster Recovery, and Retention | Proposed | Security | ADR-012; ADR-016 | ADR-070 |
| ADR-066 | Compliance Framework Alignment | Proposed | Security | ADR-054; ADR-059 | ADR-091 |
| ADR-067 | Privacy and Consent Management | Proposed | Security | ADR-054 | ADR-070 |
| ADR-068 | Penetration Testing and Red Teaming | Proposed | Security | ADR-061; ADR-062 | ADR-084 |
| ADR-069 | Incident Response and Security Operations | Proposed | Security | ADR-059; ADR-061 | ADR-077 |
| ADR-070 | Tenant Offboarding and Data Destruction | Proposed | Security | ADR-054; ADR-065 | ADR-067 |
| ADR-071 | Container and Packaging | Proposed | Platform | ADR-009 | ADR-072 |
| ADR-072 | Orchestration and Deployment Target | Proposed | Platform | ADR-071 | ADR-073 |
| ADR-073 | Infrastructure as Code | Proposed | Platform | ADR-072 | ADR-075 |
| ADR-074 | Cloud Provider and Region Strategy | Proposed | Platform | ADR-064 | ADR-079 |
| ADR-075 | CI/CD and Release Pipelines | Proposed | Platform | ADR-073 | ADR-085 |
| ADR-076 | Environment Strategy | Proposed | Platform | ADR-075 | ADR-080 |
| ADR-077 | Observability Stack | Proposed | Platform | ADR-001; ADR-035 | ADR-090 |
| ADR-078 | Secrets and Configuration Distribution | Proposed | Platform | ADR-057; ADR-073 | ADR-058 |
| ADR-079 | Cost and Capacity Management | Proposed | Platform | ADR-074 | ADR-024 |
| ADR-080 | Automated Testing Strategy | Accepted | Quality | ADR-009 | ADR-081; ADR-082; ADR-083; ADR-084 |
| ADR-081 | Contract and API Testing | Accepted | Quality | ADR-010; ADR-080 | ADR-086 |
| ADR-082 | AI and Agent Evaluation Framework | Accepted | Quality | ADR-025; ADR-029; ADR-080 | ADR-035 |
| ADR-083 | End-to-End and UI Testing | Accepted | Quality | ADR-008; ADR-080 | ADR-081 |
| ADR-084 | Security and Adversarial Testing | Proposed | Quality | ADR-061; ADR-080; ADR-082 | ADR-068 |
| ADR-085 | ADR Governance Process | Accepted | Governance | ADR-001 | ADR-086; ADR-092 |
| ADR-086 | API and Schema Governance | Accepted | Governance | ADR-003; ADR-085 | ADR-089 |
| ADR-087 | Code and Repository Governance | Accepted | Governance | ADR-085 | ADR-075 |
| ADR-088 | AI Model and Prompt Governance | Proposed | Governance | ADR-085; ADR-035 | ADR-034 |
| ADR-089 | Release and Versioning Governance | Accepted | Governance | ADR-086 | ADR-094 |
| ADR-090 | Observability and SLO Governance | Accepted | Governance | ADR-077; ADR-085 | ADR-090 |
| ADR-091 | Security and Compliance Governance | Accepted | Governance | ADR-085; ADR-066 | ADR-091 |
| ADR-092 | Documentation and Runbook Governance | Accepted | Governance | ADR-085 | ADR-092 |
| ADR-093 | Third-Party and Vendor Governance | Proposed | Governance | ADR-023; ADR-041; ADR-085 | ADR-094 |
| ADR-094 | Lifecycle and Deprecation Governance | Accepted | Governance | ADR-089 | ADR-093 |
| ADR-095 | Release Strategy | Accepted | Release | ADR-075; ADR-089 | ADR-076 |
| ADR-111 | Conversation & Response Bounded Context Boundary | Proposed | Conversation / Outreach | ADR-006; ADR-021 | ADR-112; ADR-114 |
| ADR-112 | Reply Ingress Port and Stub Strategy | Proposed | Conversation / Integration | ADR-111 | ADR-114 |
| ADR-113 | Intent Classification Autonomy and Human Escalation | Proposed | Conversation / AI Control Plane | ADR-029; ADR-030 | ADR-115 |
| ADR-114 | Temporal Signal Ownership for Inbound Replies | Proposed | Workflow / Conversation | ADR-018; ADR-021; ADR-111 | ADR-115 |
| ADR-115 | Deterministic Feedback Loop for Outreach Outcomes | Proposed | Conversation / Intelligence | ADR-046; ADR-051 | ADR-116 |
| ADR-116 | Persistence Deferral for Phase 13 | Proposed | Data / Infrastructure | ADR-012; ADR-020 | ADR-111 |