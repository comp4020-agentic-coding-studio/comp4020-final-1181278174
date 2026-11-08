CREATE TABLE `presence` (
	`session_id` integer NOT NULL,
	`minute` integer NOT NULL,
	`most` integer NOT NULL,
	`last` integer NOT NULL,
	PRIMARY KEY(`session_id`, `minute`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
