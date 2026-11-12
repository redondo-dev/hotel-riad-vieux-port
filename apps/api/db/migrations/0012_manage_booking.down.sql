ALTER TABLE reservations
  DROP COLUMN cancellation_email_attempts,
  DROP COLUMN cancellation_email_sent_at,
  DROP COLUMN manage_link_sent_at;
