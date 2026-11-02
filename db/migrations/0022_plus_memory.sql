CREATE TABLE `chat_memory_state` (
	`chat_id` integer PRIMARY KEY NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`summary_until_entry_id` integer DEFAULT 0 NOT NULL,
	`summary_token_count` integer DEFAULT 0 NOT NULL,
	`memory_until_entry_id` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`source_chat_id` integer,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`source_chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE set null
);
