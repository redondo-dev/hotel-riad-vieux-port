-- Reservations: no double booking (RM-03), same-day turnover (RM-01), integrity checks.
-- Runs inside a transaction that is rolled back: nothing is kept.
BEGIN;
\ir _helpers.sql

INSERT INTO customers (id, first_name, last_name, email)
VALUES ('00000000-0000-0000-0000-0000000000c1', 'Test', 'Client', 'client@example.org');

-- Books one room (by number) for a stay; returns the reservation id.
CREATE FUNCTION pg_temp.book(ref text, arrival date, departure date, room_number text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  reservation uuid;
BEGIN
  INSERT INTO reservations (reference, customer_id, source, check_in, check_out, status,
                            rate_plan, total_amount_cents, free_cancellation_until)
  VALUES (ref, '00000000-0000-0000-0000-0000000000c1', 'website', arrival, departure,
          'confirmed', 'flexible', 30000, arrival::timestamptz - interval '48 hours')
  RETURNING id INTO reservation;
  INSERT INTO reservation_rooms (reservation_id, category_id, room_id, adults, subtotal_cents)
  SELECT reservation, category_id, id, 2, 30000 FROM rooms WHERE number = room_number;
  RETURN reservation;
END;
$$;

SELECT pg_temp.expect_ok('Réservation de la chambre 111 du 12 au 15 mai',
  $$SELECT pg_temp.book('TESTRES1', '2027-05-12', '2027-05-15', '111')$$);

SELECT pg_temp.expect_error('Double attribution de la chambre 111 (nuits du 14 au 16 mai) refusée',
  $$SELECT pg_temp.book('TESTRES2', '2027-05-14', '2027-05-16', '111')$$, '23P01');

SELECT pg_temp.expect_error('Séjour englobant (10 au 20 mai) sur la chambre 111 refusé',
  $$SELECT pg_temp.book('TESTRES3', '2027-05-10', '2027-05-20', '111')$$, '23P01');

SELECT pg_temp.expect_ok('Départ et arrivée le même jour (15 mai) acceptés',
  $$SELECT pg_temp.book('TESTRES4', '2027-05-15', '2027-05-18', '111')$$);

SELECT pg_temp.expect_ok('Même dates dans une autre chambre (112) acceptées',
  $$SELECT pg_temp.book('TESTRES5', '2027-05-12', '2027-05-15', '112')$$);

SELECT pg_temp.expect_equal('Le séjour de la ligne est recopié de la réservation',
  (SELECT rr.stay FROM reservation_rooms rr JOIN reservations r ON r.id = rr.reservation_id
    WHERE r.reference = 'TESTRES1'),
  daterange('2027-05-12', '2027-05-15', '[)'));

-- Cancelling releases the room.
UPDATE reservations SET status = 'cancelled', cancelled_at = now() WHERE reference = 'TESTRES1';
SELECT pg_temp.expect_equal('Une réservation annulée ne retient plus la chambre',
  (SELECT rr.is_active FROM reservation_rooms rr JOIN reservations r ON r.id = rr.reservation_id
    WHERE r.reference = 'TESTRES1'),
  false);
SELECT pg_temp.expect_ok('La chambre 111 libérée peut être revendue du 12 au 15 mai',
  $$SELECT pg_temp.book('TESTRES6', '2027-05-12', '2027-05-15', '111')$$);

-- Moving the dates of an existing reservation onto taken nights fails.
SELECT pg_temp.book('TESTRES7', '2027-05-18', '2027-05-20', '111');
SELECT pg_temp.expect_error('Déplacer un séjour sur des nuits déjà prises est refusé',
  $$UPDATE reservations SET check_in = '2027-05-17' WHERE reference = 'TESTRES7'$$, '23P01');

-- Unassigned lines (room chosen later by the reception) never conflict with each other.
SELECT pg_temp.expect_ok('Deux lignes sans chambre attribuée ne se gênent pas', $$
  INSERT INTO reservation_rooms (reservation_id, category_id, adults, subtotal_cents)
  SELECT r.id, c.id, 2, 1 FROM reservations r, room_categories c
  WHERE r.reference IN ('TESTRES4', 'TESTRES5') AND c.code = 'double-standard'
$$);

-- Integrity checks.
SELECT pg_temp.expect_error('Départ avant l''arrivée refusé', $$
  INSERT INTO reservations (reference, customer_id, source, check_in, check_out, status,
                            rate_plan, total_amount_cents)
  VALUES ('TESTBAD1', '00000000-0000-0000-0000-0000000000c1', 'website', '2027-05-15',
          '2027-05-12', 'confirmed', 'non_refundable', 100)
$$, '23514');

SELECT pg_temp.expect_error('Tarif non remboursable avec date d''annulation gratuite refusé', $$
  INSERT INTO reservations (reference, customer_id, source, check_in, check_out, status,
                            rate_plan, total_amount_cents, free_cancellation_until)
  VALUES ('TESTBAD2', '00000000-0000-0000-0000-0000000000c1', 'website', '2027-06-01',
          '2027-06-03', 'confirmed', 'non_refundable', 100, now())
$$, '23514');

SELECT pg_temp.expect_error('Réservation en attente de paiement sans échéance refusée', $$
  INSERT INTO reservations (reference, customer_id, source, check_in, check_out, status,
                            rate_plan, total_amount_cents)
  VALUES ('TESTBAD3', '00000000-0000-0000-0000-0000000000c1', 'website', '2027-06-01',
          '2027-06-03', 'pending_payment', 'non_refundable', 100)
$$, '23514');

SELECT pg_temp.expect_error('Référence de réservation mal formée refusée', $$
  INSERT INTO reservations (reference, customer_id, source, check_in, check_out, status,
                            rate_plan, total_amount_cents)
  VALUES ('abc', '00000000-0000-0000-0000-0000000000c1', 'website', '2027-06-01',
          '2027-06-03', 'confirmed', 'non_refundable', 100)
$$, '23514');

SELECT pg_temp.expect_error('Enfant de 18 ans refusé', $$
  INSERT INTO reservation_rooms (reservation_id, category_id, adults, children_ages, subtotal_cents)
  SELECT r.id, c.id, 2, '{18}', 1 FROM reservations r, room_categories c
  WHERE r.reference = 'TESTRES4' AND c.code = 'family'
$$, '23514');

SELECT pg_temp.expect_error('Plus de 3 enfants par chambre refusé', $$
  INSERT INTO reservation_rooms (reservation_id, category_id, adults, children_ages, subtotal_cents)
  SELECT r.id, c.id, 1, '{2,4,6,8}', 1 FROM reservations r, room_categories c
  WHERE r.reference = 'TESTRES4' AND c.code = 'family'
$$, '23514');

SELECT pg_temp.expect_error('Montant négatif refusé', $$
  UPDATE reservations SET total_amount_cents = -1 WHERE reference = 'TESTRES4'
$$, '23514');

SELECT pg_temp.expect_error('Prix d''une même nuit enregistré deux fois refusé', $$
  INSERT INTO reservation_nights (reservation_room_id, night, price_cents)
  SELECT rr.id, n.night, 9500
  FROM reservation_rooms rr JOIN reservations r ON r.id = rr.reservation_id,
       (VALUES ('2027-05-15'::date), ('2027-05-15'::date)) AS n (night)
  WHERE r.reference = 'TESTRES4' AND rr.room_id IS NOT NULL
$$, '23505');

ROLLBACK;
