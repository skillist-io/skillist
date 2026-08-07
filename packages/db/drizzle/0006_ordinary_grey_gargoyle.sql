DROP INDEX "telemetry_skill_created_idx";--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD COLUMN "harness" text;--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD COLUMN "scope" text;--> statement-breakpoint
CREATE INDEX "telemetry_skill_created_idx" ON "telemetry_events" USING btree ("org_slug","skill_repo","created_at","harness");