-- 0001 — Foundations: extensions and shared helper functions.
--
-- btree_gist: lets an exclusion constraint mix "same room" (=) and "overlapping stay" (&&),
--             the database-level guarantee against double room assignment.
-- citext:     case-insensitive e-mail addresses (Alice@x.fr = alice@x.fr).
-- UUIDs are generated with gen_random_uuid(), built into PostgreSQL 13+ (no pgcrypto needed).

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;

-- Keeps updated_at current on every UPDATE.
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- TRUNCATE empties a table without firing row-level triggers. Tables whose rows are protected
-- (invoices, payments, audit trail) also get this statement-level guard.
CREATE FUNCTION forbid_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TRUNCATE is not allowed on %', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

-- A stay or a period of nights: [first night, day after the last night), finite.
-- Example: arrival 12 May, departure 15 May = [2027-05-12, 2027-05-15) = 3 nights.
CREATE FUNCTION is_valid_stay_range(r daterange) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT isempty(r)
     AND NOT lower_inf(r) AND NOT upper_inf(r)
     AND lower_inc(r) AND NOT upper_inc(r);
$$;
