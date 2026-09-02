# Technology Selection Matrix

## Decision Criteria

| Criterion | Weight | Description |
|---|---|---|
| Azure suitability | High | Native integration, managed service quality, regional availability |
| DDD/framework fit | High | Supports modular architecture, DI, testing, OpenAPI |
| Tenant isolation | High | Technical enforcement of tenant boundaries |
| AI compatibility | High | LLM tooling, vector search, model routing support |
| Reliability/operations | High | Durability, scaling, observability, managed backups |
| Security | High | Identity, encryption, network isolation, audit |
| Cost efficiency | Medium | Managed vs self-hosted trade-offs |
| Vendor lock-in | Medium | Replaceability via adapters/gateways |
| Community/maturity | Medium | Ecosystem, documentation, hiring |
| Developer experience | Medium | Tooling, debugging, local development |

## Component Decisions

| Component | Recommended | Alternative A | Alternative B | Key Reason |
|---|---|---|---|---|
| Backend framework | NestJS | Fastify + custom DI | Express + custom | DDD, modularity, DI, OpenAPI, testing |
| Database | Azure PostgreSQL Flexible Server | Azure SQL | Azure Cosmos DB | ACID, RLS, pgvector, JSONB, open ecosystem |
| Cache | Azure Managed Redis | Azure Cache for Redis (legacy/migration) | Self-hosted Redis | Managed, active-geo, distributed locks, sessions |
| Event bus | Azure Service Bus Premium | Azure Event Hubs + Storage Queues | Kafka on AKS | DLQ, scheduled msgs, sessions, ordering |
| Workflow engine | Temporal | Azure Durable Functions | Cadence | Long-running, versioning, compensation, multi-tenant namespaces |
| Vector storage | PostgreSQL pgvector + Azure AI Search | Dedicated vector DB (Pinecone/Weaviate) | Azure AI Search only | pgvector avoids extra infra; AI Search for scale |
| LLM platform | Azure OpenAI | OpenAI | Anthropic | Enterprise controls, data handling, Azure integration |
| Agent runtime | Custom TypeScript | LangGraph/LangChain | Semantic Kernel | Domain architecture remains ours |
| Identity | Microsoft Entra ID | Auth0 | Okta | Enterprise integration, Dynamics ecosystem |
| IaC | Bicep | Terraform | Pulumi | Native Azure support, ARM integration |
| Container platform | Azure Container Apps | AKS | Azure Functions | Simpler ops, KEDA scaling, Dapr, cost |
| CI/CD | GitHub Actions | Azure DevOps | CircleCI | Widely adopted, ACR/ACA integration |
| Object storage | Azure Blob Storage | S3 via adapter | GCS via adapter | Native, durable, lifecycle |
| Observability | OpenTelemetry + Azure Monitor | Prometheus/Grafana | Datadog | Vendor-neutral instrumentation, Azure backend |

## Rejected Alternatives Summary

| Rejected | Reason |
|---|---|
| AWS/GCP as primary cloud | Violates hard organizational constraint; evaluated only as migration alternatives |
| Python/Go primary backend | Violates hard organizational constraint; allowed only for isolated specialized workloads |
| Azure Cosmos DB primary | No native vector support, RLS patterns less mature for relational domain model |
| Azure Durable Functions | Less flexible for multi-tenant compensation, replay observability, and agent-driven signals |
| LangGraph as architecture owner | Would control domain topology; use only as library for provider adapters |
| AKS from day one | Operational overhead not justified before proven scale |

## Confidence Levels

| Decision | Confidence | Notes |
|---|---|---|
| Azure + TypeScript | High | Hard constraints |
| NestJS | Medium-High | Team preference can adjust within TypeScript |
| PostgreSQL + pgvector | High | Fits domain and AI requirements |
| Azure Service Bus | High | Mature managed messaging |
| Temporal | Medium-High | Strong fit; confirm operational complexity on Azure |
| Azure Container Apps | Medium-High | Good initial fit; scale path to AKS documented |
| Azure OpenAI primary | High | Azure-first; fallback documented |
| Custom agent runtime | Medium | Requires building abstractions; domain ownership justified |
