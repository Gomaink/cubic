ALTER TABLE "server_invite_links" DROP CONSTRAINT "server_invite_links_expiry_ck";--> statement-breakpoint
ALTER TABLE "server_invite_links" DROP CONSTRAINT "server_invite_links_creator_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "server_invite_links" ALTER COLUMN "creator_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "server_invite_links" ALTER COLUMN "expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "server_invite_links" ADD COLUMN "max_uses" integer;--> statement-breakpoint
ALTER TABLE "server_invite_links" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "server_invite_links" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "server_invite_links" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "invites_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "server_invite_links" ADD CONSTRAINT "server_invite_links_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_invite_links" ADD CONSTRAINT "server_invite_links_max_uses_ck" CHECK ("server_invite_links"."max_uses" is null or "server_invite_links"."max_uses" > 0);--> statement-breakpoint
ALTER TABLE "server_invite_links" ADD CONSTRAINT "server_invite_links_use_count_ck" CHECK ("server_invite_links"."use_count" >= 0 and ("server_invite_links"."max_uses" is null or "server_invite_links"."use_count" <= "server_invite_links"."max_uses"));--> statement-breakpoint
ALTER TABLE "server_invite_links" ADD CONSTRAINT "server_invite_links_expiry_ck" CHECK ("server_invite_links"."expires_at" is null or "server_invite_links"."expires_at" > "server_invite_links"."created_at");