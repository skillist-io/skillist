CREATE TYPE "public"."security_status" AS ENUM('pass', 'advisory', 'fail');--> statement-breakpoint
CREATE TYPE "public"."telemetry_event" AS ENUM('install', 'activation');--> statement-breakpoint
CREATE TYPE "public"."eval_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "publish_policy" jsonb;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "quality_score" integer;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "impact_score" integer;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "security_status" "security_status";--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "security_issues" jsonb;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "review_checks" jsonb;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "plugin_manifest" jsonb;--> statement-breakpoint
ALTER TABLE "registry_entries" ADD COLUMN "quality_score" integer;--> statement-breakpoint
ALTER TABLE "registry_entries" ADD COLUMN "impact_score" integer;--> statement-breakpoint
ALTER TABLE "registry_entries" ADD COLUMN "security_status" "security_status";--> statement-breakpoint
ALTER TABLE "registry_entries" ADD COLUMN "install_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "registry_entries" ADD COLUMN "activation_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "registry_entries" ADD COLUMN "last_reviewed_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"actor_id" text,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "telemetry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_slug" text NOT NULL,
	"skill_slug" text NOT NULL,
	"event_type" "telemetry_event" NOT NULL,
	"project_hash" text,
	"user_id" text,
	"api_key_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "skill_evals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"status" "eval_status" DEFAULT 'queued' NOT NULL,
	"scenarios" jsonb,
	"baseline_score" integer,
	"with_skill_score" integer,
	"uplift" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "org_required_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"org_slug" text NOT NULL,
	"skill_slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "skill_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"repo_full_name" text NOT NULL,
	"file_path" text NOT NULL,
	"skill_slug" text,
	"managed" boolean DEFAULT false NOT NULL,
	"registry_org_slug" text,
	"registry_skill_slug" text,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD CONSTRAINT "telemetry_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_evals" ADD CONSTRAINT "skill_evals_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_evals" ADD CONSTRAINT "skill_evals_version_id_skill_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."skill_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_required_skills" ADD CONSTRAINT "org_required_skills_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_inventory" ADD CONSTRAINT "skill_inventory_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_org_idx" ON "audit_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "telemetry_skill_idx" ON "telemetry_events" USING btree ("org_slug","skill_slug");--> statement-breakpoint
CREATE INDEX "telemetry_type_idx" ON "telemetry_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "skill_evals_skill_idx" ON "skill_evals" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_required_skills_idx" ON "org_required_skills" USING btree ("org_id","org_slug","skill_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_inventory_repo_path_idx" ON "skill_inventory" USING btree ("org_id","repo_full_name","file_path");
