CREATE TABLE `marks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`at` integer NOT NULL,
	`label` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "marks_label_length" CHECK(length("marks"."label") BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE INDEX `marks_by_session` ON `marks` (`session_id`,`at`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `recording_at` integer;