CREATE TABLE "server_channel_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"text_channel_id" uuid,
	"voice_channel_id" uuid,
	"role_id" uuid,
	"member_user_id" uuid,
	"allow" bigint DEFAULT 0 NOT NULL,
	"deny" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_channel_overrides_channel_ck" CHECK (num_nonnulls("server_channel_overrides"."text_channel_id", "server_channel_overrides"."voice_channel_id") = 1),
	CONSTRAINT "server_channel_overrides_target_ck" CHECK (num_nonnulls("server_channel_overrides"."role_id", "server_channel_overrides"."member_user_id") = 1),
	CONSTRAINT "server_channel_overrides_masks_ck" CHECK ("server_channel_overrides"."allow" >= 0 and "server_channel_overrides"."deny" >= 0 and ("server_channel_overrides"."allow" & ~8128::bigint) = 0 and ("server_channel_overrides"."deny" & ~8128::bigint) = 0 and ("server_channel_overrides"."allow" & "server_channel_overrides"."deny") = 0)
);
--> statement-breakpoint
ALTER TABLE "server_roles" DROP CONSTRAINT "server_roles_permissions_ck";--> statement-breakpoint
CREATE UNIQUE INDEX "server_channel_overrides_text_role_uq" ON "server_channel_overrides" USING btree ("text_channel_id","role_id") WHERE "server_channel_overrides"."text_channel_id" is not null and "server_channel_overrides"."role_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "server_channel_overrides_text_member_uq" ON "server_channel_overrides" USING btree ("text_channel_id","member_user_id") WHERE "server_channel_overrides"."text_channel_id" is not null and "server_channel_overrides"."member_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "server_channel_overrides_voice_role_uq" ON "server_channel_overrides" USING btree ("voice_channel_id","role_id") WHERE "server_channel_overrides"."voice_channel_id" is not null and "server_channel_overrides"."role_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "server_channel_overrides_voice_member_uq" ON "server_channel_overrides" USING btree ("voice_channel_id","member_user_id") WHERE "server_channel_overrides"."voice_channel_id" is not null and "server_channel_overrides"."member_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "server_text_channels_server_id_id_uq" ON "server_text_channels" USING btree ("server_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "server_voice_channels_server_id_id_uq" ON "server_voice_channels" USING btree ("server_id","id");--> statement-breakpoint
ALTER TABLE "server_channel_overrides" ADD CONSTRAINT "server_channel_overrides_text_fk" FOREIGN KEY ("server_id","text_channel_id") REFERENCES "public"."server_text_channels"("server_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_channel_overrides" ADD CONSTRAINT "server_channel_overrides_voice_fk" FOREIGN KEY ("server_id","voice_channel_id") REFERENCES "public"."server_voice_channels"("server_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_channel_overrides" ADD CONSTRAINT "server_channel_overrides_role_fk" FOREIGN KEY ("server_id","role_id") REFERENCES "public"."server_roles"("server_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_channel_overrides" ADD CONSTRAINT "server_channel_overrides_member_fk" FOREIGN KEY ("server_id","member_user_id") REFERENCES "public"."server_members"("server_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_roles" ADD CONSTRAINT "server_roles_permissions_ck" CHECK ("server_roles"."permissions" >= 0 and ("server_roles"."permissions" & ~8191::bigint) = 0);--> statement-breakpoint
UPDATE server_roles SET permissions = permissions | 4096::bigint, updated_at = now() WHERE is_default;--> statement-breakpoint
CREATE OR REPLACE FUNCTION cubic_create_server_default_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO server_roles (id, server_id, name, position, is_default, permissions)
  VALUES (NEW.id, NEW.id, '@everyone', 0, true, 8001);
  RETURN NEW;
END;
$$;
