ALTER TABLE `.bootstrap-scaffold_simulation_run` ADD `flockCount` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `.bootstrap-scaffold_simulation_run` ADD `crossbreedingEnabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `.bootstrap-scaffold_simulation_run` ADD `energyThreshold` real DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE `.bootstrap-scaffold_simulation_run` ADD `mutationChance` real DEFAULT 0.1 NOT NULL;--> statement-breakpoint
ALTER TABLE `.bootstrap-scaffold_simulation_run` ADD `mutationMagnitude` real DEFAULT 0.2 NOT NULL;