# Production Deployment Topology

## High-Level Topology

```mermaid
graph TD
    Internet --> FD[Azure Front Door + WAF]
    FD --> APIM[Azure API Management]
    APIM --> VNet[Azure Virtual Network]
    VNet --> ACA[Azure Container Apps Environment]

    ACA --> API[NestJS API / Modular Monolith]
    ACA --> Workers[Background Workers]
    ACA --> AIWorkers[AI Execution Workers]
    ACA --> Temporal[Temporal Workers]
    ACA --> Gateways[Integration Gateways]

    API & Workers & AIWorkers & Temporal & Gateways --> SB[Azure Service Bus Premium]
    API & Workers & AIWorkers --> Postgres[(Azure PostgreSQL + pgvector)]
    API & Workers & AIWorkers --> Redis[(Azure Managed Redis)]
    API & Workers --> KV[Azure Key Vault]
    API & Workers --> Blob[Azure Blob Storage]
    API & Workers --> AppInsights[Azure Monitor / App Insights]

    AIWorkers --> LLMGW[LLM Gateway]
    LLMGW --> AzureOpenAI[Azure OpenAI]
    LLMGW --> OpenAI[OpenAI]
    LLMGW --> Anthropic[Anthropic]

    Gateways --> D365[Microsoft Dynamics 365]
    Gateways --> Graph[Microsoft Graph]
    Gateways --> Email[Email Provider]
    Gateways --> Calendar[Calendar/Meeting Provider]
    Gateways --> Search[Research Provider]

    VNet --> PE_Postgres[Private Endpoint PostgreSQL]
    VNet --> PE_Redis[Private Endpoint Azure Managed Redis]
    VNet --> PE_KV[Private Endpoint Key Vault]
    VNet --> PE_SB[Private Endpoint Service Bus]
    VNet --> PE_Blob[Private Endpoint Blob]

    DevOps[GitHub Actions] --> ACR[Azure Container Registry]
    DevOps --> Bicep[Bicep IaC]
    Bicep --> Azure[Azure Resources]
```

## Network Zones

| Zone | Components |
|---|---|
| Public edge | Azure Front Door, WAF, API Management external endpoint |
| Application subnet | Container Apps Environment, private endpoints |
| Data subnet | PostgreSQL, Redis, Service Bus, Blob, Key Vault private endpoints |
| Management subnet | Jump boxes, bastion, monitoring |

## Compute Layout

| Workload | Container App | Scaling |
|---|---|---|
| API | `api` | HTTP concurrency + CPU |
| Background workers | `bg-workers` | Service Bus queue depth |
| AI execution workers | `ai-workers` | Service Bus queue depth + CPU |
| Temporal workers | `temporal-workers` | Service Bus/Temporal task queue depth |
| CRM adapter | `crm-adapter` | HTTP + queue |
| Email gateway | `email-gateway` | Queue |
| Calendar gateway | `calendar-gateway` | Queue |

## Data Layer

- **Azure Database for PostgreSQL Flexible Server**: transactional + vector.
- **Azure Managed Redis**: caching, locks, rate limits, sessions.
- **Azure Service Bus Premium**: commands and domain events.
- **Azure Blob Storage**: object storage and archives.
- **Azure Key Vault**: secrets and certificates.

## External Providers

- Microsoft Dynamics 365 (Dataverse)
- Microsoft Graph
- Azure OpenAI / OpenAI / Anthropic
- Bing Search API / Azure AI Search
- Azure Communication Services Email / SendGrid
- Zoom / Google Calendar / Google Meet

## Observability

- OpenTelemetry Collector sidecar or in-process SDK.
- Application Insights for traces and metrics.
- Log Analytics for logs.
- Azure Monitor Alerts.
- Azure Workbooks / Grafana dashboards.

## Security Controls

- TLS 1.3 everywhere.
- Private endpoints for all data services.
- Managed Identities for service-to-service auth.
- WAF rules on Front Door and Application Gateway.
- NSGs between subnets.
- DDoS Protection Standard.

## Deployment Topology Notes

- Azure Container Apps is the initial compute platform.
- Temporal worker and server placement on ACA is a candidate only; Phase 07 must validate the full Temporal operational topology (frontend, history, matching, persistence, visibility, HA, networking, DR) before committing to ACA.
- AKS path documented for scale or advanced networking needs.
- Multi-region DR topology documented separately.
