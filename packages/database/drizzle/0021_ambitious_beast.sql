CREATE TABLE "server_member_roles" (
	"server_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"name" varchar(64) NOT NULL,
	"position" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_roles_name_ck" CHECK (length(btrim("server_roles"."name")) between 1 and 64 and "server_roles"."name" = btrim("server_roles"."name")),
	CONSTRAINT "server_roles_identity_ck" CHECK (("server_roles"."is_default" and "server_roles"."id" = "server_roles"."server_id" and "server_roles"."position" = 0) or (not "server_roles"."is_default" and "server_roles"."id" <> "server_roles"."server_id" and "server_roles"."position" > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "server_member_roles_pair_uq" ON "server_member_roles" USING btree ("server_id","user_id","role_id");--> statement-breakpoint
CREATE INDEX "server_member_roles_role_idx" ON "server_member_roles" USING btree ("server_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "server_roles_server_id_id_uq" ON "server_roles" USING btree ("server_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "server_roles_server_position_uq" ON "server_roles" USING btree ("server_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "server_roles_one_default_uq" ON "server_roles" USING btree ("server_id") WHERE "server_roles"."is_default";--> statement-breakpoint
ALTER TABLE "server_roles" ADD CONSTRAINT "server_roles_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_member_roles" ADD CONSTRAINT "server_member_roles_member_fk" FOREIGN KEY ("server_id","user_id") REFERENCES "public"."server_members"("server_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_member_roles" ADD CONSTRAINT "server_member_roles_role_fk" FOREIGN KEY ("server_id","role_id") REFERENCES "public"."server_roles"("server_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Existing servers receive a deterministic default role. gen_random_uuid() is
-- already used by the project's UUID columns; no extension is introduced.
INSERT INTO server_roles (id, server_id, name, position, is_default)
SELECT id, id, '@everyone', 0, true FROM servers
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
CREATE FUNCTION cubic_create_server_default_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO server_roles (id, server_id, name, position, is_default)
  VALUES (NEW.id, NEW.id, '@everyone', 0, true);
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER servers_create_default_role
AFTER INSERT ON servers FOR EACH ROW EXECUTE FUNCTION cubic_create_server_default_role();--> statement-breakpoint
CREATE FUNCTION cubic_protect_server_default_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_default AND EXISTS (SELECT 1 FROM servers WHERE id = OLD.server_id) THEN
    RAISE EXCEPTION 'default server role cannot be changed or deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER server_roles_protect_default_update
BEFORE UPDATE ON server_roles FOR EACH ROW EXECUTE FUNCTION cubic_protect_server_default_role();--> statement-breakpoint
CREATE TRIGGER server_roles_protect_default_delete
BEFORE DELETE ON server_roles FOR EACH ROW EXECUTE FUNCTION cubic_protect_server_default_role();--> statement-breakpoint
CREATE FUNCTION cubic_reject_default_role_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM server_roles WHERE server_id = NEW.server_id AND id = NEW.role_id AND is_default) THEN
    RAISE EXCEPTION 'default server role is implicit' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER server_member_roles_custom_only
BEFORE INSERT OR UPDATE ON server_member_roles FOR EACH ROW EXECUTE FUNCTION cubic_reject_default_role_assignment();
