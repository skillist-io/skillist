DROP INDEX `agent_approvals_call_idx`;--> statement-breakpoint
ALTER TABLE `agent_approvals` ADD `decided_by` text;--> statement-breakpoint
ALTER TABLE `agent_approvals` ADD `executed_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_approvals_open_call_idx` ON `agent_approvals` (`org_id`,`user_id`,`tool_name`,`call_signature`) WHERE "agent_approvals"."status" in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX `agent_approvals_call_lookup_idx` ON `agent_approvals` (`org_id`,`user_id`,`tool_name`,`call_signature`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_approvals_org_created_idx` ON `agent_approvals` (`org_id`,`created_at`);