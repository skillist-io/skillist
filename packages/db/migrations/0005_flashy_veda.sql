ALTER TABLE `agent_approvals` ADD `revoked_at` integer;--> statement-breakpoint
ALTER TABLE `agent_approvals` ADD `revoked_by` text;--> statement-breakpoint
ALTER TABLE `agent_approvals` ADD `outcome_reason` text;