-- Billing: gap-free numbering, frozen invoices and payments (RM-21, to be confirmed by the
-- accountant). Runs inside a transaction that is rolled back.
BEGIN;
\ir _helpers.sql

INSERT INTO customers (id, first_name, last_name, email)
VALUES ('00000000-0000-0000-0000-0000000000c2', 'Test', 'Facture', 'facture@example.org');
INSERT INTO reservations (id, reference, customer_id, source, check_in, check_out, status,
                          rate_plan, total_amount_cents)
VALUES ('00000000-0000-0000-0000-0000000000a2', 'TESTFAC1', '00000000-0000-0000-0000-0000000000c2',
        'desk', '2027-03-01', '2027-03-03', 'checked_out', 'non_refundable', 19000);

-- Numbering.
SELECT pg_temp.expect_equal('Premier numéro de facture de 2027',
  next_invoice_number('FA', 2027::smallint), 'FA-2027-000001');
SELECT pg_temp.expect_equal('Numéro suivant',
  next_invoice_number('FA', 2027::smallint), 'FA-2027-000002');
SAVEPOINT failed_invoice;
SELECT next_invoice_number('FA', 2027::smallint);
ROLLBACK TO SAVEPOINT failed_invoice;
SELECT pg_temp.expect_equal('Un numéro pris par une création annulée est réutilisé (pas de trou)',
  next_invoice_number('FA', 2027::smallint), 'FA-2027-000003');
SELECT pg_temp.expect_equal('Les avoirs ont leur propre suite',
  next_invoice_number('AV', 2027::smallint), 'AV-2027-000001');

-- Issuing an invoice (number FA-2027-000003, obtained above).
INSERT INTO invoices (id, number, type, reservation_id, issued_at, bill_to_name, bill_to_address,
                      total_excl_tax_cents, total_vat_cents, tourist_tax_cents, total_incl_tax_cents)
VALUES ('00000000-0000-0000-0000-0000000000f1', 'FA-2027-000003', 'invoice',
        '00000000-0000-0000-0000-0000000000a2', '2000-01-01', 'Test Facture', '{"city": "Lyon"}',
        17273, 1727, 0, 19000);

SELECT pg_temp.expect_equal('La date d''émission est imposée par la base (pas 2000-01-01)',
  (SELECT issued_at FROM invoices WHERE number = 'FA-2027-000003'), now());

SELECT pg_temp.expect_ok('Lignes ajoutées dans la transaction d''émission', $$
  INSERT INTO invoice_lines (invoice_id, position, label, quantity, unit_price_incl_tax_cents,
                             vat_rate, total_excl_tax_cents, total_vat_cents, total_incl_tax_cents)
  VALUES ('00000000-0000-0000-0000-0000000000f1', 1, '2 nuits, double supérieure', 2, 9500, 10,
          17273, 1727, 19000)
$$);

SELECT pg_temp.expect_error('Modifier le montant d''une facture émise est refusé',
  $$UPDATE invoices SET total_incl_tax_cents = 1, total_excl_tax_cents = 1, total_vat_cents = 0
    WHERE number = 'FA-2027-000003'$$, '23000');
SELECT pg_temp.expect_error('Changer le destinataire d''une facture émise est refusé',
  $$UPDATE invoices SET bill_to_name = 'Autre' WHERE number = 'FA-2027-000003'$$, '23000');
SELECT pg_temp.expect_ok('Renseigner l''emplacement du PDF et la date d''envoi reste possible',
  $$UPDATE invoices SET pdf_storage_key = 'invoices/FA-2027-000003.pdf', emailed_at = now()
    WHERE number = 'FA-2027-000003'$$);
SELECT pg_temp.expect_error('Supprimer une facture est refusé',
  $$DELETE FROM invoices WHERE number = 'FA-2027-000003'$$, '23000');
SELECT pg_temp.expect_error('Vider la table des factures (TRUNCATE) est refusé',
  $$TRUNCATE invoices CASCADE$$, '23000');
SELECT pg_temp.expect_error('Modifier une ligne de facture est refusé',
  $$UPDATE invoice_lines SET label = 'x' WHERE invoice_id = '00000000-0000-0000-0000-0000000000f1'$$,
  '23000');
SELECT pg_temp.expect_error('Supprimer une ligne de facture est refusé',
  $$DELETE FROM invoice_lines WHERE invoice_id = '00000000-0000-0000-0000-0000000000f1'$$, '23000');

