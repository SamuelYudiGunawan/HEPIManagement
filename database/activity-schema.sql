CREATE TABLE IF NOT EXISTS hepi_daily_activity (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  submitted_at VARCHAR(40) NOT NULL DEFAULT '',
  activity_date DATE NOT NULL,
  agent_code VARCHAR(32) NOT NULL,
  agent_name VARCHAR(160) NOT NULL DEFAULT '',
  listing_count INT UNSIGNED NOT NULL DEFAULT 0,
  content_count INT UNSIGNED NOT NULL DEFAULT 0,
  posting_count INT UNSIGNED NOT NULL DEFAULT 0,
  survey_count INT UNSIGNED NOT NULL DEFAULT 0,
  closing_count INT UNSIGNED NOT NULL DEFAULT 0,
  listing_score DECIMAL(12,2) NULL DEFAULT NULL,
  content_score DECIMAL(12,2) NULL DEFAULT NULL,
  posting_score DECIMAL(12,2) NULL DEFAULT NULL,
  survey_score DECIMAL(12,2) NULL DEFAULT NULL,
  closing_score DECIMAL(12,2) NULL DEFAULT NULL,
  total_score DECIMAL(12,2) NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hepi_activity_date_agent (activity_date, agent_code),
  KEY ix_hepi_activity_agent_date (agent_code, activity_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hepi_meeting_attendance (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  attendance_date DATE NOT NULL,
  agent_code VARCHAR(32) NOT NULL,
  agent_name VARCHAR(160) NOT NULL DEFAULT '',
  submitted_at VARCHAR(40) NOT NULL DEFAULT '',
  points INT UNSIGNED NOT NULL DEFAULT 100,
  ip_address VARCHAR(45) NOT NULL DEFAULT '',
  distance_meters INT UNSIGNED NOT NULL DEFAULT 0,
  accuracy_meters DECIMAL(10,2) NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hepi_attendance_date_agent (attendance_date, agent_code),
  KEY ix_hepi_attendance_agent_date (agent_code, attendance_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
