-- 0004 — Customers and reservations (architecture §4 "Clients et réservations").
--
-- Key guarantee (RM-03): the same room can never be assigned to two active stays that share
-- a night. It is enforced by the database itself (exclusion constraint on reservation_rooms),
-- whatever the application code does, including under concurrent requests.

CREATE TABLE customers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name          text NOT NULL CHECK (length(first_name) BETWEEN 1 AND 100),
  last_name           text NOT NULL CHECK (length(last_name) BETWEEN 1 AND 100),
  -- Deliberately not unique: a family may share one address.
  email               citext NOT NULL,
  phone               text CHECK (length(phone) <= 30),
  address_line        text,
  postal_code         text,
  city                text,
  country_code        char(2) CHECK (country_code ~ '^[A-Z]{2}$'),
  preferred_language  char(2) NOT NULL DEFAULT 'fr' CHECK (preferred_language IN ('fr', 'en')),
  anonymized_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_email_idx ON customers (email);
CREATE INDEX customers_last_name_idx ON customers (lower(last_name));
CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE reservations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference                 text NOT NULL UNIQUE CHECK (reference ~ '^[A-Z0-9]{8}$'),
  customer_id               uuid NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  source                    text NOT NULL CHECK (source IN ('website', 'phone', 'desk')),
  check_in                  date NOT NULL,
  check_out                 date NOT NULL,
  status                    text NOT NULL CHECK (status IN (
                              'pending_payment', 'confirmed', 'checked_in', 'checked_out',
                              'cancelled', 'no_show', 'expired')),
  payment_status            text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN (
                              'unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded')),
  rate_plan                 text NOT NULL CHECK (rate_plan IN ('flexible', 'non_refundable')),
  total_amount_cents        integer NOT NULL CHECK (total_amount_cents >= 0),
  free_cancellation_until   timestamptz,
  cancellation_fee_cents    integer NOT NULL DEFAULT 0 CHECK (cancellation_fee_cents >= 0),
  cancelled_at              timestamptz,
  cancellation_reason       text,
  payment_expires_at        timestamptz,
  manage_token_hash         text UNIQUE,
  manage_token_expires_at   timestamptz,
  -- RM-19: flexible rate guaranteed by a card saved at Stripe. Only Stripe references here.
  stripe_customer_id        text,
  stripe_payment_method_id  text,
  guarantee_status          text NOT NULL DEFAULT 'none'
                              CHECK (guarantee_status IN ('none', 'card_saved', 'charged', 'failed')),
  customer_message          text CHECK (length(customer_message) <= 500),
  internal_notes            text,
  created_by                uuid REFERENCES users (id) ON DELETE RESTRICT,
  -- Optimistic locking: two receptionists cannot silently overwrite each other's changes.
  lock_version              integer NOT NULL DEFAULT 0,
  -- Retention: after 3 years, hidden from everyday searches (direction only).
  archived_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservations_dates_check CHECK (check_out > check_in),
  -- Only the flexible rate has a free cancellation deadline (RM-15, RM-16).
  CONSTRAINT reservations_free_cancellation_check
    CHECK ((rate_plan = 'flexible') = (free_cancellation_until IS NOT NULL)),
  CONSTRAINT reservations_pending_expiry_check
    CHECK (status <> 'pending_payment' OR payment_expires_at IS NOT NULL),
  CONSTRAINT reservations_cancelled_at_check
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
CREATE INDEX reservations_check_in_idx ON reservations (check_in);
CREATE INDEX reservations_check_out_idx ON reservations (check_out);
CREATE INDEX reservations_status_idx ON reservations (status);
CREATE INDEX reservations_customer_id_idx ON reservations (customer_id);
CREATE INDEX reservations_pending_expiry_idx ON reservations (payment_expires_at)
  WHERE status = 'pending_payment';
