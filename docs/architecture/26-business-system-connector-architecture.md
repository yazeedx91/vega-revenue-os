# Business-System Connector Architecture

## Purpose

Generalize integration with external business systems — ERP, CRM, industrial/customer-centric applications, and custom business applications — behind a single, capability-based abstraction. Microsoft Dynamics 365 is the **first connector**, not the architectural center. See `ADR-125` for the formal decision record.

## Relationship Chain

```
Canonical Domain
   → IBusinessSystemConnector
   → Provider Connector
   → Customer System
```

Examples:

| Canonical Domain | IBusinessSystemConnector | Provider Connector | Customer System |
|---|---|---|---|
| Company, Contact, Lead, Opportunity | IBusinessSystemConnector | Dynamics365Connector | Dynamics 365 / Dataverse |
| Company, Contact, Lead, Opportunity | IBusinessSystemConnector | SalesforceConnector | Salesforce |
| Company, Contact, Lead, Opportunity | IBusinessSystemConnector | SAPConnector | SAP |
| Company, Contact, Lead, Opportunity, Evidence, BuyingSignal | IBusinessSystemConnector | CustomIndustrialConnector | Customer's proprietary application |

Only `Dynamics365Connector` (via its read-only intelligence slice, `DynamicsIntelligenceAdapterStub`) exists today. Salesforce, SAP, and custom industrial connectors are **not implemented** — this document defines the target shape for when they are approved.

## Capability Model

`IBusinessSystemConnector` exposes business **capabilities**, not vendor-specific APIs:

- `searchAccounts`, `getAccount`
- `searchContacts`, `getContact`
- `createLead`, `updateLead`
- `getOpportunity`
- `createActivity`
- `getCustomer`
- `searchBusinessEvents`
- `getOperationalSignals`

A connector is not required to implement every capability. A custom industrial application connector, for example, may support `getOperationalSignals` and `searchBusinessEvents` without supporting `createLead` or `updateLead` at all.

## Capability Discovery

Each connector declares a descriptor, queryable before invocation:

```
{
  provider: string;              // e.g. "dynamics365", "salesforce", "custom-industrial"
  systemType: 'CRM' | 'ERP' | 'INDUSTRIAL' | 'CUSTOM';
  version: string;
  capabilities: string[];        // subset of the capability model above
  readableEntities: string[];
  writableEntities: string[];
  authenticationModel: 'OAUTH2_SERVICE_PRINCIPAL' | 'API_KEY' | 'CUSTOM';
  eventSupport: boolean;
  webhookSupport: boolean;
  rateLimits: { requestsPerMinute?: number; burstLimit?: number };
  tenantConfiguration: Record<string, unknown>;
}
```

Callers (e.g. `ResearchEngine`, a future CRM sync service) inspect the descriptor before calling a capability, rather than assuming universal support.

## Canonical Domain Mapping (unchanged from existing ACL docs)

The core domain remains provider-neutral: `Company`, `Contact`, `Lead`, `Opportunity`, `Activity`, `Meeting`, `Evidence`, `BuyingSignal`. See `docs/domain/17-external-system-boundaries.md` and `docs/domain/18-anti-corruption-layers.md` for the existing ACL mapping tables, which already describe Dynamics 365 as one bounded-context integration among several (Graph, Zoom, email, research providers).

## Dynamics 365 Connector Mapping (first connector)

| Capability | Dynamics 365 / Dataverse Entity |
|---|---|
| searchAccounts / getAccount | Account |
| searchContacts / getContact | Contact |
| createLead / updateLead | Lead |
| getOpportunity | Opportunity |
| createActivity | Task / PhoneCall / Email |
| getCustomer | Account / Contact (context-dependent) |

Today, only the read-side intelligence slice exists: `IBusinessSystemIntelligenceAdapter.findAccounts`, `findContacts`, `findDuplicateAccount`, `findDuplicateContact`, implemented by `DynamicsIntelligenceAdapterStub` (in-memory, no live API calls). This corresponds to `searchAccounts`/`searchContacts` plus duplicate-detection support logic — a strict subset of the full `IBusinessSystemConnector` capability set.

## Industrial Application Integration Model

Assets, operational events, service records, maintenance events, and production signals from industrial/customer-centric applications enter the intelligence architecture through the **existing** Evidence/Signal pipeline:

```
CustomIndustrialConnector.searchBusinessEvents() / getOperationalSignals()
        ↓ (raw vendor payload — never stored in core aggregates)
Normalization (analogous to IResearchProvider.detectSignals)
        ↓
BuyingSignal / ResearchEvidence (existing domain value objects)
        ↓
ResearchEngine scoring (ICPScorer, SignalScorer, LeadScorer — unchanged)
```

No new core domain aggregate is introduced for industrial data. This reuses `packages/intelligence`'s existing evidence/signal model, keeping operational data provider-neutral and preventing contamination of the revenue core with industrial-system-specific concepts.

## Dependency Direction

```
packages/intelligence  →  IBusinessSystemIntelligenceAdapter (read-side port)
packages/domain        →  no dependency on any connector or business-system concept
packages/outreach, conversation, mission-orchestrator, application, ai-runtime
                        →  no dependency on any connector or business-system concept
```

This dependency direction is unchanged by this document — it was already correct prior to Phase 13.5. The only prior violation was naming (`IDynamicsIntelligenceAdapter`), corrected per `ADR-125`.

## Deferred Scope (explicitly not built in Phase 13.5)

- `packages/business-systems` package (registry, capability discovery runtime, connector base classes)
- `SalesforceConnector`, `SAPConnector`, `CustomIndustrialConnector` implementations
- Full `IBusinessSystemConnector` (write-side: `createLead`, `updateLead`, `createActivity`, `getOpportunity`, `getCustomer`)
- Live Dynamics 365 Web API / Dataverse calls, OAuth flows
- Microsoft Graph integration (tracked separately under Phase 14)

## Open Business Question

Whether go-to-market positioning (`docs/business/04-target-markets.md`) should be updated to reflect "Dynamics as first connector" versus remaining Dynamics-partner-centric is a business decision, not resolved by this architecture document.