SELECT pg_temp.expect_error('Totaux incohérents refusés', $$
  INSERT INTO invoices (number, type, reservation_id, bill_to_name, bill_to_address,
                        total_excl_tax_cents, total_vat_cents, total_incl_tax_cents)
  VALUES ('FA-2027-000099', 'invoice', '00000000-0000-0000-0000-0000000000a2', 'X', '{}', 100, 10, 999)
$$, '23514');
SELECT pg_temp.expect_error('Avoir sans facture d''origine refusé', $$
  INSERT INTO invoices (number, type, reservation_id, bill_to_name, bill_to_address,
                        total_excl_tax_cents, total_vat_cents, total_incl_tax_cents)
  VALUES ('AV-2027-000099', 'credit_note', '00000000-0000-0000-0000-0000000000a2', 'X', '{}', 0, 0, 0)
$$, '23514');
SELECT pg_temp.expect_error('Facture numérotée dans la série des avoirs refusée', $$
  INSERT INTO invoices (number, type, reservation_id, bill_to_name, bill_to_address,
                        total_excl_tax_cents, total_vat_cents, total_incl_tax_cents)
  VALUES ('AV-2027-000098', 'invoice', '00000000-0000-0000-0000-0000000000a2', 'X', '{}', 0, 0, 0)
$$, '23514');
SELECT pg_temp.expect_ok('Avoir rattaché à la facture d''origine accepté', $$
  INSERT INTO invoices (number, type, reservation_id, credited_invoice_id, bill_to_name,
                        bill_to_address, total_excl_tax_cents, total_vat_cents, total_incl_tax_cents)
  VALUES ('AV-2027-000001', 'credit_note', '00000000-0000-0000-0000-0000000000a2',
          '00000000-0000-0000-0000-0000000000f1', 'Test Facture', '{}', 17273, 1727, 19000)
$$);
SELECT pg_temp.expect_error('Numéro de facture en double refusé', $$
  INSERT INTO invoices (number, type, reservation_id, bill_to_name, bill_to_address,
                        total_excl_tax_cents, total_vat_cents, total_incl_tax_cents)
  VALUES ('FA-2027-000003', 'invoice', '00000000-0000-0000-0000-0000000000a2', 'X', '{}', 0, 0, 0)
$$, '23505');

-- Payments.
INSERT INTO payments (id, reservation_id, kind, method, amount_cents, status)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2',
        'payment', 'card_terminal', 19000, 'pending');
SELECT pg_temp.expect_ok('Un paiement en attente peut passer à « réussi »',
  $$UPDATE payments SET status = 'succeeded', received_at = now()
    WHERE id = '00000000-0000-0000-0000-0000000000b1'$$);
SELECT pg_temp.expect_error('Modifier un paiement réussi est refusé',
  $$UPDATE payments SET amount_cents = 1 WHERE id = '00000000-0000-0000-0000-0000000000b1'$$, '23000');
SELECT pg_temp.expect_error('Supprimer un paiement est refusé',
  $$DELETE FROM payments WHERE id = '00000000-0000-0000-0000-0000000000b1'$$, '23000');
SELECT pg_temp.expect_error('Montant de paiement nul refusé', $$
  INSERT INTO payments (reservation_id, kind, method, amount_cents, status)
  VALUES ('00000000-0000-0000-0000-0000000000a2', 'payment', 'cash', 0, 'succeeded')
$$, '23514');
SELECT pg_temp.expect_error('Remboursement sans paiement d''origine refusé', $$
  INSERT INTO payments (reservation_id, kind, method, amount_cents, status)
  VALUES ('00000000-0000-0000-0000-0000000000a2', 'refund', 'card_terminal', 500, 'succeeded')
$$, '23514');
SELECT pg_temp.expect_ok('Remboursement rattaché au paiement d''origine accepté', $$
  INSERT INTO payments (reservation_id, kind, method, amount_cents, status, refunded_payment_id)
  VALUES ('00000000-0000-0000-0000-0000000000a2', 'refund', 'card_terminal', 500, 'succeeded',
          '00000000-0000-0000-0000-0000000000b1')
$$);
SELECT pg_temp.expect_error('Moyen de paiement inconnu refusé', $$
  INSERT INTO payments (reservation_id, kind, method, amount_cents, status)
  VALUES ('00000000-0000-0000-0000-0000000000a2', 'payment', 'bitcoin', 100, 'pending')
$$, '23514');

-- Charges: free to change until invoiced, frozen afterwards.
INSERT INTO reservation_charges (id, reservation_id, kind, label, quantity, unit_price_cents,
                                 vat_rate, total_cents)
VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a2',
        'other', 'Bar', 1, 800, 20, 800);
SELECT pg_temp.expect_ok('Prestation non facturée modifiable',
  $$UPDATE reservation_charges SET label = 'Bar (2 cafés)'
    WHERE id = '00000000-0000-0000-0000-0000000000d1'$$);
UPDATE reservation_charges SET invoice_id = '00000000-0000-0000-0000-0000000000f1'
WHERE id = '00000000-0000-0000-0000-0000000000d1';
SELECT pg_temp.expect_error('Prestation facturée non modifiable',
  $$UPDATE reservation_charges SET total_cents = 1
    WHERE id = '00000000-0000-0000-0000-0000000000d1'$$, '23000');
SELECT pg_temp.expect_error('Prestation facturée non supprimable',
  $$DELETE FROM reservation_charges WHERE id = '00000000-0000-0000-0000-0000000000d1'$$, '23000');

ROLLBACK;
