CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS users (
 id CHAR(32) PRIMARY KEY, email VARCHAR(254) NOT NULL UNIQUE, name VARCHAR(80) NOT NULL,
 password_hash VARCHAR(256) NOT NULL, offline_salt CHAR(32) NOT NULL, created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS sessions (
 token_hash CHAR(64) PRIMARY KEY, user_id CHAR(32) NOT NULL, csrf CHAR(64) NOT NULL,
 expires_at BIGINT NOT NULL, last_active BIGINT NOT NULL, locked BOOLEAN NOT NULL DEFAULT FALSE,
 idle_minutes INT NOT NULL DEFAULT 15, INDEX(user_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS reset_tokens (
 token_hash CHAR(64) PRIMARY KEY, user_id CHAR(32) NOT NULL, expires_at BIGINT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS folders (
 id CHAR(36) PRIMARY KEY, user_id CHAR(32) NOT NULL, name VARCHAR(80) NOT NULL,
 UNIQUE(user_id,name), UNIQUE(id,user_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS tags (
 id CHAR(36) PRIMARY KEY, user_id CHAR(32) NOT NULL, name VARCHAR(80) NOT NULL,
 UNIQUE(user_id,name), UNIQUE(id,user_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS notes (
 id CHAR(36) PRIMARY KEY, user_id CHAR(32) NOT NULL, title VARCHAR(500) NOT NULL DEFAULT '',
 content MEDIUMTEXT NOT NULL, plain_text MEDIUMTEXT NOT NULL, folder_id CHAR(36) NULL,
 pinned BOOLEAN NOT NULL DEFAULT FALSE, favorite BOOLEAN NOT NULL DEFAULT FALSE,
 archived BOOLEAN NOT NULL DEFAULT FALSE, deleted BOOLEAN NOT NULL DEFAULT FALSE, locked BOOLEAN NOT NULL DEFAULT FALSE,
 color VARCHAR(20) NOT NULL DEFAULT 'white', created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
 revision BIGINT NOT NULL DEFAULT 1, UNIQUE(id,user_id), INDEX(user_id,updated_at), INDEX(user_id,deleted,archived),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(folder_id,user_id) REFERENCES folders(id,user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS note_tags (
 note_id CHAR(36) NOT NULL, tag_id CHAR(36) NOT NULL, user_id CHAR(32) NOT NULL,
 PRIMARY KEY(note_id,tag_id), FOREIGN KEY(note_id,user_id) REFERENCES notes(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(tag_id,user_id) REFERENCES tags(id,user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS attachments (
 id CHAR(32) PRIMARY KEY, note_id CHAR(36) NOT NULL, user_id CHAR(32) NOT NULL, kind ENUM('image','audio') NOT NULL,
 mime VARCHAR(80) NOT NULL, name VARCHAR(200) NOT NULL, storage_key CHAR(32) NOT NULL UNIQUE,
 bytes BIGINT NOT NULL, created_at BIGINT NOT NULL, FOREIGN KEY(note_id,user_id) REFERENCES notes(id,user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS reminders (
 note_id CHAR(36) PRIMARY KEY, user_id CHAR(32) NOT NULL, due_at BIGINT NOT NULL,
 delivered BOOLEAN NOT NULL DEFAULT FALSE, INDEX(delivered,due_at),
 FOREIGN KEY(note_id,user_id) REFERENCES notes(id,user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS reminder_events (
 id CHAR(32) PRIMARY KEY, note_id CHAR(36) NOT NULL, user_id CHAR(32) NOT NULL, due_at BIGINT NOT NULL,
 acknowledged BOOLEAN NOT NULL DEFAULT FALSE, UNIQUE(note_id,due_at), INDEX(user_id,acknowledged),
 FOREIGN KEY(note_id,user_id) REFERENCES notes(id,user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS note_unlocks (
 session_hash CHAR(64) NOT NULL, note_id CHAR(36) NOT NULL, expires_at BIGINT NOT NULL,
 PRIMARY KEY(session_hash,note_id), FOREIGN KEY(session_hash) REFERENCES sessions(token_hash) ON DELETE CASCADE,
 FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS share_links (
 token_hash CHAR(64) PRIMARY KEY, note_id CHAR(36) NOT NULL, user_id CHAR(32) NOT NULL,
 created_at BIGINT NOT NULL, locked_authorized BOOLEAN NOT NULL DEFAULT FALSE,
 FOREIGN KEY(note_id,user_id) REFERENCES notes(id,user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS recent_access (
 user_id CHAR(32) NOT NULL, note_id CHAR(36) NOT NULL, opened_at BIGINT NOT NULL,
 PRIMARY KEY(user_id,note_id), FOREIGN KEY(note_id,user_id) REFERENCES notes(id,user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS saved_searches (
 id CHAR(32) PRIMARY KEY, user_id CHAR(32) NOT NULL, name VARCHAR(80) NOT NULL, query TEXT NOT NULL, filters JSON NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS changes (
 sequence BIGINT AUTO_INCREMENT PRIMARY KEY, user_id CHAR(32) NOT NULL, note_id CHAR(36) NOT NULL,
 revision BIGINT NOT NULL, operation ENUM('upsert','delete') NOT NULL, changed_at BIGINT NOT NULL,
 INDEX(user_id,sequence), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO schema_migrations(version) VALUES(1);

CREATE TABLE IF NOT EXISTS reset_codes (
 request_hash CHAR(64) PRIMARY KEY, user_id CHAR(32) NOT NULL,
 code_hash CHAR(64) NOT NULL, expires_at BIGINT NOT NULL, attempts INT NOT NULL DEFAULT 0,
 INDEX(user_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trash_entries (
 note_id CHAR(36) PRIMARY KEY, user_id CHAR(32) NOT NULL, deleted_at BIGINT NOT NULL,
 INDEX(deleted_at), FOREIGN KEY(note_id,user_id) REFERENCES notes(id,user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
