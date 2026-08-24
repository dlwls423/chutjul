CREATE TABLE `rag_documents` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `title` text NOT NULL, `document_type` text NOT NULL, `department` text, `category` text, `source_file` text, `storage_key` text, `original_text` text, `masked_text` text, `status` text DEFAULT 'pending' NOT NULL, `content_hash` text UNIQUE, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `idx_rag_documents_type_status` ON `rag_documents` (`document_type`,`status`);
--> statement-breakpoint
CREATE TABLE `rag_chunks` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `document_id` integer NOT NULL, `chunk_index` integer NOT NULL, `content` text NOT NULL, `embedding` text, `metadata` text, FOREIGN KEY (`document_id`) REFERENCES `rag_documents`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE INDEX `idx_rag_chunks_document_id` ON `rag_chunks` (`document_id`);
--> statement-breakpoint
CREATE TABLE `simple_documents` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `title` text NOT NULL, `content` text NOT NULL, `document_type` text NOT NULL, `department` text, `law_name` text, `article` text, `source_url` text, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `idx_simple_documents_type_department` ON `simple_documents` (`document_type`,`department`);
--> statement-breakpoint
CREATE TABLE `answer_logs` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `complaint_title` text NOT NULL, `complaint_original` text, `complaint_masked` text NOT NULL, `jurisdiction` text, `category` text, `issues` text, `draft_answer` text NOT NULL, `evidence_json` text NOT NULL, `assignee` text, `received_at` text, `answered_at` text, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `idx_answer_logs_received_at` ON `answer_logs` (`received_at`);
--> statement-breakpoint
PRAGMA optimize;
