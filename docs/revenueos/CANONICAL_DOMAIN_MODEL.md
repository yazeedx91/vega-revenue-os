# Canonical Commercial Domain Model

## Overview

The canonical commercial domain provides the foundational entities and relationships for Vega RevenueOS. This model builds on the existing ProjectX DDD architecture, reusing established patterns and extending them for industrial revenue intelligence.

## Domain Relationships

```
Account (Organization)
    ↓
Facility
    ↓
Contact
    ↓
Evidence → Claim
    ↓
Signal
    ↓
Opportunity
    ↓
Proposal → Pilot → Contract → Subscription/ARR → Expansion/Renewal
```

## Core Domain Entities

### Account (Organization)

**Existing ProjectX entity** - reused as the canonical company/organization concept.

The `Account` aggregate represents a target customer or partner organization. In RevenueOS, this serves as both the traditional "account" and the industrial "organization" concept.

**Key properties**:
- Identity: AccountId
- Workspace binding for multi-tenant isolation
- Company information: name, domain, industry, geography
- Size metrics: company size band, employee count, annual revenue
- Enrichment state and status
- Evidence references for data provenance

**RevenueOS extensions** (future phases):
- Industrial classification for asset types
- Geographic coverage for facilities
- Economic tier for opportunity prioritization

### Facility

**New minimal commercial aggregate** representing physical industrial sites.

**Phase A scope** (minimal foundation):
- Identity: FacilityId
- Parent Account (AccountId)
- Basic facility classification (type/category)
- Geographic location
- Status (active/inactive/etc.)
- Evidence references (EvidenceId[])
- Timestamps (createdAt, updatedAt)

**Deferred to Industrial Revenue Graph phase**:
- Asset classes and equipment inventory
- Production capacity and operational metrics
- Technical specifications and compatibility
- Performance and reliability data

### Contact

**Existing ProjectX entity** - reused without Phase A expansion.

The `Contact` aggregate represents people associated with accounts/facilities. Current commercial role metadata is preserved.

**Phase A scope**:
- No expansion unless required for compatibility
- Existing role, seniority, department, function fields
- Contact verification and consent status

**Deferred to later phases**:
- Buying-committee intelligence
- Decision-making authority mapping
- Relationship strength scoring

### Evidence

**Existing ProjectX entity** - `ResearchEvidence` reused without duplication.

The `ResearchEvidence` value object provides source-backed observations with provenance, confidence, and freshness tracking.

**Key properties**:
- Identity: EvidenceId
- Source and provenance tracking
- Confidence breakdown (source reliability, extraction confidence, corroboration)
- Observed timestamp and freshness expiry
- Evidence fingerprint for deduplication
- Contradiction tracking

**RevenueOS usage**:
- Evidence references are used across all commercial entities
- Supports fact/inference/assumption classification via Claim model
- Provides audit trail for commercial claims

### Claim

**New lightweight aggregate** for fact/inference/assumption classification.

**Structured fields** (no unbounded blobs):
- Identity: ClaimId
- Subject (what the claim is about - e.g., AccountId, FacilityId, OpportunityId)
- Reference (specific entity reference if applicable)
- Claim classification: FACT | INFERENCE | ASSUMPTION
- Statement/value (strongly typed claim content)
- Evidence IDs (EvidenceId[])
- Confidence (0-1)
- Timestamps (observedAt, createdAt, updatedAt)

**Purpose**:
- Classifies commercial assertions without duplicating Evidence
- Provides traceability from claims to supporting evidence
- Enables fact/inference/assumption distinction for truthfulness
- Supports auditability of commercial decisions

### Signal

**Existing ProjectX entity** - extended with extensible taxonomy mechanism.

**Existing categories** (preserved):
- Growth, Funding, Leadership, Technology, DigitalTransformation
- BusinessChange, PainIndicators, CompetitivePressure, IndustryTailwinds

**Phase A approach**:
- No hardcoded industrial categories
- Extensible subtype/taxonomy mechanism if needed (e.g., signalSubtype, customCategory)
- Maintain existing detection, expiration, retraction patterns

**Deferred to Phase B**:
- Industrial-specific signal taxonomy
- Asset-level signal detection
- Operational metric signals

### Opportunity

**New central commercial aggregate** representing revenue opportunities.

**Key properties**:
- Identity: OpportunityId
- Linked Account (Organization), Facilities, Contacts
- Evidence and claim references
- Problem hypothesis and Vega solution fit
- Estimated ACV, expected ARR, confidence
- Expansion potential, technical/commercial readiness
- Stakeholders, stage, next action, risks
- Previous opportunity reference (for win/loss analytics)

**Lifecycle**: Branching state graph (see Opportunity Lifecycle section)

**Purpose**:
- Central object for revenue opportunity management
- Links intelligence, evidence, and commercial progression
- Supports win/loss analytics and learning
- Enables historical context through previous opportunity references

### Proposal

**New minimal commercial aggregate** for commercial proposals.

**Phase A scope** (minimal foundation):
- Identity: ProposalId
- Linked Opportunity
- Basic pricing/pricing terms
- Status lifecycle
- Evidence references

**Deferred to later phases**:
- Proposal engine and workflow automation
- Detailed approval gates and versioning
- Template management and generation

### Pilot

**New minimal commercial aggregate** for technical/commercial pilots.

