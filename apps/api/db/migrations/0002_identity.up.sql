-- 0002 — Staff accounts, sessions and hotel settings (architecture §4 "Paramètres et personnel").

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 citext NOT NULL UNIQUE,
  password_hash         text NOT NULL,
  first_name            text NOT NULL CHECK (length(first_name) BETWEEN 1 AND 100),
  last_name             text NOT NULL CHECK (length(last_name) BETWEEN 1 AND 100),
  role                  text NOT NULL
                          CHECK (role IN ('direction', 'reception', 'housekeeping', 'technician')),
  is_active             boolean NOT NULL DEFAULT true,
  failed_login_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until          timestamptz,
  last_login_at         timestamptz,
  password_changed_at   timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Only the hash of the reset token is stored; tokens are single-use and short-lived.
CREATE TABLE password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_user_id_idx ON password_reset_tokens (user_id);
CREATE INDEX password_reset_tokens_expires_at_idx ON password_reset_tokens (expires_at);

-- Server-side sessions of the staff tool (managed by the session library).
CREATE TABLE user_sessions (
  sid     varchar(255) PRIMARY KEY,
  sess    jsonb NOT NULL,
  expire  timestamptz NOT NULL
);
CREATE INDEX user_sessions_expire_idx ON user_sessions (expire);

-- Exactly one row: the hotel's settings, editable by the management (EF-50, RM-06, RM-11…).
CREATE TABLE hotel_settings (
  id                                 smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name                               text NOT NULL,
  address                            text NOT NULL,
  phone                              text NOT NULL,
  email                              citext NOT NULL,
  legal_identifiers                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  check_in_time                      time NOT NULL DEFAULT '15:00',
  check_out_time                     time NOT NULL DEFAULT '12:00',
  free_cancellation_hours            integer NOT NULL DEFAULT 48 CHECK (free_cancellation_hours >= 0),
  non_refundable_discount_pct        numeric(5, 2) NOT NULL DEFAULT 10
                                       CHECK (non_refundable_discount_pct BETWEEN 0 AND 100),
  tourist_tax_cents_per_adult_night  integer NOT NULL DEFAULT 0
                                       CHECK (tourist_tax_cents_per_adult_night >= 0),
  pending_payment_ttl_minutes        integer NOT NULL DEFAULT 15
                                       CHECK (pending_payment_ttl_minutes > 0),
  manage_link_days_after_checkout    integer NOT NULL DEFAULT 30
                                       CHECK (manage_link_days_after_checkout >= 0),
  online_max_stay_nights             smallint NOT NULL DEFAULT 30 CHECK (online_max_stay_nights >= 1),
  online_booking_horizon_days        smallint NOT NULL DEFAULT 365
                                       CHECK (online_booking_horizon_days >= 1),
  same_day_cutoff_time               time NOT NULL DEFAULT '23:00',
  updated_at                         timestamptz NOT NULL DEFAULT now(),
  updated_by                         uuid REFERENCES users (id) ON DELETE RESTRICT
);
CREATE TRIGGER hotel_settings_set_updated_at BEFORE UPDATE ON hotel_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
