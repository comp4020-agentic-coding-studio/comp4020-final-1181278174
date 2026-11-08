CREATE TABLE `classes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `classes_by_session` ON `classes` (`session_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `classes_one_on` ON `classes` (`session_id`) WHERE ended_at IS NULL;