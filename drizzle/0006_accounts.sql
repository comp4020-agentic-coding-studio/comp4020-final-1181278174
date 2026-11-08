CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`username_key` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "accounts_username_length" CHECK(length("accounts"."username") BETWEEN 3 AND 30)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_username_key_unique` ON `accounts` (`username_key`);--> statement-breakpoint
CREATE TABLE `reports` (
	`question_id` integer NOT NULL,
	`reporter` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`question_id`, `reporter`),
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reveals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`at` integer NOT NULL,
	`reason` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sealed_authors` (
	`question_id` integer PRIMARY KEY NOT NULL,
	`key_version` integer NOT NULL,
	`envelope` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `secrets` (
	`name` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sign_ins` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sign_ins_by_account` ON `sign_ins` (`account_id`);