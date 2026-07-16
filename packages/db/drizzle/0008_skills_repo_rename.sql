ALTER TABLE "skills" RENAME COLUMN "slug" TO "repo";-->statement-breakpoint
DROP INDEX IF EXISTS "skills_org_slug_idx";-->statement-breakpoint
CREATE UNIQUE INDEX "skills_org_repo_idx" ON "skills" USING btree ("org_id","repo");-->statement-breakpoint

ALTER TABLE "registry_entries" RENAME COLUMN "skill_slug" TO "skill_repo";-->statement-breakpoint
ALTER TABLE "telemetry_events" RENAME COLUMN "skill_slug" TO "skill_repo";-->statement-breakpoint
ALTER TABLE "org_required_skills" RENAME COLUMN "skill_slug" TO "skill_repo";-->statement-breakpoint
ALTER TABLE "skill_runs" RENAME COLUMN "skill_slug" TO "skill_repo";-->statement-breakpoint

ALTER TABLE "skill_inventory" RENAME COLUMN "skill_slug" TO "local_slug";-->statement-breakpoint
ALTER TABLE "skill_inventory" RENAME COLUMN "registry_skill_slug" TO "registry_repo";
