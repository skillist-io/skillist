ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "install_policy" jsonb;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "review_rubric" jsonb;

ALTER TYPE "org_role" ADD VALUE IF NOT EXISTS 'publisher';

ALTER TABLE "skill_inventory" ADD COLUMN IF NOT EXISTS "source_type" text;
ALTER TABLE "skill_inventory" ADD COLUMN IF NOT EXISTS "scope" text;
ALTER TABLE "skill_inventory" ADD COLUMN IF NOT EXISTS "marketplace" text;
ALTER TABLE "skill_inventory" ADD COLUMN IF NOT EXISTS "plugin_name" text;
ALTER TABLE "skill_inventory" ADD COLUMN IF NOT EXISTS "is_symlink" boolean DEFAULT false NOT NULL;
ALTER TABLE "skill_inventory" ADD COLUMN IF NOT EXISTS "conformance_status" text;
ALTER TABLE "skill_inventory" ADD COLUMN IF NOT EXISTS "conformance_issues" jsonb;
ALTER TABLE "skill_inventory" ADD COLUMN IF NOT EXISTS "content_hash" text;
ALTER TABLE "skill_inventory" ADD COLUMN IF NOT EXISTS "security_status" "security_status";
ALTER TABLE "skill_inventory" ADD COLUMN IF NOT EXISTS "security_issues" jsonb;

CREATE TABLE IF NOT EXISTS "org_mcp_servers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "upstream_url" text NOT NULL,
  "transport" text DEFAULT 'http' NOT NULL,
  "oauth_client_id" text,
  "oauth_client_secret" text,
  "oauth_scope" text,
  "oauth_resource_url" text,
  "oauth_authorization_server_url" text,
  "access_token" text,
  "refresh_token" text,
  "status" text DEFAULT 'unauthorized' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_mcp_servers_org_name_idx" ON "org_mcp_servers" ("org_id", "name");
