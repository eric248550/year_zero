CREATE TABLE `ai_generations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prompt` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`is_mock` integer NOT NULL,
	`raw_output` text,
	`definition_id` text,
	`outcome` text NOT NULL,
	`errors` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`tick` integer NOT NULL,
	`actions` text NOT NULL,
	`rejected` text NOT NULL,
	`choice_overrides` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decisions_run_tick` ON `decisions` (`run_id`,`tick`);--> statement-breakpoint
CREATE TABLE `event_definition_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`definition_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`definition` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `def_versions_def` ON `event_definition_versions` (`definition_id`);--> statement-breakpoint
CREATE TABLE `event_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`definition` text NOT NULL,
	`validation` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`published_at` text
);
--> statement-breakpoint
CREATE TABLE `history_events` (
	`run_id` text NOT NULL,
	`id` text NOT NULL,
	`tick` integer NOT NULL,
	`year` integer NOT NULL,
	`kind` text NOT NULL,
	`definition_id` text,
	`category` text NOT NULL,
	`importance` text NOT NULL,
	`title` text NOT NULL,
	`settlement_ids` text NOT NULL,
	`character_ids` text NOT NULL,
	`storyline_ids` text NOT NULL,
	`payload` text NOT NULL,
	`committed_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `id`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `history_run_tick` ON `history_events` (`run_id`,`tick`);--> statement-breakpoint
CREATE TABLE `run_content` (
	`run_id` text PRIMARY KEY NOT NULL,
	`bundle` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`seed` integer NOT NULL,
	`policy` text NOT NULL,
	`rules_version` text NOT NULL,
	`content_version` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`parent_run_id` text,
	`forked_from_tick` integer,
	`current_tick` integer DEFAULT 0 NOT NULL,
	`head_state` text NOT NULL,
	`head_hash` text NOT NULL,
	`queued_actions` text DEFAULT '[]' NOT NULL,
	`choice_overrides` text DEFAULT '{}' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`tick` integer NOT NULL,
	`state` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_run_tick` ON `snapshots` (`run_id`,`tick`);--> statement-breakpoint
CREATE TABLE `storylines` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`definition` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tick_metrics` (
	`run_id` text NOT NULL,
	`tick` integer NOT NULL,
	`year` integer NOT NULL,
	`population` integer NOT NULL,
	`settlements` integer NOT NULL,
	`food` real NOT NULL,
	`water` real NOT NULL,
	`materials` real NOT NULL,
	`knowledge` real NOT NULL,
	`technologies` integer NOT NULL,
	`births` integer NOT NULL,
	`deaths` integer NOT NULL,
	`morale` real NOT NULL,
	`health` real NOT NULL,
	`events` integer NOT NULL,
	`status` text NOT NULL,
	`exec_ms` real NOT NULL,
	`rejected_events` text NOT NULL,
	PRIMARY KEY(`run_id`, `tick`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
