-- Slice 5 corrective: auditable per-attempt LLM invocation accounting.
--
-- Adds a stable per-call/per-attempt identity and honest attempt metadata so
-- that failed provider attempts are recorded without fabricating zero usage.
-- A submitted attempt whose usage is unknown is recorded with NULL usage and
-- usage_known = FALSE, and carries a conservative estimated_cost_usd charge so
-- that cross-provider fallback cannot silently exceed the execution budget.
--
-- Identity: (tenant_id, llm_call_id, attempt). A single reasoning execution may
-- contain multiple calls (call 1 = primary+fallback attempts, call 2 = repair),
-- each individually addressable. recorded_at is NOT part of the identity.

-- New attempt metadata columns.
ALTER TABLE ai_runtime.llm_invocations
    ADD COLUMN IF NOT EXISTS llm_call_id TEXT,
    ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'success',
    ADD COLUMN IF NOT EXISTS submitted BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS usage_known BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS failure_classification TEXT,
    ADD COLUMN IF NOT EXISTS retryable BOOLEAN,
    ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC,
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Backfill a unique llm_call_id for any pre-existing rows so the new primary
-- key can be enforced. Existing rows are legacy single-attempt records.
UPDATE ai_runtime.llm_invocations
   SET llm_call_id = gen_random_uuid()::text
 WHERE llm_call_id IS NULL;

ALTER TABLE ai_runtime.llm_invocations
    ALTER COLUMN llm_call_id SET NOT NULL;

-- Drop the recorded_at-based identity FIRST: provider_request_id is part of the
-- old primary key, so its NOT NULL cannot be relaxed while the constraint holds.
ALTER TABLE ai_runtime.llm_invocations DROP CONSTRAINT llm_invocations_pkey;

-- Usage/cost may be unknown for submitted-but-failed attempts.
ALTER TABLE ai_runtime.llm_invocations ALTER COLUMN provider_request_id DROP NOT NULL;
ALTER TABLE ai_runtime.llm_invocations ALTER COLUMN input_tokens DROP NOT NULL;
ALTER TABLE ai_runtime.llm_invocations ALTER COLUMN output_tokens DROP NOT NULL;
ALTER TABLE ai_runtime.llm_invocations ALTER COLUMN total_tokens DROP NOT NULL;
ALTER TABLE ai_runtime.llm_invocations ALTER COLUMN cost_usd DROP NOT NULL;
ALTER TABLE ai_runtime.llm_invocations ALTER COLUMN latency_ms DROP NOT NULL;

-- Replace the recorded_at-based identity with the stable call/attempt identity.
ALTER TABLE ai_runtime.llm_invocations
    ADD PRIMARY KEY (tenant_id, llm_call_id, attempt);

-- RLS / FORCE RLS on ai_runtime.llm_invocations is unchanged from migration 019.
