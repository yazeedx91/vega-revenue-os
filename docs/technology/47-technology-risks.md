# Technology Risks

## Risk Register

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R-TECH-001 | Azure regional service limitations or quotas block deployment | Medium | High | Multi-region planning, fallback regions, quota requests, vendor engagement | Cloud Architect |
| R-TECH-002 | Azure OpenAI quota or content filter issues degrade AI capabilities | Medium | High | Fallback providers (OpenAI, Anthropic), model routing, usage monitoring | AI Infrastructure Architect |
| R-TECH-003 | Azure Container Apps operational limits force premature AKS migration | Medium | Medium | Design for portability, document AKS path, keep workloads containerized | Platform Architect |
| R-TECH-004 | pgvector performance insufficient at scale | Medium | High | Add Azure AI Search as hybrid retrieval layer, benchmark early | Data Architect |
| R-TECH-005 | Temporal-on-Azure topology not validated for production (ACA vs AKS, persistence, visibility, HA, DR) | Medium | High | Complete Phase 07 validation checklist for frontend/history/matching/workers/persistence/visibility/HA/networking/DR; choose ACA or AKS based on evidence, not default | SRE |
| R-TECH-006 | TypeScript AI ecosystem gaps require Python bridges | Medium | Medium | Isolate Python workloads behind boundaries, document as Proposed ADR | Principal Software Architect |
| R-TECH-007 | Entra ID customer tenant onboarding friction | Medium | Medium | Onboarding automation, clear consent procedures, documentation | Security Architect |
| R-TECH-008 | Service Bus cost or throughput limits | Medium | Medium | Capacity planning, partitioning, premium SKU, monitor usage | Distributed Systems Engineer |
| R-TECH-009 | Vendor lock-in despite abstraction layers | Low | Medium | Adapters/gateways, portable containers, avoid proprietary APIs in domain | Principal Software Architect |
| R-TECH-010 | Bicep limitations for advanced resources | Low | Medium | Fallback to Terraform for specific resources, modularize IaC | DevOps Architect |
| R-TECH-011 | CI/CD secrets or OIDC misconfiguration | Medium | Critical | Least-privilege OIDC, branch protection, secret scanning, audit | Security Architect |
| R-TECH-012 | DR targets not achievable with chosen stack | Medium | High | Validate RPO/RTO, test failover, adjust targets or architecture | SRE |
| R-TECH-013 | Cost overruns from AI token usage or managed services | Medium | Medium | Budgets, alerts, autoscaling limits, cost attribution, regular review | AI Platform Engineer |
| R-TECH-014 | Integration test environment drift from production | Medium | Medium | IaC per environment, automated environment provisioning, smoke tests | DevOps Architect |
| R-TECH-015 | Unvalidated performance targets become constraints | Medium | Medium | Mark all targets PROPOSED, measure in staging, revise | Staff Backend Engineer |
| R-TECH-016 | Azure Managed Redis unavailable or feature-incomplete in target region | Medium | High | Confirm regional availability early; retain Azure Cache for Redis as fallback migration path; validate active-geo and clustering requirements | Cloud Architect / Data Architect |

## Risk Treatment

| Strategy | Risks |
|---|---|
| Avoid | R-TECH-011 (misconfig) via guardrails |
| Mitigate | R-TECH-001 to R-TECH-016 |
| Transfer | R-TECH-012 partly via Azure SLAs |
| Accept | Residual risk after controls; monitored |

## Monitoring

- Monthly technology risk review during early phases.
- Leading indicators: quota utilization, costs, error rates, latency, deployment frequency, incident counts.
