# Context Map

```mermaid
graph LR
    subgraph Platform
        TM[Tenant & Organization Management]
        UM[User & Identity Management]
        BL[Billing & Subscription]
        AU[Audit & Governance]
        AN[Revenue Analytics]
    end

    subgraph Core
        MM[Revenue Mission Management]
        ICP[ICP & Market Strategy]
        CI[Company Intelligence]
        CO[Contact Intelligence]
        LQ[Lead & Qualification Management]
        BS[Buying Signal Intelligence]
        OP[Opportunity Management]
        OR[Outreach & Communication]
        CV[Conversation Management]
        MT[Meeting & Scheduling]
    end

    subgraph AI
        AG[AI Agent Management]
        KG[Knowledge Management]
        GP[AI Governance & Policy]
    end

    subgraph External
        CR[CRM Synchronization]
        CM[Compliance & Consent]
        EP[Email / LinkedIn Providers]
        ZM[Zoom / Calendar Providers]
        DY[Dynamics 365]
    end

    UM -->|Customer/Supplier| TM
    TM -->|Customer/Supplier| MM
    TM -->|Customer/Supplier| GP
    TM -->|Customer/Supplier| BL
    TM -->|Customer/Supplier| CM

    GP -->|Customer/Supplier| MM
    GP -->|Customer/Supplier| AG

    ICP -->|Customer/Supplier| CI
    ICP -->|Customer/Supplier| LQ

    CI -->|Customer/Supplier| BS
    CI -->|Customer/Supplier| CO
    CO -->|Customer/Supplier| LQ
    BS -->|Customer/Supplier| LQ

    LQ -->|Customer/Supplier| OR
    OR -->|Customer/Supplier| CV
    CV -->|Customer/Supplier| LQ
    CV -->|Customer/Supplier| MT

    MM -->|Customer/Supplier| AG
    MM -->|Customer/Supplier| CI
    MM -->|Customer/Supplier| LQ
    MM -->|Customer/Supplier| OP

    AG -->|Customer/Supplier| KG
    AG -->|Customer/Supplier| OR
    AG -->|Customer/Supplier| CI

    LQ -->|Customer/Supplier| OP
    MT -->|Customer/Supplier| OP
    OP -->|Customer/Supplier| CR
    MT -->|Customer/Supplier| CR

    OR -->|Anti-Corruption Layer| EP
    MT -->|Anti-Corruption Layer| ZM
    CR -->|Anti-Corruption Layer| DY

    MM -.->|Published Language| AU
    AG -.->|Published Language| AU
    OP -.->|Published Language| AU
    OR -.->|Published Language| AU
    MT -.->|Published Language| AU

    MM -.->|Domain Events| AN
    OP -.->|Domain Events| AN
    AG -.->|Domain Events| AN
    AU -.->|Read Models| AN

    CM -->|Policy Read Model| OR
    CM -->|Policy Read Model| LQ
```

## Relationship Patterns Used

| Relationship | Contexts | Rationale |
|---|---|---|
| Customer/Supplier | Mission Management → AI Agent Management | Mission requests executions; AI Agent Management provides execution outcomes |
| Customer/Supplier | ICP & Market Strategy → Company Intelligence | ICP defines matching rules; Company Intelligence consumes them |
| Customer/Supplier | Lead Management → Outreach & Communication | Lead provides qualified targets; Outreach performs communication |
| Anti-Corruption Layer | Outreach → Email/LinkedIn, Meeting → Calendar, CRM → Dynamics 365 | External provider models must not leak into core domain |
| Published Language | All contexts → Audit & Governance | Common audit event vocabulary |
| Open Host Service | Revenue Analytics | Read-only projections consumed by dashboards |

## Cross-Context Communication Patterns

| From Context | To Context | Pattern | Example |
|---|---|---|---|
| Revenue Mission Management | AI Agent Management | Command + Domain Events | ExecuteTask, AgentExecutionCompleted |
| AI Agent Management | Revenue Mission Management | Domain Events | AgentExecutionCompleted |
| Company Intelligence | Lead & Qualification | Domain Events | CompanyResearched |
| Lead & Qualification | Outreach & Communication | Domain Events | LeadQualified |
| Outreach & Communication | Conversation Management | Domain Events | OutreachSent |
| Conversation Management | Meeting & Scheduling | Commands/Events | RequestMeeting, MeetingBooked |
| Meeting & Scheduling | Opportunity Management | Domain Events | MeetingBooked |
| Opportunity Management | CRM Synchronization | Commands/Events | SyncOpportunityToCRM |
| AI Governance | AI Agent Management | Read Models / Policies | PolicyEvaluationResult |
| Compliance & Consent | Outreach & Communication | Read Models | SuppressionCheck |
