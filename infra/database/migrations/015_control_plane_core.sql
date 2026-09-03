CREATE SCHEMA IF NOT EXISTS control_plane;

CREATE TABLE IF NOT EXISTS control_plane.capabilities (
  capability_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  risk_category TEXT NOT NULL,
  allowed_tools TEXT[] NOT NULL DEFAULT '{}',
  required_policies TEXT[] NOT NULL DEFAULT '{}',
  version TEXT NOT NULL DEFAULT '1.0.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_plane.models (
  model_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  family TEXT NOT NULL,
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  latency_class TEXT NOT NULL,
  cost_metadata JSONB NOT NULL DEFAULT '{}',
  health_metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_plane.agent_versions (
  version_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  tenant_id TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  version TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  description TEXT NOT NULL,
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  tools TEXT[] NOT NULL DEFAULT '{}',
  policies JSONB NOT NULL DEFAULT '[]',
  model_policy JSONB NOT NULL DEFAULT '{}',
  memory_policy JSONB NOT NULL DEFAULT '{}',
  knowledge_policy JSONB NOT NULL DEFAULT '{}',
  autonomy_level_default INTEGER NOT NULL DEFAULT 0,
  evaluation_policy JSONB NOT NULL DEFAULT '{}',
  owner TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_plane.policies (
  policy_id TEXT PRIMARY KEY,
  tenant_id TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  scope TEXT NOT NULL,
  mission_id TEXT,
  agent_id TEXT,
  capability TEXT,
  tool_id TEXT,
  risk_category TEXT,
  outcome TEXT NOT NULL,
  policy_version TEXT NOT NULL DEFAULT '1.0.0',
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_plane.emergency_stop (
  stop_id TEXT PRIMARY KEY,
  tenant_id TEXT,
  mission_id TEXT,
  agent_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT USAGE ON SCHEMA control_plane TO projectx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA control_plane TO projectx_app;
