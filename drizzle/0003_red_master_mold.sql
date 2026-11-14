CREATE TABLE `.bootstrap-scaffold_admin_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`parameterRanges` text NOT NULL,
	`maxObjectCount` integer DEFAULT 500 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `.bootstrap-scaffold_simulation_run` ADD `savedState` text;