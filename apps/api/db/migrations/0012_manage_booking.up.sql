-- « Gérer ma réservation » (step M): the customer opens his booking of the website with a
-- secret link. Its token is kept in manage_token_hash (SHA-256 only, columns of 0004). Only
-- additions: nothing is changed in the existing rows.
ALTER TABLE reservations
  -- Last time a new link was e-mailed on request (« lien perdu »): at most one every 10 minutes.
  ADD COLUMN manage_link_sent_at timestamptz,
  -- E-mail telling the customer his booking is cancelled, sent like the one of confirmation.
  ADD COLUMN cancellation_email_sent_at timestamptz,
  ADD COLUMN cancellation_email_attempts smallint NOT NULL DEFAULT 0
    CHECK (cancellation_email_attempts >= 0);
