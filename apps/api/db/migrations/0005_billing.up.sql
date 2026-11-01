-- 0005 — Payments and invoicing (architecture §4 "Paiements et facturation").
--
-- Rules enforced by the database (RM-21, to be confirmed by the accountant):
--   * invoice numbers form a continuous sequence per series and year, without gaps;
--   * an issued invoice is never modified nor deleted: it is corrected by a credit note;
--   * a succeeded payment is never modified: a mistake is corrected by a refund;
--   * an invoiced charge can no longer be modified.
-- No card data is ever stored: only Stripe references.

CREATE TABLE payments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id            uuid NOT NULL REFERENCES reservations (id) ON DELETE RESTRICT,
  kind                      text NOT NULL CHECK (kind IN ('payment', 'refund')),
  method                    text NOT NULL CHECK (method IN (
                              'card_online', 'card_terminal', 'cash', 'bank_transfer',
                              'holiday_voucher')),
  -- Always positive; the direction is given by `kind`.
  amount_cents              integer NOT NULL CHECK (amount_cents > 0),
  status                    text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
  refunded_payment_id       uuid REFERENCES payments (id) ON DELETE RESTRICT,
  stripe_payment_intent_id  text UNIQUE,
  stripe_refund_id          text UNIQUE,
  external_reference        text,
  received_at               timestamptz,
  recorded_by               uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_refund_link_check
    CHECK ((kind = 'refund') = (refunded_payment_id IS NOT NULL))
);
CREATE INDEX payments_reservation_id_idx ON payments (reservation_id);

CREATE FUNCTION payments_protect() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments cannot be deleted; record a refund instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'succeeded' THEN
    RAISE EXCEPTION 'a succeeded payment cannot be modified; record a refund instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payments_protect BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_protect();

-- Last number used per series ('FA' invoices, 'AV' credit notes) and year.
CREATE TABLE invoice_sequences (
  series       text NOT NULL CHECK (series IN ('FA', 'AV')),
  year         smallint NOT NULL CHECK (year BETWEEN 2000 AND 2999),
  last_number  integer NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  PRIMARY KEY (series, year)
);

-- Returns the next number, for example FA-2027-000123. The sequence row stays locked until the
-- transaction ends: if the invoice creation fails, the number is released with the rollback,
-- which keeps the numbering free of gaps (a PostgreSQL SEQUENCE would skip numbers).
CREATE FUNCTION next_invoice_number(p_series text, p_year smallint) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO invoice_sequences AS s (series, year, last_number)
  VALUES (p_series, p_year, 1)
  ON CONFLICT (series, year) DO UPDATE SET last_number = s.last_number + 1
  RETURNING s.last_number INTO n;
  RETURN p_series || '-' || p_year::text || '-' || lpad(n::text, 6, '0');
END;
$$;

CREATE TABLE invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number                text NOT NULL UNIQUE CHECK (number ~ '^(FA|AV)-[0-9]{4}-[0-9]{6}$'),
  type                  text NOT NULL CHECK (type IN ('invoice', 'credit_note')),
  reservation_id        uuid NOT NULL REFERENCES reservations (id) ON DELETE RESTRICT,
  credited_invoice_id   uuid REFERENCES invoices (id) ON DELETE RESTRICT,
  issued_at             timestamptz NOT NULL DEFAULT now(),
  bill_to_name          text NOT NULL,
  bill_to_company       text,
  bill_to_vat_number    text,
  bill_to_address       jsonb NOT NULL,
  total_excl_tax_cents  integer NOT NULL CHECK (total_excl_tax_cents >= 0),
  total_vat_cents       integer NOT NULL CHECK (total_vat_cents >= 0),
  tourist_tax_cents     integer NOT NULL DEFAULT 0 CHECK (tourist_tax_cents >= 0),
  total_incl_tax_cents  integer NOT NULL CHECK (total_incl_tax_cents >= 0),
  pdf_storage_key       text,
  emailed_at            timestamptz,
  issued_by             uuid REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT invoices_credit_note_link_check
    CHECK ((type = 'credit_note') = (credited_invoice_id IS NOT NULL)),
  CONSTRAINT invoices_series_matches_type_check
    CHECK ((type = 'invoice') = (number LIKE 'FA-%')),
  CONSTRAINT invoices_totals_check
    CHECK (total_incl_tax_cents = total_excl_tax_cents + total_vat_cents + tourist_tax_cents)
);
CREATE INDEX invoices_reservation_id_idx ON invoices (reservation_id);
CREATE INDEX invoices_issued_at_idx ON invoices (issued_at);

