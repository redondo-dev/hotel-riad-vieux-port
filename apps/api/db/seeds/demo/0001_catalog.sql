-- DEMO DATA — fictional Hôtel Riad Vieux-Port (portfolio).
-- Loaded only when DEMO_MODE=true, never for a real hotel. Separate from the migrations.
-- Idempotent: running it twice changes nothing. Values validated during the analysis phase;
-- the public site displays them through the API (GET /api/v1/public/…).

INSERT INTO hotel_settings (id, name, address, phone, email, legal_identifiers)
VALUES (
  1,
  'Hôtel Riad Vieux-Port',
  'Quai du Vieux-Port, 13002 Marseille (adresse fictive)',
  '+33465710000',
  'contact@riad-vieux-port.example',
  '{"note": "Hôtel fictif : aucun identifiant légal réel"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO room_categories (
  code, name_fr, name_en, description_fr, description_en, beds_fr, beds_en,
  area_sqm, max_occupancy, base_occupancy, base_price_cents, amenities, sort_order
) VALUES
  ('single', 'Chambre individuelle', 'Single room',
   'Une chambre calme et fonctionnelle, pensée pour les voyageurs seuls et les séjours professionnels.',
   'A quiet, practical room designed for solo travellers and business stays.',
   '1 lit simple', '1 single bed',
   14, 1, 1, 7500, '{wifi,air-conditioning,tv,safe,hair-dryer,shower}', 1),
  ('double-standard', 'Double standard', 'Standard double',
   'Lumineuse et confortable, idéale pour un séjour à deux au cœur de Marseille.',
   'Bright and comfortable, ideal for two in the heart of Marseille.',
   '1 lit double', '1 double bed',
   18, 2, 2, 9500, '{wifi,air-conditioning,tv,safe,hair-dryer,shower}', 2),
  ('double-superior', 'Double supérieure', 'Superior double',
   'Plus d''espace, une baignoire et le choix entre un grand lit ou deux lits séparés.',
   'More space, a bathtub and a choice of one large bed or two twin beds.',
   '1 grand lit ou 2 lits simples', '1 king bed or 2 twin beds',
   24, 2, 2, 12500, '{wifi,air-conditioning,tv,safe,hair-dryer,bathtub}', 3),
  ('family', 'Chambre familiale', 'Family room',
   'Un lit double et deux lits simples pour voyager en famille sans se serrer.',
   'A double bed and two single beds so the whole family travels in comfort.',
   '1 lit double et 2 lits simples', '1 double bed and 2 single beds',
   30, 4, 2, 16500, '{wifi,air-conditioning,tv,safe,hair-dryer,shower}', 4),
  ('suite', 'Suite Vieux-Port', 'Vieux-Port suite',
   'Notre plus belle chambre : un coin salon, une baignoire et la vue sur le port.',
   'Our finest room: a sitting area, a bathtub and a view over the harbour.',
   '1 grand lit et 1 canapé-lit', '1 king bed and 1 sofa bed',
   40, 3, 2, 22000, '{wifi,air-conditioning,tv,safe,hair-dryer,bathtub,sitting-area,port-view}', 5)
ON CONFLICT (code) DO NOTHING;

-- 85 rooms over 5 floors of 17 rooms (101-117 … 501-517):
--   single 101-110 (10) · standard double 111-117, 201-217, 301-316 (40)
--   superior double 317, 401-417, 501-507 (25) · family 508-512 (5) · suite 513-517 (5)
WITH layout (code, first_room, last_room) AS (
  VALUES
    ('single', 101, 110),
    ('double-standard', 111, 117),
    ('double-standard', 201, 217),
    ('double-standard', 301, 316),
    ('double-superior', 317, 317),
    ('double-superior', 401, 417),
    ('double-superior', 501, 507),
    ('family', 508, 512),
    ('suite', 513, 517)
)
INSERT INTO rooms (number, floor, category_id)
SELECT n::text, n / 100, c.id
FROM layout l
JOIN room_categories c ON c.code = l.code
CROSS JOIN LATERAL generate_series(l.first_room, l.last_room) AS n
ON CONFLICT (number) DO NOTHING;

-- High season April–September: +20 % on every category (RM-08).
INSERT INTO rate_periods (name, kind, period, adjustment_pct)
SELECT 'Haute saison ' || y, 'season', daterange(make_date(y, 4, 1), make_date(y, 10, 1), '[)'), 20
FROM generate_series(2026, 2028) AS y
WHERE NOT EXISTS (
  SELECT 1 FROM rate_periods p
  WHERE p.kind = 'season' AND p.category_id IS NULL
    AND p.period && daterange(make_date(y, 4, 1), make_date(y, 10, 1), '[)')
);

-- VAT rates to be confirmed by the hotel's accountant before any real use.
INSERT INTO services (code, name_fr, name_en, unit_price_cents, pricing_unit, vat_rate, bookable_online)
VALUES
  ('breakfast', 'Petit-déjeuner', 'Breakfast', 1400, 'per_person_night', 10, true),
  ('baby-cot', 'Lit bébé', 'Baby cot', 0, 'per_stay', 0, true)
ON CONFLICT (code) DO NOTHING;
