ALTER TABLE "passkey_challenges" DROP CONSTRAINT "passkey_challenges_purpose_ck";--> statement-breakpoint
ALTER TABLE "passkey_challenges" ADD CONSTRAINT "passkey_challenges_purpose_ck" CHECK ("passkey_challenges"."purpose" in ('enroll', 'enroll_reauth', 'reauth'));