-- The issue date is the transaction time, never a value supplied by the application.
CREATE FUNCTION invoices_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.issued_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoices_before_insert BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_before_insert();

-- After issue, only the PDF location and the e-mail date may be filled in.
CREATE FUNCTION invoices_protect() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'issued invoice % cannot be deleted; issue a credit note', OLD.number
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (to_jsonb(NEW) - 'pdf_storage_key' - 'emailed_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'pdf_storage_key' - 'emailed_at') THEN
    RAISE EXCEPTION 'issued invoice % cannot be modified; issue a credit note', OLD.number
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoices_protect BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_protect();

CREATE TABLE invoice_lines (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id                 uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  position                   smallint NOT NULL CHECK (position >= 1),
  label                      text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  quantity                   numeric(8, 2) NOT NULL CHECK (quantity > 0),
  unit_price_incl_tax_cents  integer NOT NULL CHECK (unit_price_incl_tax_cents >= 0),
  vat_rate                   numeric(5, 2) NOT NULL CHECK (vat_rate BETWEEN 0 AND 100),
  total_excl_tax_cents       integer NOT NULL CHECK (total_excl_tax_cents >= 0),
  total_vat_cents            integer NOT NULL CHECK (total_vat_cents >= 0),
  total_incl_tax_cents       integer NOT NULL CHECK (total_incl_tax_cents >= 0),
  CONSTRAINT invoice_lines_position_unique UNIQUE (invoice_id, position),
  CONSTRAINT invoice_lines_totals_check
    CHECK (total_incl_tax_cents = total_excl_tax_cents + total_vat_cents)
);

-- Lines are written once, in the transaction that issues the invoice, then frozen.
CREATE FUNCTION invoice_lines_protect() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_issued_at timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT issued_at INTO invoice_issued_at FROM invoices WHERE id = NEW.invoice_id;
    -- now() is the start time of the current transaction, also used as issued_at.
    IF invoice_issued_at IS DISTINCT FROM now() THEN
      RAISE EXCEPTION 'lines can only be added in the transaction that issues the invoice'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invoice lines cannot be modified or deleted; issue a credit note'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
CREATE TRIGGER invoice_lines_protect BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION invoice_lines_protect();

-- Link charges to the invoice that billed them; once billed, a charge is frozen.
ALTER TABLE reservation_charges
  ADD COLUMN invoice_id uuid REFERENCES invoices (id) ON DELETE RESTRICT;
CREATE INDEX reservation_charges_invoice_id_idx ON reservation_charges (invoice_id);

CREATE FUNCTION reservation_charges_protect() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'charge already invoiced: it cannot be modified or deleted'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reservation_charges_protect BEFORE UPDATE OR DELETE ON reservation_charges
  FOR EACH ROW EXECUTE FUNCTION reservation_charges_protect();

CREATE TRIGGER payments_no_truncate BEFORE TRUNCATE ON payments
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();
CREATE TRIGGER invoices_no_truncate BEFORE TRUNCATE ON invoices
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();
CREATE TRIGGER invoice_lines_no_truncate BEFORE TRUNCATE ON invoice_lines
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();
CREATE TRIGGER reservation_charges_no_truncate BEFORE TRUNCATE ON reservation_charges
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();
