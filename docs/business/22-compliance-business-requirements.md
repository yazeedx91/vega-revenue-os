# Compliance Business Requirements

## Privacy

- Collect and process only data necessary for the mission
- Provide transparency about data sources and use
- Support data subject access requests where applicable
- Enable right-to-delete or right-to-erasure
- Mask or tokenize PII where possible

## Data Protection

- Encrypt data in transit and at rest
- Use tenant-isolated storage and schemas
- Enforce role-based and tenant-scoped access
- Maintain audit logs of all data access

## Consent

- Capture and record consent for communication where required
- Allow consent to be withdrawn
- Do not contact prospects without legal basis
- Mark consent status per contact

## Opt-Out

- Honor opt-out requests immediately
- Maintain a per-tenant suppression list
- Do not attempt outreach to opted-out contacts
- Track opt-out method and date

## Suppression

- Allow customer-defined suppression lists
- Prevent outreach to competitors, existing customers if configured, and blacklisted domains
- Log suppression decisions

## Data Retention

- Apply customer-configured retention policies
- Delete or anonymize data after retention period
- Retain audit logs for required period
- Support export before deletion

## Auditability

- Log all AI decisions and actions
- Record human approvals and overrides
- Maintain an immutable audit trail per tenant
- Support compliance reporting

## Human Oversight

- Require human approval for high-risk actions
- Allow human override at any time
- Provide emergency stop capability
- Enable suspension of agents or missions

## Autonomous Communication

- AI may only communicate within configured policies
- All outbound messages must be auditable
- High-risk communication requires approval
- AI may not make contractual or pricing commitments

## Third-Party Integrations

- Use approved providers only
- Maintain exit plans per integration
- Enforce provider rate limits and terms of service
- Monitor third-party data handling

## Saudi Arabia Context

- Initial deployment context is Saudi Arabia
- Jurisdiction-specific legal review is required for final compliance design
- See `/docs/business/26-business-assumptions.md` and `/docs/business/27-business-constraints.md` for tracked items

## Items Requiring Legal Review

- Final consent and opt-out design for Saudi Arabia
- Data residency and cross-border transfer
- PII handling for researched contacts
- Recorded communication retention
- AI-generated content liability
