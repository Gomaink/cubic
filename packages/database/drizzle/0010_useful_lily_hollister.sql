CREATE TABLE "server_text_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"name" varchar(96) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "server_text_channels" ADD CONSTRAINT "server_text_channels_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_text_channels" ADD CONSTRAINT "server_text_channels_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "server_text_channels_conversation_uq" ON "server_text_channels" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "server_text_channels_server_created_idx" ON "server_text_channels" USING btree ("server_id","created_at","id");