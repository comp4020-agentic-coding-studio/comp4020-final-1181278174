CREATE TABLE `tutorial_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`person` text NOT NULL,
	`ticket` text NOT NULL,
	`requested_at` integer NOT NULL,
	`called_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `tutorial_sessions`(`session_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tutorial_ticket_shape" CHECK("tutorial_requests"."ticket" GLOB '[1-9][0-9][0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tutorial_one_request` ON `tutorial_requests` (`session_id`,`person`);--> statement-breakpoint
CREATE UNIQUE INDEX `tutorial_ticket_unique` ON `tutorial_requests` (`session_id`,`ticket`);--> statement-breakpoint
CREATE UNIQUE INDEX `tutorial_one_called` ON `tutorial_requests` (`session_id`) WHERE called_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX `tutorial_queue_order` ON `tutorial_requests` (`session_id`,`id`);--> statement-breakpoint
CREATE TABLE `tutorial_sessions` (
	`session_id` integer PRIMARY KEY NOT NULL,
	`exercise` text,
	`ends_at` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tutorial_exercise_pair" CHECK(("tutorial_sessions"."exercise" IS NULL AND "tutorial_sessions"."ends_at" IS NULL) OR ("tutorial_sessions"."exercise" IS NOT NULL AND length("tutorial_sessions"."exercise") BETWEEN 1 AND 80 AND "tutorial_sessions"."ends_at" IS NOT NULL)),
	CONSTRAINT "tutorial_revision_nonnegative" CHECK("tutorial_sessions"."revision" >= 0)
);
