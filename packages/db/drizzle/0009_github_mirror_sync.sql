CREATE TYPE "public"."skill_source_type" AS ENUM('native', 'mirror');--> statement-breakpoint
CREATE TYPE "public"."skill_trust_tier" AS ENUM('official_mirror');--> statement-breakpoint
CREATE TYPE "public"."skill_sync_status" AS ENUM('idle', 'running', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."skill_source_suggestion_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "registry_entries" ADD COLUMN "source_type" "skill_source_type" DEFAULT 'native' NOT NULL;--> statement-breakpoint
ALTER TABLE "registry_entries" ADD COLUMN "upstream_repo" text;--> statement-breakpoint
ALTER TABLE "registry_entries" ADD COLUMN "upstream_url" text;--> statement-breakpoint
CREATE INDEX "registry_source_type_idx" ON "registry_entries" USING btree ("source_type");--> statement-breakpoint
CREATE TABLE "skill_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_owner" text NOT NULL,
	"github_repo" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"discovery_roots" jsonb DEFAULT '["skills"]'::jsonb NOT NULL,
	"trust_tier" "skill_trust_tier" DEFAULT 'official_mirror' NOT NULL,
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_commit_sha" text,
	"last_sync_status" "skill_sync_status" DEFAULT 'idle' NOT NULL,
	"last_sync_error" text,
	"license" text,
	"homepage_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "skill_sources_owner_repo_idx" ON "skill_sources" USING btree ("github_owner","github_repo");--> statement-breakpoint
CREATE INDEX "skill_sources_sync_enabled_idx" ON "skill_sources" USING btree ("sync_enabled");--> statement-breakpoint
CREATE TABLE "skill_source_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_owner" text NOT NULL,
	"github_repo" text NOT NULL,
	"discovered_via" text NOT NULL,
	"stars" integer DEFAULT 0 NOT NULL,
	"license" text,
	"match_score" integer DEFAULT 0 NOT NULL,
	"status" "skill_source_suggestion_status" DEFAULT 'pending' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "skill_source_suggestions_owner_repo_idx" ON "skill_source_suggestions" USING btree ("github_owner","github_repo");--> statement-breakpoint
CREATE INDEX "skill_source_suggestions_status_idx" ON "skill_source_suggestions" USING btree ("status");--> statement-breakpoint
ALTER TABLE "skill_source_suggestions" ADD CONSTRAINT "skill_source_suggestions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "skill_provenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"source_id" uuid,
	"source_path" text NOT NULL,
	"source_commit_sha" text,
	"source_url" text,
	"content_hash" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_provenance_skill_id_unique" UNIQUE("skill_id")
);--> statement-breakpoint
CREATE INDEX "skill_provenance_source_idx" ON "skill_provenance" USING btree ("source_id");--> statement-breakpoint
ALTER TABLE "skill_provenance" ADD CONSTRAINT "skill_provenance_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_provenance" ADD CONSTRAINT "skill_provenance_source_id_skill_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."skill_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "skill_sources" ("github_owner", "github_repo", "default_branch", "discovery_roots", "trust_tier", "sync_enabled")
VALUES
  ('anthropics', 'skills', 'main', '["skills"]'::jsonb, 'official_mirror', true),
  ('cloudflare', 'skills', 'main', '["skills"]'::jsonb, 'official_mirror', true),
  ('adobe', 'skills', 'main', '["skills"]'::jsonb, 'official_mirror', true),
  ('microsoft', 'azure-skills', 'main', '["skills",".cursor/skills"]'::jsonb, 'official_mirror', true),
  ('aws', 'agent-toolkit-for-aws', 'main', '["skills"]'::jsonb, 'official_mirror', true)
ON CONFLICT DO NOTHING;
