CREATE INDEX "approvals_feedback_idx" ON "approvals" USING btree ("feedback_id");--> statement-breakpoint
CREATE INDEX "approvals_approved_by_idx" ON "approvals" USING btree ("approved_by");--> statement-breakpoint
CREATE INDEX "audit_events_org_created_idx" ON "audit_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_target_version_idx" ON "feedback" USING btree ("target_version_id");--> statement-breakpoint
CREATE INDEX "registry_repo_trgm_idx" ON "registry_entries" USING gin ("skill_repo" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "registry_org_slug_trgm_idx" ON "registry_entries" USING gin ("org_slug" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "skill_evals_version_idx" ON "skill_evals" USING btree ("version_id","status","completed_at");--> statement-breakpoint
CREATE INDEX "skill_runs_skill_created_idx" ON "skill_runs" USING btree ("skill_id","created_at");--> statement-breakpoint
CREATE INDEX "telemetry_skill_created_idx" ON "telemetry_events" USING btree ("org_slug","skill_repo","created_at");