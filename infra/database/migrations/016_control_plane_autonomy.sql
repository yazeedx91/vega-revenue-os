CREATE TABLE IF NOT EXISTS control_plane.autonomy_config (
  rule_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  risk_category TEXT NOT NULL,
  required_outcome TEXT NOT NULL,
  confidence_threshold NUMERIC NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON control_plane.autonomy_config TO projectx_app;
