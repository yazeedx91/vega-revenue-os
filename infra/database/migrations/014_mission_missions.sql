-- Slice 2 mission durable planning persistence - part 1.
-- Creates the mission schema and the core mission aggregate table.
-- This must run in a separate migration so later tables can reference it.

CREATE SCHEMA IF NOT EXISTS mission;

-- Core mission aggregate.
CREATE TABLE IF NOT EXISTS mission.missions (
    id UUID PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    owner_user_id UUID NOT NULL,
    name TEXT NOT NULL,
    objective TEXT NOT NULL,
    icp_id TEXT NOT NULL,
    territory TEXT[] NOT NULL DEFAULT '{}',
    channels TEXT[] NOT NULL DEFAULT '{}',
    budget JSONB NOT NULL DEFAULT '{}',
    autonomy_level INT NOT NULL DEFAULT 0,
    constraints JSONB NOT NULL DEFAULT '{}',
    success_criteria JSONB NOT NULL DEFAULT '{}',
    deadline TIMESTAMPTZ,
    status TEXT NOT NULL,
    current_plan_version INT NOT NULL DEFAULT 0,
    outcomes JSONB NOT NULL DEFAULT '{}',
    workflow_id TEXT,
    workflow_run_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INT NOT NULL DEFAULT 1
);

-- Ensure the primary key exists even when the table was created by a partial run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mission.missions'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE mission.missions ALTER COLUMN id SET NOT NULL;
    ALTER TABLE mission.missions ADD PRIMARY KEY (id);
  END IF;
END $$;

-- Row-level security on the core mission table.
ALTER TABLE mission.missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission.missions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_missions ON mission.missions;
CREATE POLICY tenant_isolation_missions
    ON mission.missions
    USING (tenant_id = current_setting('app.current_tenant', TRUE));

-- Least-privilege runtime grants.
GRANT USAGE ON SCHEMA mission TO projectx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE mission.missions TO projectx_app;
