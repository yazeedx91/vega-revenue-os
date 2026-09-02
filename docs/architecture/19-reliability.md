# Reliability Architecture

## Reliability Goals

- The platform remains functional even when external providers degrade or fail.
- Missions do not lose state due to process restarts.
- AI executions are retryable and recoverable.
- Data remains consistent within aggregate boundaries.

## Timeouts

| Operation | Timeout |
|---|---|
| API request (user-facing) | 5-30 seconds |
| Database query | 2-10 seconds |
| LLM request (simple) | 30 seconds |
| LLM request (complex) | 120 seconds |
| External API call (CRM/email/calendar) | 10-30 seconds |
| Workflow step | Configurable per step |
| Background job | Per job policy |

## Retries

| Failure | Strategy |
|---|---|
| Transient network | Exponential backoff, max 5 attempts |
| Database deadlock | Immediate retry, max 3 attempts |
| Provider throttling | Exponential backoff + jitter |
| LLM timeout | Retry with fallback provider |
| Business rule violation | No retry; emit failure event |
| Validation error | No retry; dead-letter |

## Circuit Breakers

- Applied to external provider calls (LLM, CRM, email, calendar).
- After threshold failures, circuit opens and fast-fails requests.
- Half-open state tests provider health.
- Events alert operations when circuits open.

## Bulkheads

- Separate worker pools for AI execution, CRM sync, email, and general background jobs.
- Separate database connection pools per major service.
- Separate rate-limit quotas per external provider and tenant.
- Failure in one pool does not exhaust resources of another.

## Backpressure

- Event bus consumer lag monitoring.
- Autoscaling based on queue depth and CPU.
- Load shedding when critical dependencies are degraded.
- Tenant-level rate limiting prevents noisy neighbor.

## Dead Letter Queues

- Failed messages move to DLQ after retries.
- DLQ alerts operations.
- Replay tooling supports reprocessing after fix.
- Poison messages are quarantined and inspected.

## Idempotency

- All commands and events carry unique IDs.
- Consumers track processed IDs.
- APIs support idempotency keys for mutations.
- Workflows deduplicate by instance ID.

## Graceful Degradation

- If LLM provider fails, fallback to secondary provider or pause mission.
- If CRM sync fails, queue and retry; mission continues.
- If email provider fails, retry; urgent messages escalate.
- If research provider fails, use cached or stale data with low confidence.

## Fallbacks

| Component | Primary | Fallback |
|---|---|---|
| LLM | Provider A | Provider B, then human escalation |
| CRM sync | Real-time sync | Delayed retry queue |
| Email | Provider A | Provider B |
| Calendar | Microsoft Graph | Zoom / Google |
| Search | Provider A | Provider B, then cached data |

## Health Checks

- **Liveness**: Process is running.
- **Readiness**: Service can accept traffic (DB, cache, event bus reachable).
- **Dependency health**: External providers checked via canaries.
- **AI model health**: Periodic test prompts and latency checks.

## Recovery

- Operational DB: point-in-time restore.
- Event log: replay from durable store.
- Workflows: resume from last checkpoint.
- Agent executions: reprocess from event log.
- Cache: warm from operational DB.
