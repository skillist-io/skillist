CREATE TYPE "public"."failure_pattern_status" AS ENUM('open', 'drafted', 'dismissed');--> statement-breakpoint
CREATE TABLE "skill_failure_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"org_slug" text NOT NULL,
	"skill_repo" text NOT NULL,
	"signature" text NOT NULL,
	"summary" text NOT NULL,
	"suggested_fix" text,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"exemplar_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "failure_pattern_status" DEFAULT 'open' NOT NULL,
	"feedback_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_failure_patterns" ADD CONSTRAINT "skill_failure_patterns_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_failure_patterns_sig_idx" ON "skill_failure_patterns" USING btree ("skill_id","signature");--> statement-breakpoint
CREATE INDEX "skill_failure_patterns_skill_idx" ON "skill_failure_patterns" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_failure_patterns_status_idx" ON "skill_failure_patterns" USING btree ("status");