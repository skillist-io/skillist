CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounts_user_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_provider_account_idx` ON `accounts` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `agent_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`call_signature` text NOT NULL,
	`args` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`decided_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_approvals_call_idx` ON `agent_approvals` (`org_id`,`user_id`,`tool_name`,`call_signature`);--> statement-breakpoint
CREATE INDEX `agent_approvals_org_user_status_idx` ON `agent_approvals` (`org_id`,`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `agent_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_chats_org_user_idx` ON `agent_chats` (`org_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `agent_chats_updated_idx` ON `agent_chats` (`updated_at`);--> statement-breakpoint
CREATE TABLE `agent_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text,
	`user_scope` text GENERATED ALWAYS AS (coalesce(user_id, '')) VIRTUAL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_memory_org_user_key_idx` ON `agent_memory` (`org_id`,`user_scope`,`key`);--> statement-breakpoint
CREATE INDEX `agent_memory_org_user_idx` ON `agent_memory` (`org_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `ai_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`feedback_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`model` text,
	`gateway_id` text,
	`result_draft_version_id` text,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`feedback_id`) REFERENCES `feedback`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_jobs_feedback_idx` ON `ai_jobs` (`feedback_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`created_by` text,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `api_keys_org_idx` ON `api_keys` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_idx` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_created_by_idx` ON `api_keys` (`created_by`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`feedback_id` text NOT NULL,
	`approved_by` text NOT NULL,
	`comment` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`feedback_id`) REFERENCES `feedback`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `approvals_feedback_idx` ON `approvals` (`feedback_id`);--> statement-breakpoint
CREATE INDEX `approvals_approved_by_idx` ON `approvals` (`approved_by`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`actor_id` text,
	`actor_type` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_events_created_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_org_created_idx` ON `audit_events` (`org_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`target_version_id` text NOT NULL,
	`source` text NOT NULL,
	`body` text NOT NULL,
	`suggested_patch` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`submitted_by` text,
	`api_key_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_version_id`) REFERENCES `skill_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `feedback_skill_idx` ON `feedback` (`skill_id`);--> statement-breakpoint
CREATE INDEX `feedback_status_idx` ON `feedback` (`status`);--> statement-breakpoint
CREATE INDEX `feedback_target_version_idx` ON `feedback` (`target_version_id`);--> statement-breakpoint
CREATE TABLE `oauth_access_token` (
	`id` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`access_token_expires_at` integer NOT NULL,
	`refresh_token_expires_at` integer NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text,
	`scopes` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_access_token_access_token_unique` ON `oauth_access_token` (`access_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_access_token_refresh_token_unique` ON `oauth_access_token` (`refresh_token`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_client_idx` ON `oauth_access_token` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_user_idx` ON `oauth_access_token` (`user_id`);--> statement-breakpoint
CREATE TABLE `oauth_application` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`metadata` text,
	`client_id` text NOT NULL,
	`client_secret` text,
	`redirect_urls` text NOT NULL,
	`type` text NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_application_client_id_unique` ON `oauth_application` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_application_user_idx` ON `oauth_application` (`user_id`);--> statement-breakpoint
CREATE TABLE `oauth_consent` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scopes` text NOT NULL,
	`consent_given` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_consent_client_idx` ON `oauth_consent` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_consent_user_idx` ON `oauth_consent` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_consent_user_client_idx` ON `oauth_consent` (`user_id`,`client_id`);--> statement-breakpoint
CREATE TABLE `org_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_invitations_token_hash_idx` ON `org_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `org_invitations_org_idx` ON `org_invitations` (`org_id`);--> statement-breakpoint
CREATE INDEX `org_invitations_email_idx` ON `org_invitations` (`email`);--> statement-breakpoint
CREATE TABLE `org_mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`upstream_url` text NOT NULL,
	`transport` text DEFAULT 'http' NOT NULL,
	`oauth_client_id` text,
	`oauth_client_secret` text,
	`oauth_scope` text,
	`oauth_resource_url` text,
	`oauth_authorization_server_url` text,
	`access_token` text,
	`refresh_token` text,
	`status` text DEFAULT 'unauthorized' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_mcp_servers_org_name_idx` ON `org_mcp_servers` (`org_id`,`name`);--> statement-breakpoint
CREATE TABLE `org_members` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_members_org_user_idx` ON `org_members` (`org_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `org_members_user_idx` ON `org_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `org_required_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`org_slug` text NOT NULL,
	`skill_repo` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_required_skills_idx` ON `org_required_skills` (`org_id`,`org_slug`,`skill_repo`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`publish_policy` text,
	`install_policy` text,
	`review_rubric` text,
	`execution_policy` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_idx` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`device_type` text,
	`backed_up` integer DEFAULT false NOT NULL,
	`transports` text,
	`aaguid` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkeys_credential_id_unique` ON `passkeys` (`credential_id`);--> statement-breakpoint
CREATE INDEX `passkeys_user_idx` ON `passkeys` (`user_id`);--> statement-breakpoint
CREATE TABLE `project_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`skill_id` text,
	`external_url` text,
	`external_name` text,
	`path` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`label` text,
	`note` text,
	`added_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_items_project_idx` ON `project_items` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_items_project_skill_idx` ON `project_items` (`project_id`,`skill_id`) WHERE skill_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `project_items_project_external_idx` ON `project_items` (`project_id`,`external_url`) WHERE external_url is not null;--> statement-breakpoint
CREATE TABLE `project_members` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`added_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_members_project_user_idx` ON `project_members` (`project_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `project_members_user_idx` ON `project_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_org_slug_idx` ON `projects` (`org_id`,`slug`);--> statement-breakpoint
CREATE INDEX `projects_org_idx` ON `projects` (`org_id`);--> statement-breakpoint
CREATE TABLE `registry_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`org_slug` text NOT NULL,
	`skill_repo` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`latest_version` text,
	`quality_score` integer,
	`impact_score` integer,
	`security_status` text,
	`install_count` integer DEFAULT 0 NOT NULL,
	`activation_count` integer DEFAULT 0 NOT NULL,
	`stars` integer DEFAULT 0 NOT NULL,
	`category` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`compatible_agents` text DEFAULT '[]' NOT NULL,
	`source_type` text DEFAULT 'native' NOT NULL,
	`upstream_repo` text,
	`upstream_url` text,
	`last_reviewed_at` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_entries_skill_id_unique` ON `registry_entries` (`skill_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `registry_org_skill_idx` ON `registry_entries` (`org_slug`,`skill_repo`);--> statement-breakpoint
CREATE INDEX `registry_name_idx` ON `registry_entries` (`name`);--> statement-breakpoint
CREATE INDEX `registry_category_idx` ON `registry_entries` (`category`);--> statement-breakpoint
CREATE INDEX `registry_source_type_idx` ON `registry_entries` (`source_type`);--> statement-breakpoint
CREATE INDEX `registry_skill_repo_idx` ON `registry_entries` (`skill_repo`);--> statement-breakpoint
CREATE TABLE `registry_stars` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_stars_user_skill_idx` ON `registry_stars` (`user_id`,`skill_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `skill_evals` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`version_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`scenarios` text,
	`baseline_score` integer,
	`with_skill_score` integer,
	`uplift` integer,
	`results` text,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `skill_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_evals_skill_idx` ON `skill_evals` (`skill_id`);--> statement-breakpoint
CREATE INDEX `skill_evals_version_idx` ON `skill_evals` (`version_id`,`status`,`completed_at`);--> statement-breakpoint
CREATE TABLE `skill_failure_patterns` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`org_slug` text NOT NULL,
	`skill_repo` text NOT NULL,
	`signature` text NOT NULL,
	`summary` text NOT NULL,
	`suggested_fix` text,
	`occurrences` integer DEFAULT 1 NOT NULL,
	`exemplar_run_ids` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`feedback_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_failure_patterns_sig_idx` ON `skill_failure_patterns` (`skill_id`,`signature`);--> statement-breakpoint
CREATE INDEX `skill_failure_patterns_skill_idx` ON `skill_failure_patterns` (`skill_id`);--> statement-breakpoint
CREATE INDEX `skill_failure_patterns_status_idx` ON `skill_failure_patterns` (`status`);--> statement-breakpoint
CREATE TABLE `skill_files` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `skill_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_files_version_path_idx` ON `skill_files` (`version_id`,`path`);--> statement-breakpoint
CREATE TABLE `skill_inventory` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`repo_full_name` text NOT NULL,
	`file_path` text NOT NULL,
	`local_slug` text,
	`managed` integer DEFAULT false NOT NULL,
	`registry_org_slug` text,
	`registry_repo` text,
	`source_type` text,
	`scope` text,
	`marketplace` text,
	`plugin_name` text,
	`is_symlink` integer DEFAULT false NOT NULL,
	`conformance_status` text,
	`conformance_issues` text,
	`content_hash` text,
	`security_status` text,
	`security_issues` text,
	`scanned_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_inventory_repo_path_idx` ON `skill_inventory` (`org_id`,`repo_full_name`,`file_path`);--> statement-breakpoint
CREATE TABLE `skill_provenance` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`source_id` text,
	`source_path` text NOT NULL,
	`source_commit_sha` text,
	`source_url` text,
	`content_hash` text NOT NULL,
	`synced_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `skill_sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_provenance_skill_id_unique` ON `skill_provenance` (`skill_id`);--> statement-breakpoint
CREATE INDEX `skill_provenance_source_idx` ON `skill_provenance` (`source_id`);--> statement-breakpoint
CREATE TABLE `skill_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`version_id` text NOT NULL,
	`org_slug` text NOT NULL,
	`skill_repo` text NOT NULL,
	`script_path` text NOT NULL,
	`runtime` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`args` text,
	`target_url` text,
	`stdout` text,
	`stderr` text,
	`exit_code` integer,
	`duration_ms` integer,
	`error` text,
	`actor_id` text,
	`actor_type` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `skill_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_runs_created_idx` ON `skill_runs` (`created_at`);--> statement-breakpoint
CREATE INDEX `skill_runs_skill_created_idx` ON `skill_runs` (`skill_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `skill_runs_org_created_idx` ON `skill_runs` (`org_slug`,`created_at`);--> statement-breakpoint
CREATE INDEX `skill_runs_version_idx` ON `skill_runs` (`version_id`);--> statement-breakpoint
CREATE TABLE `skill_source_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`github_owner` text NOT NULL,
	`github_repo` text NOT NULL,
	`discovered_via` text NOT NULL,
	`stars` integer DEFAULT 0 NOT NULL,
	`license` text,
	`match_score` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_at` integer,
	`reviewed_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_source_suggestions_owner_repo_idx` ON `skill_source_suggestions` (`github_owner`,`github_repo`);--> statement-breakpoint
CREATE INDEX `skill_source_suggestions_status_idx` ON `skill_source_suggestions` (`status`);--> statement-breakpoint
CREATE TABLE `skill_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`github_owner` text NOT NULL,
	`github_repo` text NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`discovery_roots` text DEFAULT '["skills"]' NOT NULL,
	`trust_tier` text DEFAULT 'official_mirror' NOT NULL,
	`sync_enabled` integer DEFAULT true NOT NULL,
	`last_synced_at` integer,
	`last_commit_sha` text,
	`last_sync_status` text DEFAULT 'idle' NOT NULL,
	`last_sync_error` text,
	`pending_commit_sha` text,
	`pending_publish_count` integer DEFAULT 0 NOT NULL,
	`license` text,
	`homepage_url` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_sources_owner_repo_idx` ON `skill_sources` (`github_owner`,`github_repo`);--> statement-breakpoint
CREATE INDEX `skill_sources_sync_enabled_idx` ON `skill_sources` (`sync_enabled`);--> statement-breakpoint
CREATE TABLE `skill_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`semver` text NOT NULL,
	`r2_prefix` text NOT NULL,
	`kv_etag` text,
	`quality_score` integer,
	`impact_score` integer,
	`security_status` text,
	`security_issues` text,
	`review_checks` text,
	`plugin_manifest` text,
	`parent_version_id` text,
	`created_by` text,
	`published_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `skill_versions_skill_idx` ON `skill_versions` (`skill_id`);--> statement-breakpoint
CREATE INDEX `skill_versions_status_idx` ON `skill_versions` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `skill_versions_skill_semver_idx` ON `skill_versions` (`skill_id`,`semver`);--> statement-breakpoint
CREATE INDEX `skill_versions_created_by_idx` ON `skill_versions` (`created_by`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`repo` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`description` text,
	`runtime` text DEFAULT 'local' NOT NULL,
	`latest_published_version_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_org_repo_idx` ON `skills` (`org_id`,`repo`);--> statement-breakpoint
CREATE INDEX `skills_visibility_idx` ON `skills` (`visibility`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_user_skill_idx` ON `subscriptions` (`user_id`,`skill_id`);--> statement-breakpoint
CREATE TABLE `telemetry_events` (
	`id` text PRIMARY KEY NOT NULL,
	`org_slug` text NOT NULL,
	`skill_repo` text NOT NULL,
	`event_type` text NOT NULL,
	`project_hash` text,
	`harness` text,
	`scope` text,
	`user_id` text,
	`api_key_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `telemetry_created_idx` ON `telemetry_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `telemetry_skill_created_idx` ON `telemetry_events` (`org_slug`,`skill_repo`,`created_at`,`harness`);--> statement-breakpoint
CREATE INDEX `telemetry_repo_idx` ON `telemetry_events` (`skill_repo`);--> statement-breakpoint
CREATE INDEX `telemetry_user_idx` ON `telemetry_events` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);--> statement-breakpoint
CREATE INDEX `verifications_expires_idx` ON `verifications` (`expires_at`);