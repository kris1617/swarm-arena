CREATE TABLE `.bootstrap-scaffold_simulation_run` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` text NOT NULL,
	`seed` integer NOT NULL,
	`boidCount` integer NOT NULL,
	`separationWeight` real NOT NULL,
	`alignmentWeight` real NOT NULL,
	`cohesionWeight` real NOT NULL,
	`maxDurationSeconds` integer NOT NULL,
	`predatorCount` integer NOT NULL,
	`protectionThreshold` integer NOT NULL,
	`foodStockInitial` real NOT NULL,
	`foodRegenRate` real NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`score` real,
	`startedAt` integer DEFAULT (unixepoch()) NOT NULL,
	`stoppedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `.bootstrap-scaffold_user`(`id`) ON UPDATE no action ON DELETE cascade
);
