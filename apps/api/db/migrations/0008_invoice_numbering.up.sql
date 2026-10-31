-- Invoice numbers are assigned by the database itself (audit QA-01).
--
-- Before this migration, any well-formed number was accepted (for example FA-2027-000500 while
-- the sequence was at 000001), so a bug in the application could create gaps. From now on:
--   * the application inserts an invoice WITHOUT a number; supplying one is refused;
--   * the trigger takes the next number of the series ('FA' invoice, 'AV' credit note) for the
--     year of issue, Paris time (the hotel is in Marseille);
--   * if the insertion fails, the transaction is rolled back and the number is released, so
--     the numbering stays free of gaps.
-- Rules taken from RM-21, still to be confirmed by the accountant.

CREATE OR REPLACE FUNCTION invoices_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.number IS NOT NULL THEN
    RAISE EXCEPTION 'Le numéro de facture est attribué par la base : ne pas le fournir (reçu : %)',
      NEW.number
      USING ERRCODE = '23000';
  END IF;
  -- The issue date is the transaction time, never a value supplied by the application.
  NEW.issued_at := now();
  NEW.number := next_invoice_number(
    CASE NEW.type WHEN 'credit_note' THEN 'AV' ELSE 'FA' END,
    extract(year FROM NEW.issued_at AT TIME ZONE 'Europe/Paris')::smallint
  );
  RETURN NEW;
END;
$$;
