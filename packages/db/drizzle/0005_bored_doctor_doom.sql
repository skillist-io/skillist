CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_idx" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_created_by_idx" ON "api_keys" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "passkeys_user_idx" ON "passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "registry_skill_repo_idx" ON "registry_entries" USING btree ("skill_repo");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "skill_runs_org_created_idx" ON "skill_runs" USING btree ("org_slug","created_at");--> statement-breakpoint
CREATE INDEX "skill_runs_version_idx" ON "skill_runs" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_skill_semver_idx" ON "skill_versions" USING btree ("skill_id","semver");--> statement-breakpoint
CREATE INDEX "skill_versions_created_by_idx" ON "skill_versions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "telemetry_repo_idx" ON "telemetry_events" USING btree ("skill_repo");--> statement-breakpoint
CREATE INDEX "telemetry_user_idx" ON "telemetry_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "verifications_expires_idx" ON "verifications" USING btree ("expires_at");