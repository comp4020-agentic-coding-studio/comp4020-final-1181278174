CREATE TABLE `hands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`person` text NOT NULL,
	`raised_at` integer NOT NULL,
	`lowered_at` integer,
	`ended` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hands_by_session` ON `hands` (`session_id`,`raised_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `hands_one_up` ON `hands` (`session_id`,`person`) WHERE lowered_at IS NULL;