# Container Architecture

## Primary Runtime Containers

| Container | Responsibility | Runtime Style | Scaling |
|---|---|---|---|
| API Gateway | External API routing, auth, rate limiting, tenant routing | Gateway / Reverse proxy | Horizontal |
| Identity Service | Authentication, token issuance, claims | Service or external IdP | Horizontal |
| Tenant Management Service | Tenant lifecycle, configuration, onboarding | Service | Horizontal |
| User Management Service | Users, roles, tenant memberships | Service | Horizontal |
| Mission Management Service | Mission lifecycle, planning, orchestration | Service / modular component | Horizontal |
| Agent Management Service | Agent registry, capabilities, versions | Service | Horizontal |
| AI Execution Workers | Execute agent tasks, LLM calls, tool calls | Worker pool | Horizontal |
| AI Governance Service | Policy evaluation, autonomy, approvals | Service | Horizontal |
| ICP & Intelligence Service | ICP management, company/contact research | Service + workers | Horizontal |
| Outreach Service | Message generation, delivery coordination | Service + workers | Horizontal |
| Conversation Service | Reply handling, state, qualification | Service + workers | Horizontal |
| Meeting Service | Scheduling, availability, meetings | Service | Horizontal |
| CRM Integration Service | Dynamics 365 adapter, sync | Service + workers | Horizontal |
| Knowledge & Memory Service | Retrieval, storage, indexing | Service | Horizontal |
| Revenue Analytics Service | Read models, dashboards, reports | Service | Horizontal |
| Audit Service | Audit log ingestion, immutability | Service | Horizontal |
| Billing Service | Usage metering, subscription status | Service | Horizontal |
| Integration Gateway | External provider adapters, retries | Gateway/service | Horizontal |
| Workflow Engine | Durable workflows, timers, checkpoints | Service/worker | Horizontal |
| Scheduler | Cron, delayed tasks, job scheduling | Worker | Horizontal |
| Event Bus | Durable events, topics, queues | Managed infrastructure | Managed |

## Initial Deployment Grouping

### Group A — Core Business Application

- Tenant Management
- User Management
- Mission Management
- Agent Management (registry)
- AI Governance (policy evaluation, approvals)
- ICP & Intelligence
- Outreach
- Conversation
- Meeting
- CRM Integration
- Billing
- Audit

These run within a single deployable unit (modular monolith) in the initial stage, communicating in-process or via events. Each module retains its own domain boundary and data ownership.

### Group B — AI Execution Plane

- AI Execution Workers
- LLM Gateway
- Tool Execution
- Knowledge & Memory retrieval
- Context assembly

Runs as a separate worker pool to allow independent scaling of AI workload.

### Group C — Analytics & Observability

- Revenue Analytics Service
- Audit ingestion
- Metrics/traces/logs collectors

Runs as separate consumers to isolate read-only workloads.

### Group D — Infrastructure

- API Gateway
- Event Bus
- Workflow Engine
- Scheduler
- Cache
- Databases
- Object Storage
- Identity Provider integration

## Container Diagram

```mermaid
graph TB
    Client[Browser / Mobile / External Client]
    GW[API Gateway]
    IdP[Identity Provider]

    subgraph Core Application
        TM[Tenant Management]
        UM[User Management]
        MM[Mission Management]
        AM[Agent Management]
        AG[AI Governance]
        ICP[ICP & Intelligence]
        OM[Outreach]
        CM[Conversation]
        MS[Meeting Service]
        CRM[CRM Integration]
        BI[Billing]
        AU[Audit]
    end

    subgraph AI Plane
        EW[AI Execution Workers]
        LG[LLM Gateway]
        TE[Tool Execution]
        KM[Knowledge & Memory]
    end

    subgraph Analytics
        AN[Revenue Analytics]
        AUD[Audit Ingestion]
    end

    subgraph Infrastructure
        EB[Event Bus]
        WF[Workflow Engine]
        SCH[Scheduler]
        DB[(Operational DB)]
        VS[(Vector Store)]
        CACHE[(Cache)]
        OS[(Object Storage)]
    end

    Client --> GW
    GW --> IdP
    GW --> TM & UM & MM & AG & ICP & OM & CM & MS & CRM & BI
    MM --> EB
    AG --> EB
    OM --> EB
    CM --> EB
    MS --> EB
    CRM --> EB
    EB --> EW
    EW --> LG
    EW --> TE
    EW --> KM
    EW --> DB
    EW --> VS
    EW --> CACHE
    EB --> AN
    EB --> AUD
    MM --> WF
    WF --> SCH
    Core Application --> DB
    Core Application --> CACHE
    AI Plane --> OS
```

## Container Design Rules

- Containers depend on published contracts, not internal implementation.
- Core application modules can be extracted into separate services without domain changes.
- AI execution plane is separate from control plane.
- Analytics never writes to operational stores.
- Infrastructure services are replaceable (e.g., swap message broker) behind abstraction.
