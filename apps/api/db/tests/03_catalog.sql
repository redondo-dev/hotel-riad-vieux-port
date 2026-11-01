-- Catalogue: unambiguous rate periods (RM-08, RM-09), category consistency.
BEGIN;
\ir _helpers.sql

SELECT pg_temp.expect_error('Deuxième saison générale chevauchant la haute saison 2027 refusée', $$
  INSERT INTO rate_periods (name, kind, period, adjustment_pct)
  VALUES ('Doublon', 'season', daterange('2027-09-15', '2027-10-15', '[)'), 5)
$$, '23P01');

SELECT pg_temp.expect_ok('Événement pendant la haute saison accepté (l''événement l''emporte)', $$
  INSERT INTO rate_periods (name, kind, period, adjustment_pct)
  VALUES ('Grand concert', 'event', daterange('2027-07-10', '2027-07-12', '[)'), 30)
$$);

SELECT pg_temp.expect_error('Deux événements généraux sur la même nuit refusés', $$
  INSERT INTO rate_periods (name, kind, period, adjustment_pct)
  VALUES ('Salon', 'event', daterange('2027-07-11', '2027-07-13', '[)'), 30)
$$, '23P01');

SELECT pg_temp.expect_ok('Saison propre aux suites pendant la saison générale acceptée', $$
  INSERT INTO rate_periods (name, kind, period, adjustment_pct, category_id)
  SELECT 'Suites été', 'season', daterange('2027-06-01', '2027-09-01', '[)'), 35, id
  FROM room_categories WHERE code = 'suite'
$$);

SELECT pg_temp.expect_error('Deux saisons propres aux suites qui se chevauchent refusées', $$
  INSERT INTO rate_periods (name, kind, period, adjustment_pct, category_id)
  SELECT 'Suites août', 'season', daterange('2027-08-01', '2027-08-15', '[)'), 40, id
  FROM room_categories WHERE code = 'suite'
$$, '23P01');

SELECT pg_temp.expect_error('Période vide refusée', $$
  INSERT INTO rate_periods (name, kind, period, adjustment_pct)
  VALUES ('Vide', 'event', daterange('2027-01-05', '2027-01-05', '[)'), 10)
$$, '23514');

SELECT pg_temp.expect_error('Période sans fin refusée pour un tarif', $$
  INSERT INTO rate_periods (name, kind, period, adjustment_pct)
  VALUES ('Sans fin', 'event', daterange('2030-01-05', NULL, '[)'), 10)
$$, '23514');

SELECT pg_temp.expect_error('Baisse de plus de 100 % refusée', $$
  INSERT INTO rate_periods (name, kind, period, adjustment_pct)
  VALUES ('Absurde', 'event', daterange('2031-01-05', '2031-01-06', '[)'), -150)
$$, '23514');

SELECT pg_temp.expect_error('Personnes incluses supérieures à la capacité refusées',
  $$UPDATE room_categories SET base_occupancy = 3 WHERE code = 'double-standard'$$, '23514');

SELECT pg_temp.expect_error('Code de catégorie mal formé refusé',
  $$UPDATE room_categories SET code = 'Double Standard' WHERE code = 'double-standard'$$, '23514');

SELECT pg_temp.expect_error('Numéro de chambre en double refusé', $$
  INSERT INTO rooms (number, floor, category_id)
  SELECT '111', 1, id FROM room_categories WHERE code = 'single'
$$, '23505');

SELECT pg_temp.expect_error('Supprimer une catégorie qui a des chambres est refusé',
  $$DELETE FROM room_categories WHERE code = 'single'$$, '23503');

SELECT pg_temp.expect_error('Statut de propreté inconnu refusé',
  $$UPDATE rooms SET housekeeping_status = 'sale' WHERE number = '111'$$, '23514');

ROLLBACK;
