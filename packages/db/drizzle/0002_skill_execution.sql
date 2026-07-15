CREATE TYPE "public"."skill_runtime" AS ENUM('local', 'sandbox', 'container');--> statement-breakpoint
CREATE TYPE "public"."skill_run_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "runtime" "skill_runtime" DEFAULT 'local' NOT NULL;--> statement-breakpoint
CREATE TABLE "skill_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"org_slug" text NOT NULL,
	"skill_slug" text NOT NULL,
	"script_path" text NOT NULL,
	"runtime" "skill_runtime" NOT NULL,
	"status" "skill_run_status" DEFAULT 'queued' NOT NULL,
	"args" jsonb,
	"target_url" text,
	"stdout" text,
	"stderr" text,
	"exit_code" integer,
	"duration_ms" integer,
	"error" text,
	"actor_id" text,
	"actor_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_version_id_skill_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."skill_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_runs_skill_idx" ON "skill_runs" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_runs_created_idx" ON "skill_runs" USING btree ("created_at");