**Phase A scope** (minimal foundation):
- Identity: PilotId
- Linked Opportunity
- Basic success criteria
- Timeline (start/end)
- Status lifecycle
- Evidence references

**Deferred to later phases**:
- Pilot engine and execution workflows
- Detailed metrics and monitoring
- Conversion logic to contracts

### Contract

**New minimal commercial aggregate** for won commercial relationships.

**Phase A scope** (minimal foundation):
- Identity: ContractId
- Linked Opportunity/Proposal
- Basic terms (value, duration)
- Status lifecycle
- Evidence references

**Deferred to later phases**:
- Contract engine and legal workflows
- Detailed terms and conditions
- Integration with CRM systems

### Subscription

**New minimal commercial aggregate** for recurring revenue relationships.

**Phase A scope** (minimal foundation):
- Identity: SubscriptionId
- Linked Contract
- Basic recurring revenue terms
- Status lifecycle
- Evidence references

**Deferred to later phases**:
- ARR engine and billing workflows
- Expansion and renewal logic
- Churn analysis and prevention

## Value Objects

### MonetaryAmount

Currency-aware monetary values with non-negative validation.

**Properties**:
- Amount (non-negative)
- Currency code (ISO 4217)
- Validation for currency consistency

### RevenueMetrics

Revenue calculation primitives with currency consistency.

**Properties**:
- MRR (Monthly Recurring Revenue)
- ARR (Annual Recurring Revenue)
- ACV (Annual Contract Value)
- TCV (Total Contract Value)
- Currency consistency validation

### Probability

Confidence and probability values with [0,1] validation.

**Properties**:
- Value (0-1 range)
- Validation for probability bounds
- Support for confidence intervals

### EconomicValueInputs

Typed inputs for future Expected Revenue Value calculations.

**Properties**:
- Potential contract value
- Probability of success
- Retention value
- Expansion potential
- Acquisition/execution costs
- Delivery/risk adjustments

**Note**: Phase A provides structure only. The Expected Economic Value formula is not canonized in Phase A.

## Opportunity Lifecycle

The Opportunity lifecycle is modeled as a **branching state graph**, not a linear chain.

### Progression Branch

Forward movement through opportunity stages:
```
DISCOVERED → QUALIFYING → QUALIFIED → DISCOVERY → SOLUTION_DESIGN → 
PROPOSAL → PILOT → NEGOTIATION
```

### Outcome Branches

Alternative outcomes from the progression branch:
```
                              → WON (terminal, never reopen)
                              → LOST (terminal, never reopen)
                              → DISQUALIFIED (reversible with guard)
```

### Backward Transitions

Controlled reversals requiring justification/evidence:
- NEGOTIATION → PROPOSAL (terms renegotiated)
- PILOT → SOLUTION_DESIGN (pilot failed, redesign)
- SOLUTION_DESIGN → QUALIFIED (solution changed)
- QUALIFIED → QUALIFYING (new information)
- DISQUALIFIED → QUALIFYING (new evidence, reconsideration - **guarded transition**)

### Terminal States

- **WON**: True terminal state. If commercial interest returns, create a new Opportunity with reference to the previous one for historical context.
- **LOST**: True terminal state. If commercial interest returns, create a new Opportunity with reference to the previous one for historical context.

This preserves win/loss analytics, attribution, and RevenueOS learning.

### Reversible Non-Terminal State

- **DISQUALIFIED**: Reversible only through explicit guarded transition requiring justification/evidence.

## Future Phases

The following domain enhancements are deferred to future phases:

### Industrial Revenue Graph
- Asset classes and equipment inventory
- Production capacity and operational metrics
- Technical specifications and compatibility
- Performance and reliability data
- Facility-level economic modeling

### Account Twin
- Digital twin of customer accounts
- Real-time operational data integration
- Predictive maintenance alignment
- Opportunity triggering based on asset state

### Opportunity Twin
- Digital twin of revenue opportunities
- Real-time progression tracking
- Predictive win/loss modeling
- Automated next-action recommendations

### Vega Capability Graph
- Comprehensive capability catalog
- Evidence levels for each capability
- Solution fit validation
- Technical commitment verification

### Industrial Signal Fusion
- Industrial-specific signal taxonomy
- Asset-level signal detection
- Operational metric signals
- Multi-source signal correlation

### Chief Revenue Agent
- Strategic revenue orchestration
- Cross-opportunity coordination
- Portfolio optimization
- Resource allocation

### Mission Commander
- Mission planning and execution
- Agent coordination and supervision
- Policy enforcement
- Emergency response

### Proposal Engine
- Workflow automation
- Template management
- Approval routing
- Version control

### Pilot Engine
- Execution workflows
- Success tracking
- Conversion logic
- Risk monitoring

### ARR Engine
- Billing workflows
- Expansion and renewal logic
- Churn analysis
- Revenue forecasting

### Expansion / Renewal
- Automated expansion identification
- Renewal opportunity generation
- Cross-sell/upsell coordination
- Customer health monitoring

### Learning Engine
- Win/loss analysis
- Strategy optimization
- Signal effectiveness measurement
- Continuous improvement

### Revenue Genome
- Comprehensive revenue analytics
- Attribution modeling
- Performance benchmarking
- Predictive insights

### Revenue Simulation Lab
- Strategy simulation and testing
- What-if scenario modeling
- Risk assessment
- Decision support

### Buying-Committee Intelligence
- Decision-maker identification
- Influence mapping
- Engagement tracking
- Stakeholder analysis