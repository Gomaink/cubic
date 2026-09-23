CREATE TABLE "server_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"inviter_user_id" uuid NOT NULL,
	"invitee_user_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "server_invites_status_ck" CHECK ("server_invites"."status" in ('pending', 'accepted', 'cancelled')),
	CONSTRAINT "server_invites_distinct_users_ck" CHECK ("server_invites"."inviter_user_id" <> "server_invites"."invitee_user_id")
);
--> statement-breakpoint
ALTER TABLE "server_invites" ADD CONSTRAINT "server_invites_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_invites" ADD CONSTRAINT "server_invites_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_invites" ADD CONSTRAINT "server_invites_invitee_user_id_users_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "server_invites_pending_pair_uq" ON "server_invites" USING btree ("server_id","invitee_user_id") WHERE "server_invites"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "server_invites_invitee_status_created_idx" ON "server_invites" USING btree ("invitee_user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "server_invites_server_status_created_idx" ON "server_invites" USING btree ("server_id","status","created_at");