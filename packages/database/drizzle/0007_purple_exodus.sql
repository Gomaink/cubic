CREATE TABLE "attachment_file_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attachment_id" uuid,
	"storage_key" text NOT NULL,
	"reason" varchar(32) NOT NULL,
	"state" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_file_deletions_storage_key_format_ck" CHECK ("attachment_file_deletions"."storage_key" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "attachment_file_deletions_reason_ck" CHECK ("attachment_file_deletions"."reason" in ('metadata_deleted', 'orphan')),
	CONSTRAINT "attachment_file_deletions_state_ck" CHECK ("attachment_file_deletions"."state" in ('pending', 'leased')),
	CONSTRAINT "attachment_file_deletions_attempt_count_ck" CHECK ("attachment_file_deletions"."attempt_count" >= 0),
	CONSTRAINT "attachment_file_deletions_lease_ck" CHECK (("attachment_file_deletions"."state" = 'pending' and "attachment_file_deletions"."lease_token" is null and "attachment_file_deletions"."lease_expires_at" is null)
        or ("attachment_file_deletions"."state" = 'leased' and "attachment_file_deletions"."lease_token" is not null and "attachment_file_deletions"."lease_expires_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_file_deletions_storage_key_uq" ON "attachment_file_deletions" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "attachment_file_deletions_pending_due_idx" ON "attachment_file_deletions" USING btree ("state","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "attachment_file_deletions_expired_lease_idx" ON "attachment_file_deletions" USING btree ("state","lease_expires_at");--> statement-breakpoint
CREATE FUNCTION "enqueue_attachment_file_deletion"() RETURNS trigger AS $$
BEGIN
	INSERT INTO "attachment_file_deletions" (
		"attachment_id",
		"storage_key",
		"reason"
	) VALUES (
		OLD."id",
		OLD."storage_key",
		'metadata_deleted'
	)
	ON CONFLICT ("storage_key") DO NOTHING;
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "attachments_enqueue_file_deletion"
BEFORE DELETE ON "attachments"
FOR EACH ROW
EXECUTE FUNCTION "enqueue_attachment_file_deletion"();
