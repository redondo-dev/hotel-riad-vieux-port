-- Reverts 0005. Refused by the migration runner in production: it would delete invoices.
DROP TRIGGER IF EXISTS reservation_charges_no_truncate ON reservation_charges;
DROP TRIGGER IF EXISTS reservation_charges_protect ON reservation_charges;
DROP FUNCTION IF EXISTS reservation_charges_protect();
ALTER TABLE reservation_charges DROP COLUMN IF EXISTS invoice_id;
DROP TABLE IF EXISTS invoice_lines;
DROP FUNCTION IF EXISTS invoice_lines_protect();
DROP TABLE IF EXISTS invoices;
DROP FUNCTION IF EXISTS invoices_protect();
DROP FUNCTION IF EXISTS invoices_before_insert();
DROP FUNCTION IF EXISTS next_invoice_number(text, smallint);
DROP TABLE IF EXISTS invoice_sequences;
DROP TABLE IF EXISTS payments;
DROP FUNCTION IF EXISTS payments_protect();
