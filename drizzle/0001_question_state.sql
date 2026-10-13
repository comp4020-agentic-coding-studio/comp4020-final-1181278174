-- The CHECK is written by hand: Drizzle only knows table-level checks, and
-- adding one of those to an existing table means rebuilding the table.
ALTER TABLE `questions` ADD `state` text DEFAULT 'open' NOT NULL CHECK (`state` IN ('open', 'answered', 'hidden'));
