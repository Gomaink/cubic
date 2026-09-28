CREATE TABLE "passkey_authentication_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_digest" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passkey_authentication_challenges_digest_ck" CHECK ("passkey_authentication_challenges"."challenge_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "passkey_authentication_challenges_expiry_ck" CHECK ("passkey_authentication_challenges"."expires_at" > "passkey_authentication_challenges"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_authentication_challenges_digest_uq" ON "passkey_authentication_challenges" USING btree ("challenge_digest");
