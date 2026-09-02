# Business Constraints

## Business Constraints

- Platform is sold to Dynamics 365 service providers, not directly to end prospects
- No validated pricing or commercial numbers
- Initial deployment context is Saudi Arabia but must support future regions
- Dynamics 365 is the first specialization, not the only one

## Product Constraints

- No application code in Phase 02
- No API or agent implementation in Phase 02
- Domain concepts must remain provider-neutral
- ICP must be fully configurable per tenant
- Commercial model is a hypothesis, not a decision

## Operational Constraints

- Human approval required for high-risk actions
- AI cannot commit to pricing or contracts
- AI cannot bypass compliance or security policies
- All AI actions must be auditable
- Multi-tenancy requires tenant-scoped data and roles

## Regulatory Constraints

- Saudi Arabia initial context; legal review required for final compliance
- Consent and opt-out requirements vary by jurisdiction
- Data residency requirements may apply
- PII must be handled per privacy requirements

## Data Constraints

- Prospect data must have source and date
- Required evidence needed for ICP signals
- Data retention per tenant policy
- No cross-tenant data access

## Integration Constraints

- Microsoft Dynamics 365 is the first CRM adapter
- Microsoft Graph and Zoom/Meet are initial providers
- All integrations behind provider-neutral adapter layer
- Rate limits and terms of service must be respected

## Financial Constraints

- No validated price points
- No validated margins
- All revenue model data is assumption-based
- Cost drivers include AI, data, and infrastructure

## AI Constraints

- AI must provide confidence scores
- AI must cite sources for factual claims
- AI must respect autonomy levels
- AI must escalate low-confidence or high-risk decisions
- AI output must be validated where required

## Human Constraints

- Human availability for approvals and escalations
- Human review required for sensitive or compliance-critical actions
- Human override always available

## Missing Product Constitution

The absence of a Product Constitution is a planning constraint. Business architecture does not invent project-wide principles but defers them to the constitution when available.
