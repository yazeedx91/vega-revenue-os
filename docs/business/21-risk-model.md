# Risk Model

## Risk Categories

### Data and Research Risks

| Risk | Probability | Impact | Detection | Mitigation | Owner | Residual Risk |
|---|---|---|---|---|---|---|
| Bad leads | Medium | Medium | ICP score, research confidence | ICP tuning, source validation, human review | Revenue Manager | Medium |
| False positives | Medium | High | Qualification review, outcome tracking | Confidence thresholds, multi-signal scoring | AI Governance | Medium |
| False negatives | Medium | Medium | Missed opportunity analysis | Lower thresholds for discovery, audit | Revenue Manager | Medium |
| Hallucinated information | Medium | High | Source citations, fact checks, red team | Structured output, source validation, human approval | AI Governance | Low |
| Data quality | High | Medium | Data quality scores | Data validation, enrichment, deduplication | RevOps | Medium |

### Outreach and Engagement Risks

| Risk | Probability | Impact | Detection | Mitigation | Owner | Residual Risk |
|---|---|---|---|---|---|---|
| Poor personalization | High | Medium | Personalization quality scores | Templates, research, A/B testing | Revenue Manager | Medium |
| Wrong decision-maker | Medium | High | Decision-maker mapping review | Contact validation, human approval | Sales Manager | Medium |
| Incorrect claims | Medium | High | AI accuracy review, complaints | Fact validation, source citations, approval gates | Compliance | Low |
| Unwanted outreach | Medium | High | Opt-out rate, complaints | Suppression, opt-out, consent, ICP filters | Compliance | Low |
| Spam | Low | High | Complaints, email reputation | Rate limits, quality thresholds, human oversight | Compliance | Low |
| Low response quality | High | Medium | Reply quality scoring | Conversation management, prompts, red teaming | AI Governance | Medium |

### Meeting and Pipeline Risks

| Risk | Probability | Impact | Detection | Mitigation | Owner | Residual Risk |
|---|---|---|---|---|---|---|
| Low meeting quality | Medium | High | Post-meeting qualification | Better qualification, human review | Sales Manager | Medium |
| Poor qualification | Medium | High | Conversion tracking | Qualification rules, human approval | Revenue Manager | Medium |
| Calendar failures | Medium | Medium | Scheduling error logs | Provider redundancy, retry, human fallback | RevOps | Low |
| CRM synchronization failures | Medium | High | Sync error logs, data mismatch | Idempotent writes, validation, retry | RevOps | Low |

### AI and Autonomy Risks

| Risk | Probability | Impact | Detection | Mitigation | Owner | Residual Risk |
|---|---|---|---|---|---|---|
| AI over-autonomy | Medium | High | Audit logs, exception rate | Autonomy levels, approval gates, policies | AI Governance | Low |
| Customer misuse | Low | High | Activity monitoring, abuse detection | Acceptable use policy, rate limits, suspend | Compliance | Low |

### Business and Vendor Risks

| Risk | Probability | Impact | Detection | Mitigation | Owner | Residual Risk |
|---|---|---|---|---|---|---|
| Vendor dependency | Medium | Medium | Provider health | Multi-provider, exit plans, abstraction | Architecture | Medium |
| API dependency | Medium | High | Provider changes, downtime | Rate limiting, retries, fallback | RevOps | Medium |
| Cost explosion | Medium | High | Cost dashboards, budgets | Budgets, model routing, credits | Finance | Medium |
| Reputation damage | Low | High | Complaints, social signals | Quality gates, compliance, human oversight | CEO | Low |

## Risk Monitoring

- Weekly risk review during early operation
- Automated alerts for high-impact risks
- Quarterly risk register updates
- Incident-based risk re-evaluation
