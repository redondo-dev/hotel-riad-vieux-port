-- Demo data: the figures must match the validated values (85 rooms, 5 categories…).
BEGIN;
\ir _helpers.sql

SELECT pg_temp.expect_equal('85 chambres au total', (SELECT count(*)::int FROM rooms), 85);
SELECT pg_temp.expect_equal('Répartition par catégorie',
  (SELECT string_agg(c.code || '=' || n, ' ' ORDER BY c.sort_order)
     FROM (SELECT category_id, count(*) AS n FROM rooms GROUP BY category_id) r
     JOIN room_categories c ON c.id = r.category_id),
  'single=10 double-standard=40 double-superior=25 family=5 suite=5');
SELECT pg_temp.expect_equal('17 chambres par étage sur 5 étages',
  (SELECT string_agg(floor || ':' || n, ' ' ORDER BY floor)
     FROM (SELECT floor, count(*) AS n FROM rooms GROUP BY floor) f),
  '1:17 2:17 3:17 4:17 5:17');
SELECT pg_temp.expect_equal('Prix de base validés (en centimes)',
  (SELECT string_agg(base_price_cents::text, ',' ORDER BY sort_order) FROM room_categories),
  '7500,9500,12500,16500,22000');
SELECT pg_temp.expect_equal('Haute saison à +20 % de 2026 à 2028',
  (SELECT count(*)::int FROM rate_periods WHERE kind = 'season' AND adjustment_pct = 20), 3);
SELECT pg_temp.expect_equal('Petit-déjeuner à 14 € par personne et par nuit',
  (SELECT unit_price_cents || ' ' || pricing_unit FROM services WHERE code = 'breakfast'),
  '1400 per_person_night');
SELECT pg_temp.expect_equal('Une seule ligne de paramètres',
  (SELECT count(*)::int FROM hotel_settings), 1);
SELECT pg_temp.expect_equal('Aucun compte du personnel créé par les données SQL',
  (SELECT count(*)::int FROM users), 0);

ROLLBACK;
