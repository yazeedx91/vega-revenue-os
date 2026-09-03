ALTER TABLE control_plane.agent_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane.policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane.autonomy_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane.emergency_stop ENABLE ROW LEVEL SECURITY;

ALTER TABLE control_plane.agent_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE control_plane.policies FORCE ROW LEVEL SECURITY;
ALTER TABLE control_plane.autonomy_config FORCE ROW LEVEL SECURITY;
ALTER TABLE control_plane.emergency_stop FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_versions_tenant_isolation ON control_plane.agent_versions;
CREATE POLICY agent_versions_tenant_isolation ON control_plane.agent_versions
  FOR ALL TO projectx_app
  USING (
    is_system = TRUE
    OR tenant_id = current_setting('app.current_tenant', TRUE)
  )
  WITH CHECK (
    (is_system = TRUE AND tenant_id IS NULL)
    OR (
      is_system = FALSE
      AND tenant_id = current_setting('app.current_tenant', TRUE)
    )
  );

DROP POLICY IF EXISTS policies_tenant_isolation ON control_plane.policies;
CREATE POLICY policies_tenant_isolation ON control_plane.policies
  FOR ALL TO projectx_app
  USING (
    is_system = TRUE
    OR tenant_id = current_setting('app.current_tenant', TRUE)
  )
  WITH CHECK (
    (is_system = TRUE AND tenant_id IS NULL)
    OR (
      is_system = FALSE
      AND tenant_id = current_setting('app.current_tenant', TRUE)
    )
  );

DROP POLICY IF EXISTS autonomy_config_tenant_isolation ON control_plane.autonomy_config;
CREATE POLICY autonomy_config_tenant_isolation ON control_plane.autonomy_config
  FOR ALL TO projectx_app
  USING (tenant_id = current_setting('app.current_tenant', TRUE))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

DROP POLICY IF EXISTS emergency_stop_tenant_isolation ON control_plane.emergency_stop;
CREATE POLICY emergency_stop_tenant_isolation ON control_plane.emergency_stop
  FOR ALL TO projectx_app
  USING (tenant_id = current_setting('app.current_tenant', TRUE))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE));

GRANT USAGE ON SCHEMA control_plane TO projectx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA control_plane TO projectx_app;