CREATE TRIGGER reservations_set_updated_at BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One line per booked room. `stay` and `is_active` are derived from the parent reservation by
-- triggers below, so they can never disagree with it.
CREATE TABLE reservation_rooms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id  uuid NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
  category_id     uuid NOT NULL REFERENCES room_categories (id) ON DELETE RESTRICT,
  room_id         uuid REFERENCES rooms (id) ON DELETE RESTRICT,
  adults          smallint NOT NULL CHECK (adults BETWEEN 1 AND 4),
  -- Age of each child (RM-10 supplements, tourist tax exemption).
  children_ages   smallint[] NOT NULL DEFAULT '{}',
  baby_cot        boolean NOT NULL DEFAULT false,
  stay            daterange NOT NULL CHECK (is_valid_stay_range(stay)),
  is_active       boolean NOT NULL DEFAULT true,
  subtotal_cents  integer NOT NULL CHECK (subtotal_cents >= 0),
  CONSTRAINT reservation_rooms_children_check CHECK (
    cardinality(children_ages) <= 3
    AND 0 <= ALL (children_ages)
    AND 17 >= ALL (children_ages)
  ),
  -- RM-03 — no double assignment of a room on overlapping nights.
  -- [12 May, 15 May) and [15 May, 18 May) do not overlap: same-day turnover is allowed (RM-01).
  CONSTRAINT reservation_rooms_no_double_booking EXCLUDE USING gist (
    room_id WITH =,
    stay WITH &&
  ) WHERE (room_id IS NOT NULL AND is_active)
);
CREATE INDEX reservation_rooms_reservation_id_idx ON reservation_rooms (reservation_id);
CREATE INDEX reservation_rooms_category_stay_idx ON reservation_rooms USING gist (category_id, stay)
  WHERE is_active;

-- A line is active while its reservation still holds rooms.
CREATE FUNCTION reservation_holds_rooms(status text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT status NOT IN ('cancelled', 'no_show', 'expired');
$$;

-- On insert or update of a line: copy the dates and active state of its reservation.
CREATE FUNCTION reservation_rooms_sync_from_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent reservations%ROWTYPE;
BEGIN
  SELECT * INTO parent FROM reservations WHERE id = NEW.reservation_id;
  NEW.stay := daterange(parent.check_in, parent.check_out, '[)');
  NEW.is_active := reservation_holds_rooms(parent.status);
  RETURN NEW;
END;
$$;
CREATE TRIGGER reservation_rooms_sync BEFORE INSERT OR UPDATE ON reservation_rooms
  FOR EACH ROW EXECUTE FUNCTION reservation_rooms_sync_from_reservation();

-- On a change of dates or status: propagate to the lines. Moving the dates of a reservation
-- whose room is taken on the new nights therefore fails with the exclusion constraint.
CREATE FUNCTION reservations_propagate_to_rooms() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE reservation_rooms
     SET stay = daterange(NEW.check_in, NEW.check_out, '[)'),
         is_active = reservation_holds_rooms(NEW.status)
   WHERE reservation_id = NEW.id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER reservations_propagate AFTER UPDATE OF check_in, check_out, status ON reservations
  FOR EACH ROW
  WHEN (OLD.check_in IS DISTINCT FROM NEW.check_in
     OR OLD.check_out IS DISTINCT FROM NEW.check_out
     OR OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION reservations_propagate_to_rooms();

-- Price of each night, frozen at booking time (RM-14): later rate changes never alter it.
CREATE TABLE reservation_nights (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_room_id  uuid NOT NULL REFERENCES reservation_rooms (id) ON DELETE CASCADE,
  night                date NOT NULL,
  price_cents          integer NOT NULL CHECK (price_cents >= 0),
  rate_label           text,
  CONSTRAINT reservation_nights_unique_night UNIQUE (reservation_room_id, night)
);

-- Services, tourist tax and fees attached to a stay. `invoice_id` is added in 0005.
CREATE TABLE reservation_charges (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id       uuid NOT NULL REFERENCES reservations (id) ON DELETE RESTRICT,
  reservation_room_id  uuid REFERENCES reservation_rooms (id) ON DELETE RESTRICT,
  kind                 text NOT NULL CHECK (kind IN (
                         'service', 'tourist_tax', 'cancellation_fee', 'no_show_fee', 'other')),
  service_id           uuid REFERENCES services (id) ON DELETE RESTRICT,
  label                text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  quantity             numeric(8, 2) NOT NULL CHECK (quantity > 0),
  unit_price_cents     integer NOT NULL CHECK (unit_price_cents >= 0),
  vat_rate             numeric(5, 2) NOT NULL CHECK (vat_rate BETWEEN 0 AND 100),
  total_cents          integer NOT NULL CHECK (total_cents >= 0),
  created_by           uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reservation_charges_reservation_id_idx ON reservation_charges (reservation_id);
