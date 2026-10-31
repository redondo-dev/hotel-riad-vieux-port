-- Invoice lines cannot be added to an invoice issued in an earlier transaction.
-- This test needs two committed transactions: the runner executes it on a throwaway database.
\ir _helpers.sql

BEGIN;
INSERT INTO customers (id, first_name, last_name, email)
VALUES ('00000000-0000-0000-0000-0000000000c6', 'Test', 'Lignes', 'lignes@example.org');
INSERT INTO reservations (id, reference, customer_id, source, check_in, check_out, status,
                          rate_plan, total_amount_cents)
VALUES ('00000000-0000-0000-0000-0000000000a6', 'TESTLIN1', '00000000-0000-0000-0000-0000000000c6',
        'desk', '2027-04-01', '2027-04-02', 'checked_out', 'non_refundable', 9500);
INSERT INTO invoices (id, number, type, reservation_id, bill_to_name, bill_to_address,
                      total_excl_tax_cents, total_vat_cents, total_incl_tax_cents)
VALUES ('00000000-0000-0000-0000-0000000000f6', next_invoice_number('FA', 2028::smallint),
        'invoice', '00000000-0000-0000-0000-0000000000a6', 'Test Lignes', '{}', 8636, 864, 9500);
COMMIT;

BEGIN;
SELECT pg_temp.expect_error('Ajouter une ligne à une facture émise dans une transaction antérieure est refusé', $$
  INSERT INTO invoice_lines (invoice_id, position, label, quantity, unit_price_incl_tax_cents,
                             vat_rate, total_excl_tax_cents, total_vat_cents, total_incl_tax_cents)
  VALUES ('00000000-0000-0000-0000-0000000000f6', 1, 'Ajout tardif', 1, 100, 10, 91, 9, 100)
$$, '23000');
ROLLBACK;
