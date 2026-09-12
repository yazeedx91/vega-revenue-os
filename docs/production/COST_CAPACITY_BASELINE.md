# ProjectX Cost & Capacity Baseline

This is an infrastructure inventory, not a pricing quote. The operator must size and price each item for the chosen Azure region.

## Compute

| Component | Azure Service | Sizing Drivers | Operator Decision |
|-----------|---------------|----------------|-------------------|
| API | Container App | concurrent HTTP connections, webhook load | CPU/memory, scale rules |
| Temporal Worker | Container App / Job | task queue throughput | replica count, CPU/memory |
| Temporal (self-hosted) | AKS / VMs or Temporal Cloud | workflow history, workflow count | cluster size or SaaS plan |

## Data

| Component | Azure Service | Capacity Notes |
|-----------|---------------|----------------|
| Application DB | PostgreSQL Flexible Server | pgvector; start at least 4 vCore; scale by tenant/data growth |
| Cache/locks | Azure Cache for Redis | Premium with SSL and private endpoint |
| Blobs/backups | Azure Storage / Backup | geo-redundant for DR |

## Network & Security

| Component | Azure Service | Notes |
|-----------|---------------|-------|
| Ingress | Container App managed domain + custom domain or Application Gateway | TLS, WAF |
| Private connectivity | VNet + private endpoints + private DNS | Required for DB, Redis, Key Vault |
| Secrets | Azure Key Vault | Premium recommended for private endpoint |
| Registry | Azure Container Registry | Premium for private endpoint and geo-replication |

## External Provider Usage

| Provider | Metering | Control |
|----------|----------|---------|
| OpenAI / Azure OpenAI | Tokens per request | cost limits, model routing |
| Embedding | Requests + tokens | active profile, dimensions |
| Microsoft Graph | API call volume | rate limits, batching |
| Dynamics | API call volume | bounded queries, caching |
| Temporal Cloud | Actions + storage | retention policy |

## Observability

| Component | Azure Service | Notes |
|-----------|---------------|-------|
| Logs | Log Analytics + Container App console | retention period drives cost |
| Metrics | Azure Monitor | alert rules |
| Tracing | Application Insights / OpenTelemetry | sampling rate |

## Decisions Pending from Operator

- Azure region(s) and data residency.
- Application Gateway vs. Container App managed domain.
- Self-hosted Temporal vs. Temporal Cloud.
- PostgreSQL tier and storage growth.
- Redis SKU.
- Retention periods for logs, Temporal history, and backups.
