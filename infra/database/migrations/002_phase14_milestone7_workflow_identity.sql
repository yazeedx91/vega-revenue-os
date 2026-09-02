-- Phase 14 Milestone 7a — Workflow identity & durable communication lifecycle

-- OutreachSequence ↔ Temporal workflow linkage (audit/recovery only;
-- workflow-start uniqueness is enforced by Temporal's deterministic ID policy).
ALTER TABLE outreach.sequences
    ADD COLUMN IF NOT EXISTS workflow_id TEXT,
    ADD COLUMN IF NOT EXISTS workflow_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sequences_workflow_id
    ON outreach.sequences (tenant_id, workflow_id);

-- Approval target context for outreach-sequence workflow signal routing.
ALTER TABLE mission.approvals
    ADD COLUMN IF NOT EXISTS sequence_id TEXT;

CREATE INDEX IF NOT EXISTS idx_approvals_sequence_id
    ON mission.approvals (tenant_id, sequence_id);
