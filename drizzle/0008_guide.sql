CREATE TABLE `account_guides` (
	`account_id` text NOT NULL,
	`role` text NOT NULL,
	`completed_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `role`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_guides_role" CHECK("account_guides"."role" IN ('student', 'host'))
);
