CREATE TABLE "server_channel_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"name" varchar(96) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_channel_categories_position_ck" CHECK ("server_channel_categories"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "server_text_channels" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "server_text_channels" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "server_channel_categories" ADD CONSTRAINT "server_channel_categories_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "server_channel_categories_server_position_idx" ON "server_channel_categories" USING btree ("server_id","position","created_at","id");--> statement-breakpoint
ALTER TABLE "server_text_channels" ADD CONSTRAINT "server_text_channels_category_id_server_channel_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."server_channel_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "server_text_channels_layout_idx" ON "server_text_channels" USING btree ("server_id","category_id","position","created_at","id");--> statement-breakpoint
ALTER TABLE "server_text_channels" ADD CONSTRAINT "server_text_channels_position_ck" CHECK ("server_text_channels"."position" >= 0);