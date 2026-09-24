CREATE TABLE "server_invite_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"creator_user_id" uuid NOT NULL,
	"token_digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "server_invite_links_token_digest_ck" CHECK ("server_invite_links"."token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "server_invite_links_expiry_ck" CHECK ("server_invite_links"."expires_at" > "server_invite_links"."created_at")
);
--> statement-breakpoint
ALTER TABLE "server_invite_links" ADD CONSTRAINT "server_invite_links_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_invite_links" ADD CONSTRAINT "server_invite_links_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "server_invite_links_token_digest_uq" ON "server_invite_links" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "server_invite_links_server_created_idx" ON "server_invite_links" USING btree ("server_id","created_at","id");