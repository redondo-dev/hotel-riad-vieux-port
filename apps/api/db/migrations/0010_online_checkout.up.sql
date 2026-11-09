-- Online booking (step R-3): the Stripe Checkout page opened for a reservation waiting for its
-- payment, so that the notification of Stripe (step R-5) finds the reservation again. Only an
-- identifier of Stripe: never any card data. Unique: one page belongs to one reservation.
ALTER TABLE reservations
  ADD COLUMN stripe_checkout_session_id text UNIQUE;
