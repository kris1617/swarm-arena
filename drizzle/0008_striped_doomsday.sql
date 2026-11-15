CREATE TABLE `.bootstrap-scaffold_feedback_report` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`pagePath` text NOT NULL,
	`userAgent` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`githubIssueNumber` integer,
	`githubIssueUrl` text,
	`attemptCount` integer DEFAULT 0 NOT NULL,
	`lastError` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`lastAttemptAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `.bootstrap-scaffold_user`(`id`) ON UPDATE no action ON DELETE cascade
);
