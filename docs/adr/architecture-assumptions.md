# Architecture Assumptions

1. The product will be delivered as a multi-tenant SaaS with enterprise-grade isolation.
2. AI/LLM services are consumed via external providers initially; self-hosting is a future option.
3. The primary integration target is Dynamics 365, but the domain model must remain provider-agnostic.
4. Workloads are mostly asynchronous; real-time synchronous interactions are limited to UI queries.
5. The organization will adopt open standards (OAuth2, OpenAPI, OpenTelemetry, TLS, JSON Schema).
6. Observability and auditability are non-negotiable for customer trust and compliance.
