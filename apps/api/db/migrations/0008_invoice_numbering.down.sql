-- Restores the trigger of migration 0005: only the issue date is imposed, the number is
-- supplied by the application.
CREATE OR REPLACE FUNCTION invoices_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.issued_at := now();
  RETURN NEW;
END;
$$;
