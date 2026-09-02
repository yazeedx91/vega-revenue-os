-- Slice 2 mission durable planning persistence - part 2.
-- Creates normalized plan, task, dependency, execution state, observation,
-- and workflow identity tables. References mission.missions (created in 014).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Immutable plan versions per mission.
CREATE TABLE IF NOT EXISTS mission.plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    mission_id UUID NOT NULL REFERENCES mission.missions(id) ON DELETE CASCADE,
    version INT NOT NULL,
    plan_id TEXT NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT false,
    objectives JSONB NOT NULL DEFAULT '[]',
    phases JSONB NOT NULL DEFAULT '[]',
    approval_gates JSONB NOT NULL DEFAULT '[]',
    fallback_branches JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_mission_version
    ON mission.plans (mission_id, version);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_mission_current
    ON mission.plans (mission_id)
    WHERE is_current = true;

-- Task definitions belonging to a plan version (immutable).
CREATE TABLE IF NOT EXISTS mission.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    mission_id UUID NOT NULL,
    plan_version INT NOT NULL,
    task_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    agent_version TEXT NOT NULL,
    task_type TEXT NOT NULL,
    required_capability TEXT,
    input JSONB NOT NULL DEFAULT '{}',
    approval_gate_id TEXT,
    deadline TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_mission_plan_task
    ON mission.tasks (mission_id, plan_version, task_id);

-- Normalized task dependency graph per plan version.
CREATE TABLE IF NOT EXISTS mission.task_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    mission_id UUID NOT NULL,
    plan_version INT NOT NULL,
    task_id TEXT NOT NULL,
    depends_on_task_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_dependencies_unique
    ON mission.task_dependencies (mission_id, plan_version, task_id, depends_on_task_id);

-- Mutable task execution state for the current plan version.
CREATE TABLE IF NOT EXISTS mission.task_execution_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    mission_id UUID NOT NULL,
    plan_version INT NOT NULL,
    task_id TEXT NOT NULL,
    status TEXT NOT NULL,
    output JSONB,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INT NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_execution_unique
    ON mission.task_execution_state (mission_id, plan_version, task_id);

-- Re-planning observations/triggers.
CREATE TABLE IF NOT EXISTS mission.observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    mission_id UUID NOT NULL REFERENCES mission.missions(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    applied_to_plan_version INT,
    new_plan_version INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workflow identity and correlation for durable recovery.
CREATE TABLE IF NOT EXISTS mission.workflow_identity (
    mission_id UUID PRIMARY KEY REFERENCES mission.missions(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    execution_id TEXT,
    status TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row-level security on every tenant-scoped table.
ALTER TABLE mission.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission.task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission.task_execution_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission.observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission.workflow_identity ENABLE ROW LEVEL SECURITY;

ALTER TABLE mission.plans FORCE ROW LEVEL SECURITY;
ALTER TABLE mission.tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE mission.task_dependencies FORCE ROW LEVEL SECURITY;
ALTER TABLE mission.task_execution_state FORCE ROW LEVEL SECURITY;
ALTER TABLE mission.observations FORCE ROW LEVEL SECURITY;
ALTER TABLE mission.workflow_identity FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_plans ON mission.plans;
CREATE POLICY tenant_isolation_plans
    ON mission.plans
    USING (tenant_id = current_setting('app.current_tenant', TRUE));

DROP POLICY IF EXISTS tenant_isolation_tasks ON mission.tasks;
CREATE POLICY tenant_isolation_tasks
    ON mission.tasks
    USING (tenant_id = current_setting('app.current_tenant', TRUE));

DROP POLICY IF EXISTS tenant_isolation_task_dependencies ON mission.task_dependencies;
CREATE POLICY tenant_isolation_task_dependencies
    ON mission.task_dependencies
    USING (tenant_id = current_setting('app.current_tenant', TRUE));

DROP POLICY IF EXISTS tenant_isolation_task_execution_state ON mission.task_execution_state;
CREATE POLICY tenant_isolation_task_execution_state
    ON mission.task_execution_state
    USING (tenant_id = current_setting('app.current_tenant', TRUE));

DROP POLICY IF EXISTS tenant_isolation_observations ON mission.observations;
CREATE POLICY tenant_isolation_observations
    ON mission.observations
    USING (tenant_id = current_setting('app.current_tenant', TRUE));

DROP POLICY IF EXISTS tenant_isolation_workflow_identity ON mission.workflow_identity;
CREATE POLICY tenant_isolation_workflow_identity
    ON mission.workflow_identity
    USING (tenant_id = current_setting('app.current_tenant', TRUE));

-- Least-privilege runtime grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE mission.plans TO projectx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE mission.tasks TO projectx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE mission.task_dependencies TO projectx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE mission.task_execution_state TO projectx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE mission.observations TO projectx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE mission.workflow_identity TO projectx_app;
