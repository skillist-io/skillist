ALTER TABLE "registry_entries" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "registry_entries" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "registry_category_idx" ON "registry_entries" USING btree ("category");
