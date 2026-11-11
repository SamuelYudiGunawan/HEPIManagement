-- Run once in phpMyAdmin before importing if the tables were created from
-- the earlier schema where these activity count columns were UNSIGNED.
ALTER TABLE hepi_daily_activity
  MODIFY listing_count INT NOT NULL DEFAULT 0,
  MODIFY content_count INT NOT NULL DEFAULT 0,
  MODIFY posting_count INT NOT NULL DEFAULT 0,
  MODIFY survey_count INT NOT NULL DEFAULT 0,
  MODIFY closing_count INT NOT NULL DEFAULT 0;
