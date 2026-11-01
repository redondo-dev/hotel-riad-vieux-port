-- 0003 — Catalogue: room categories, rooms, seasonal rates, sales closures, services
-- (architecture §4 "Catalogue").

CREATE TABLE room_categories (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_fr            text NOT NULL,
  name_en            text NOT NULL,
  description_fr     text NOT NULL,
  description_en     text NOT NULL,
  -- Surface and beds come from the validated UI/UX specification (room cards).
  beds_fr            text NOT NULL,
  beds_en            text NOT NULL,
  area_sqm           smallint NOT NULL CHECK (area_sqm > 0),
  max_occupancy      smallint NOT NULL CHECK (max_occupancy BETWEEN 1 AND 10),
  -- RM-10: guests included in the price; above that, a supplement per adult or child.
  base_occupancy     smallint NOT NULL DEFAULT 2,
  base_price_cents   integer NOT NULL CHECK (base_price_cents > 0),
  extra_adult_cents  integer NOT NULL DEFAULT 2500 CHECK (extra_adult_cents >= 0),
  extra_child_cents  integer NOT NULL DEFAULT 1500 CHECK (extra_child_cents >= 0),
  amenities          text[] NOT NULL DEFAULT '{}',
  sort_order         smallint NOT NULL DEFAULT 0,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_categories_base_occupancy_check
    CHECK (base_occupancy BETWEEN 1 AND max_occupancy)
);
CREATE TRIGGER room_categories_set_updated_at BEFORE UPDATE ON room_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE category_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  uuid NOT NULL REFERENCES room_categories (id) ON DELETE CASCADE,
  storage_key  text NOT NULL,
  alt_fr       text NOT NULL CHECK (length(alt_fr) > 0),
  alt_en       text NOT NULL CHECK (length(alt_en) > 0),
  sort_order   smallint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX category_photos_category_id_idx ON category_photos (category_id);

-- "Out of service" is not a column: it is derived from the active room_blocks (0006).
CREATE TABLE rooms (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number               text NOT NULL UNIQUE CHECK (number ~ '^[0-9A-Za-z-]{1,10}$'),
  floor                smallint NOT NULL,
  category_id          uuid NOT NULL REFERENCES room_categories (id) ON DELETE RESTRICT,
  housekeeping_status  text NOT NULL DEFAULT 'clean' CHECK (housekeeping_status IN ('clean', 'dirty')),
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rooms_category_id_idx ON rooms (category_id);
CREATE TRIGGER rooms_set_updated_at BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seasons and events (RM-08, RM-09). Pricing priority, applied by the API:
-- event > season; on the same level, a category-specific period > a period for all categories.
CREATE TABLE rate_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  kind            text NOT NULL CHECK (kind IN ('season', 'event')),
  period          daterange NOT NULL CHECK (is_valid_stay_range(period)),
  adjustment_pct  numeric(6, 2) NOT NULL CHECK (adjustment_pct >= -100),
  category_id     uuid REFERENCES room_categories (id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Two periods of the same kind and the same scope (all categories, or the same category)
  -- may not share a night: the price would be ambiguous.
  CONSTRAINT rate_periods_no_overlap EXCLUDE USING gist (
    kind WITH =,
    (COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    period WITH &&
  )
);
CREATE INDEX rate_periods_period_idx ON rate_periods USING gist (period);
CREATE TRIGGER rate_periods_set_updated_at BEFORE UPDATE ON rate_periods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A category closed for online and desk sales on some nights (EF-23).
CREATE TABLE sales_closures (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  uuid NOT NULL REFERENCES room_categories (id) ON DELETE CASCADE,
  period       daterange NOT NULL CHECK (is_valid_stay_range(period)),
  reason       text,
  created_by   uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_closures_category_period_idx ON sales_closures USING gist (category_id, period);

CREATE TABLE services (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_fr           text NOT NULL,
  name_en           text NOT NULL,
  unit_price_cents  integer NOT NULL CHECK (unit_price_cents >= 0),
  pricing_unit      text NOT NULL
                      CHECK (pricing_unit IN ('per_person_night', 'per_night', 'per_stay', 'per_unit')),
  vat_rate          numeric(5, 2) NOT NULL CHECK (vat_rate BETWEEN 0 AND 100),
  bookable_online   boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER services_set_updated_at BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
