ALTER TABLE "server_roles" ADD COLUMN "permissions" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "server_roles" ADD CONSTRAINT "server_roles_permissions_ck" CHECK ("server_roles"."permissions" >= 0 and ("server_roles"."permissions" & ~4095::bigint) = 0);--> statement-breakpoint
-- Replace the 12.1 trigger body so future servers receive the same baseline.
CREATE OR REPLACE FUNCTION cubic_create_server_default_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO server_roles (id, server_id, name, position, is_default, permissions)
  VALUES (NEW.id, NEW.id, '@everyone', 0, true, 3905);
  RETURN NEW;
END;
$$;--> statement-breakpoint
-- The 12.1 trigger protects identity. Permission changes are allowed so the
-- implicit default role can be managed without member assignments.
CREATE OR REPLACE FUNCTION cubic_protect_server_default_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_default AND EXISTS (SELECT 1 FROM servers WHERE id = OLD.server_id) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'default server role cannot be deleted' USING ERRCODE = '23514';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.server_id IS DISTINCT FROM OLD.server_id
       OR NEW.name IS DISTINCT FROM OLD.name OR NEW.position IS DISTINCT FROM OLD.position
       OR NEW.is_default IS DISTINCT FROM OLD.is_default OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'default server role structure cannot be changed' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
-- Preserve the capabilities current members already have. All management bits
-- remain off for the implicit default role.
UPDATE server_roles SET permissions = 3905, updated_at = now() WHERE is_default;
