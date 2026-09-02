# Performance Architecture

## Performance Targets

| Operation | Target | Notes |
|---|---|---|
| User API p95 latency | < 500ms | For read operations |
| User API p99 latency | < 2000ms | For read operations |
| Write API p95 latency | < 1000ms | Synchronous confirmations |
| LLM simple call p95 | < 5s | Including routing overhead |
| LLM complex call p95 | < 30s | Reasoning and tool use |
| Outbound email delivery | < 60s | Queue-based, provider-dependent |
| CRM sync lag | < 5 minutes | Typical sync latency |
| Dashboard load | < 3s | Analytics read models |
| Mission status query | < 200ms | Cached operational data |

## Caching Strategy

| Layer | Cache Use | TTL |
|---|---|---|
| API Gateway | Tenant config, rate-limit counters | Seconds to minutes |
| Application services | Hot entities, user sessions | Minutes |
| Database | Query result caching | Query-dependent |
| AI Execution | Prompt templates, model metadata | Minutes |
| Knowledge retrieval | Frequent knowledge items | Minutes to hours |
| External providers | Rate-limit state, auth tokens | Token lifetime |

## Latency Reduction

- Pre-compute embeddings for stable knowledge.
- Cache LLM prompts/results for deterministic tasks.
- Use read replicas for analytics and reporting.
- Keep operational queries bounded by tenant.
- Use async processing for non-critical writes.
- Optimize vector indexes for approximate search.
- Compress event payloads.
- Use connection pooling.

## Throughput Optimization

- Batch CRM sync and email operations where possible.
- Use event-driven processing to avoid blocking.
- Scale worker pools independently.
- Partition event topics by workload.
- Use backpressure to avoid overwhelming providers.
- Pre-fetch and cache external data during off-peak.

## AI Performance

- Model routing balances quality and latency.
- Streaming responses can reduce perceived latency.
- Parallel tool calls where independent.
- Context window management avoids excessive tokens.
- Caching of retrieval results reduces repeated vector searches.

## Database Performance

- Tenant-scoped indexes on all tenant tables.
- Covering indexes for common queries.
- Partitioning by time for audit and analytics.
- Query result limits on list endpoints.
- Optimistic concurrency for aggregate updates.

## Monitoring

- Track p50/p95/p99 latencies per endpoint.
- Track LLM latency per provider/model.
- Track external API latency and error rates.
- Set SLOs and alerts.
- Performance regression tests in CI.

## Performance Trade-offs

- Strong consistency for operational writes; eventual consistency for analytics.
- Synchronous confirmation for critical actions; async for background processing.
- Caching improves speed but requires invalidation.
- Vector approximation improves speed but may reduce recall.
