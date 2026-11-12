DROP INDEX reservations_confirmation_email_idx;
ALTER TABLE reservations
  DROP COLUMN confirmation_email_attempts,
  DROP COLUMN confirmation_email_sent_at;
