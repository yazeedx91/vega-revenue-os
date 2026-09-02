# AI Architecture Risks

## Risk Register

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R-AI-001 | Orchestrator becomes a god-object, accumulating domain logic | Medium | High | Strict boundary: coordination only; no specialist logic; clear interfaces | AI Architect |
| R-AI-002 | Specialist agents gain excessive authority through capability creep | Medium | Critical | Capability registry, policy enforcement, regular audits | AI Safety Architect |
| R-AI-003 | LLM hallucination leads to unsupported outreach or decisions | High | High | Output validation, evidence requirements, claim verification, human approval | AI Safety Architect |
| R-AI-004 | Prompt injection via email/web content triggers unauthorized tool use | Medium | Critical | Tool output trust, input sanitization, policy enforcement, schema validation | Security Architect |
| R-AI-005 | Cross-tenant leakage through shared context or memory | Low | Critical | Tenant isolation at every layer, per-tenant retrieval, RLS | Security Architect |
| R-AI-006 | Memory poisoning corrupts future decisions | Medium | High | Memory write validation, anomaly detection, versioning, human correction | AI Safety Architect |
| R-AI-007 | Human approval latency stalls long-running missions | Medium | Medium | Timeouts, escalation paths, fallback to safer actions, autonomy levels | Revenue Automation Architect |
| R-AI-008 | Tool failures cascade into mission failure | Medium | High | Bulkheads, retries, fallback providers, compensation, graceful degradation | Distributed Systems Architect |
| R-AI-009 | Model/provider changes cause regressions | Medium | High | Model evaluation, A/B testing, version attribution, rollback | ML Systems Architect |
| R-AI-010 | Revenue attribution is inaccurate, leading to wrong learning signals | Medium | Medium | Conservative attribution, multiple models, human review of key assumptions | Revenue Automation Architect |
| R-AI-011 | Uncontrolled experimentation harms prospects or customers | Low | High | Experiment guardrails, policy, opt-out, emergency stop, human approval | AI Safety Architect |
| R-AI-012 | Cost overruns from runaway agent execution or context bloat | Medium | Medium | Token budgets, cost alerts, context compression, runaway detection | AI Operations |
| R-AI-013 | AI safety controls fail to keep pace with model capabilities | Medium | High | Continuous red teaming, monitoring, policy updates, human oversight | AI Safety Architect |
| R-AI-014 | Autonomous actions at high levels cause reputational or legal damage | Low | Critical | Action risk engine, approvals for critical actions, audit, emergency stop | Security Architect |
| R-AI-015 | Multi-agent communication becomes opaque and hard to debug | Medium | High | Structured messages, correlation IDs, traces, bounded conversation patterns | AI Systems Engineer |

## Risk Treatment

| Strategy | Risks |
|---|---|
| Avoid | R-AI-002 (capability creep), R-AI-014 (uncritical autonomous damage) |
| Mitigate | R-AI-001, R-AI-003, R-AI-004, R-AI-005, R-AI-006, R-AI-008, R-AI-009, R-AI-012, R-AI-013, R-AI-015 |
| Transfer | R-AI-010 (attribution model) — partly managed through analytics/audit |
| Accept | Residual risk after controls; monitored continuously |

## Monitoring

- Review risk register monthly during early phases.
- Update likelihood/impact after each evaluation cycle and incident.
- Track leading indicators: policy denials, hallucination flags, approval times, cost anomalies, safety alerts.
