ALTER TABLE mission.missions
  ADD COLUMN workspace_id UUID,
  ADD COLUMN workspace_binding_state TEXT NOT NULL DEFAULT 'LEGACY_UNBOUND';

UPDATE mission.missions
SET workspace_id = NULL,
    workspace_binding_state = 'LEGACY_UNBOUND';

ALTER TABLE mission.missions
  ADD CONSTRAINT missions_workspace_binding_check CHECK (
    (workspace_binding_state = 'WORKSPACE_BOUND' AND workspace_id IS NOT NULL) OR
    (workspace_binding_state = 'LEGACY_UNBOUND' AND workspace_id IS NULL)
  ),
  ADD CONSTRAINT missions_tenant_workspace_fk FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES identity.workspaces (tenant_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT missions_tenant_workspace_id_unique UNIQUE (tenant_id, workspace_id, id);

ALTER TABLE mission.approvals
  ADD COLUMN mission_id UUID,
  ADD COLUMN workspace_id UUID,
  ADD COLUMN workspace_binding_state TEXT;

UPDATE mission.approvals a
SET mission_id = m.id,
    workspace_id = m.workspace_id,
    workspace_binding_state = CASE
      WHEN m.workspace_binding_state = 'WORKSPACE_BOUND' THEN 'WORKSPACE_BOUND'
      ELSE 'LEGACY_UNBOUND'
    END
FROM mission.missions m
WHERE a.tenant_id = m.tenant_id
  AND a.payload->>'missionId' = m.id::TEXT;

UPDATE mission.approvals
SET workspace_id = NULL,
    workspace_binding_state = 'LEGACY_UNBOUND'
WHERE workspace_binding_state IS NULL;

ALTER TABLE mission.approvals
  ADD CONSTRAINT approvals_workspace_binding_check CHECK (
    (workspace_binding_state = 'WORKSPACE_BOUND' AND workspace_id IS NOT NULL) OR
    (workspace_binding_state = 'LEGACY_UNBOUND' AND workspace_id IS NULL)
  ),
  ADD CONSTRAINT approvals_workspace_mission_fk FOREIGN KEY (tenant_id, workspace_id, mission_id)
    REFERENCES mission.missions (tenant_id, workspace_id, id),
  ALTER COLUMN mission_id SET NOT NULL,
  ALTER COLUMN workspace_binding_state SET NOT NULL;

ALTER TABLE mission.missions ALTER COLUMN workspace_binding_state DROP DEFAULT;

CREATE OR REPLACE FUNCTION mission.require_bound_workspace_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_binding_state <> 'WORKSPACE_BOUND' OR NEW.workspace_id IS NULL THEN
    RAISE EXCEPTION 'new records require authoritative workspace ownership';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER missions_require_bound_workspace_insert
BEFORE INSERT ON mission.missions
FOR EACH ROW EXECUTE FUNCTION mission.require_bound_workspace_insert();

CREATE TRIGGER approvals_require_bound_workspace_insert
BEFORE INSERT ON mission.approvals
FOR EACH ROW EXECUTE FUNCTION mission.require_bound_workspace_insert();

CREATE OR REPLACE FUNCTION mission.reject_workspace_relocation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR OLD.workspace_binding_state IS DISTINCT FROM NEW.workspace_binding_state THEN
    RAISE EXCEPTION 'workspace ownership is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER missions_reject_workspace_relocation
BEFORE UPDATE ON mission.missions
FOR EACH ROW EXECUTE FUNCTION mission.reject_workspace_relocation();

CREATE TRIGGER approvals_reject_workspace_relocation
BEFORE UPDATE ON mission.approvals
FOR EACH ROW EXECUTE FUNCTION mission.reject_workspace_relocation();

CREATE INDEX missions_workspace_lookup ON mission.missions (tenant_id, workspace_id, id);
CREATE INDEX approvals_workspace_lookup ON mission.approvals (tenant_id, workspace_id, id);
