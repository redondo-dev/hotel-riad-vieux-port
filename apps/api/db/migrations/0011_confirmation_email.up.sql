-- E-mail of confirmation of the bookings of the website (step R-6): when it was sent, so that
-- each confirmed booking receives it once. NULL: not sent yet (or a booking of the staff).
-- Only additions: nothing is changed in the existing rows.
ALTER TABLE reservations
  ADD COLUMN confirmation_email_sent_at timestamptz,
  -- Failed attempts (address refused by the sending service…): given up after 10.
  ADD COLUMN confirmation_email_attempts smallint NOT NULL DEFAULT 0
    CHECK (confirmation_email_attempts >= 0);

-- The task of the e-mails looks for the confirmed bookings of the website not sent yet.
CREATE INDEX reservations_confirmation_email_idx
  ON reservations (created_at)
  WHERE source = 'website' AND status = 'confirmed' AND confirmation_email_sent_at IS NULL
    AND confirmation_email_attempts < 10;
