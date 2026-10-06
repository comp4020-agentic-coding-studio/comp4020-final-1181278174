CREATE TABLE `questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`body` text NOT NULL,
	`asker` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "questions_body_length" CHECK(length("questions"."body") BETWEEN 1 AND 240)
);
--> statement-breakpoint
CREATE INDEX `questions_by_session` ON `questions` (`session_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`host` text,
	`created_at` integer NOT NULL,
	`closed_at` integer,
	CONSTRAINT "sessions_code_shape" CHECK("sessions"."code" GLOB '[2-9A-HJKMNP-Z][2-9A-HJKMNP-Z][2-9A-HJKMNP-Z][2-9A-HJKMNP-Z]'),
	CONSTRAINT "sessions_title_length" CHECK(length("sessions"."title") BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_code_unique` ON `sessions` (`code`);--> statement-breakpoint
CREATE TABLE `votes` (
	`question_id` integer NOT NULL,
	`person` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`question_id`, `person`),
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
