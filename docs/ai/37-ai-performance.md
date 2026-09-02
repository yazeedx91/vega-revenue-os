# AI Performance

## Purpose

AI Performance measures how effectively and efficiently the AI architecture delivers business outcomes, not just model speed.

## Performance Dimensions

| Dimension | Metrics |
|---|---|
| Latency | Time to first token, end-to-end task latency, p50/p95/p99 |
| Throughput | Tasks completed per minute, messages sent per hour |
| Task completion | Success rate by agent/task type |
| Mission completion | Missions completed, failed, paused, awaiting approval |
| Tool success | External API success rate |
| Reasoning efficiency | Tokens per decision, iterations per task |
| Cost efficiency | Cost per task, cost per outcome |
| Conversion | Lead→meeting, meeting→opportunity, opportunity→revenue |
| Qualification accuracy | Precision/recall of lead qualification |
| CRM accuracy | Correctness of CRM updates |
| Meeting conversion | Meetings scheduled per outreach |
| Policy compliance | Denial/approval rates, safety violations |

## Performance Targets

| Metric | Target | Notes |
|---|---|---|
| Simple LLM call p95 | < 5s | Model-dependent |
| Complex reasoning p95 | < 30s | Multi-step tasks |
| Research task | < 2 minutes | May run in background |
| Outreach generation | < 10s | Draft approval path |
| Conversation reply | < 5s | Interactive |
| Mission step completion | Variable | Depends on action type |

## Performance Optimization

- Model routing to balance cost and quality.
- Caching frequent lookups.
- Parallel independent tool calls.
- Context compression.
- Async processing for non-interactive tasks.
- Right-sized worker pools.

## Performance Monitoring

- Dashboards per tenant and platform.
- Alerts for latency, error rate, cost anomalies.
- Mission-level outcome tracking.
- Agent-level evaluation scores.

## Performance and Outcomes

- Cost per business outcome is the primary efficiency metric.
- Token usage is a leading indicator, not the goal.
- High conversion with low cost = good performance.
