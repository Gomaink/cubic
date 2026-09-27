CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" varchar(16) NOT NULL,
	"token_digest" varchar(64) NOT NULL,
	"target_email_normalized" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verification_tokens_purpose_ck" CHECK ("email_verification_tokens"."purpose" in ('verify_email', 'change_email')),
	CONSTRAINT "email_verification_tokens_digest_ck" CHECK ("email_verification_tokens"."token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "email_verification_tokens_expiry_ck" CHECK ("email_verification_tokens"."expires_at" > "email_verification_tokens"."created_at")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_verification_tokens_digest_uq" ON "email_verification_tokens" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_user_purpose_idx" ON "email_verification_tokens" USING btree ("user_id","purpose");