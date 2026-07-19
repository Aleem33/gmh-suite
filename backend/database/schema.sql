SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS documents (
  collection_name VARCHAR(96) NOT NULL,
  document_id VARCHAR(192) NOT NULL,
  data JSON NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  PRIMARY KEY (collection_name, document_id),
  KEY idx_documents_collection_updated (collection_name, updated_at, document_id),
  KEY idx_documents_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS document_indexes (
  collection_name VARCHAR(96) NOT NULL,
  document_id VARCHAR(192) NOT NULL,
  field_name VARCHAR(96) NOT NULL,
  string_value VARCHAR(512) NULL,
  number_value DECIMAL(30, 10) NULL,
  boolean_value TINYINT(1) NULL,
  date_value DATETIME(6) NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (collection_name, document_id, field_name),
  KEY idx_document_indexes_string (collection_name, field_name, string_value(255), document_id(96)),
  KEY idx_document_indexes_number (collection_name, field_name, number_value, document_id),
  KEY idx_document_indexes_date (collection_name, field_name, date_value, document_id),
  CONSTRAINT fk_document_indexes_document
    FOREIGN KEY (collection_name, document_id)
    REFERENCES documents (collection_name, document_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS document_events (
  sequence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id CHAR(36) NOT NULL,
  collection_name VARCHAR(96) NOT NULL,
  document_id VARCHAR(192) NOT NULL,
  operation ENUM('upsert', 'delete') NOT NULL,
  document_version BIGINT UNSIGNED NOT NULL,
  payload JSON NULL,
  actor_uid VARCHAR(192) NULL,
  actor_username VARCHAR(128) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  mirror_status ENUM('pending', 'processing', 'retry', 'synced', 'dead') NOT NULL DEFAULT 'pending',
  mirror_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  mirror_next_attempt_at DATETIME(6) NULL,
  mirror_last_error TEXT NULL,
  mirrored_at DATETIME(6) NULL,
  PRIMARY KEY (sequence_id),
  UNIQUE KEY uq_document_events_event (event_id),
  KEY idx_document_events_changes (sequence_id, collection_name),
  KEY idx_document_events_mirror (mirror_status, mirror_next_attempt_at, sequence_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  actor_uid VARCHAR(192) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status_code SMALLINT UNSIGNED NULL,
  response_body JSON NULL,
  locked_until DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at DATETIME(6) NOT NULL,
  PRIMARY KEY (actor_uid, idempotency_key),
  KEY idx_idempotency_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sync_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id CHAR(36) NOT NULL,
  trigger_type ENUM('cron', 'manual') NOT NULL,
  status ENUM('running', 'completed', 'partial', 'failed') NOT NULL,
  started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at DATETIME(6) NULL,
  attempted_count INT UNSIGNED NOT NULL DEFAULT 0,
  synced_count INT UNSIGNED NOT NULL DEFAULT 0,
  retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_sequence_id BIGINT UNSIGNED NULL,
  error_message TEXT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sync_runs_run (run_id),
  KEY idx_sync_runs_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_locks (
  lock_name VARCHAR(128) NOT NULL,
  owner_id VARCHAR(192) NOT NULL,
  locked_until DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (lock_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
