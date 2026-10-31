-- Incidents, out-of-service periods and the append-only audit trail (P4).
BEGIN;
\ir _helpers.sql

INSERT INTO users (id, email, password_hash, first_name, last_name, role)
VALUES ('00000000-0000-0000-0000-0000000000e1', 'reception@example.org', 'not-a-real-hash',
        'Test', 'Réception', 'reception');

SELECT pg_temp.expect_ok('Signalement d''une panne qui bloque la chambre 205', $$
  INSERT INTO incidents (room_id, title, description, priority, blocks_room, reported_by)
  SELECT id, 'Fuite', 'Fuite sous le lavabo', 'urgent', true, '00000000-0000-0000-0000-0000000000e1'
  FROM rooms WHERE number = '205'
$$);

SELECT pg_temp.expect_equal('Référence de panne au format INC-000000',
  (SELECT reference ~ '^INC-[0-9]{6}$' FROM incidents WHERE title = 'Fuite'), true);

SELECT pg_temp.expect_ok('Mise hors service ouverte (sans date de fin) liée à la panne', $$
  INSERT INTO room_blocks (room_id, period, reason, incident_id)
  SELECT i.room_id, daterange('2027-05-01', NULL, '[)'), 'incident', i.id
  FROM incidents i WHERE i.title = 'Fuite'
$$);

SELECT pg_temp.expect_error('Panne sans chambre ni lieu refusée', $$
  INSERT INTO incidents (title, description, priority, reported_by)
  VALUES ('?', '?', 'low', '00000000-0000-0000-0000-0000000000e1')
$$, '23514');

SELECT pg_temp.expect_error('Panne « chambre inutilisable » sans chambre refusée', $$
  INSERT INTO incidents (location, title, description, priority, blocks_room, reported_by)
  VALUES ('Ascenseur', 'Bloqué', 'Bloqué au 3e', 'urgent', true, '00000000-0000-0000-0000-0000000000e1')
$$, '23514');

SELECT pg_temp.expect_error('Panne clôturée sans date de clôture refusée',
  $$UPDATE incidents SET status = 'closed' WHERE title = 'Fuite'$$, '23514');

SELECT pg_temp.expect_error('Mise hors service « panne » sans panne liée refusée', $$
  INSERT INTO room_blocks (room_id, period, reason)
  SELECT id, daterange('2027-06-01', '2027-06-02', '[)'), 'incident' FROM rooms WHERE number = '206'
$$, '23514');

SELECT pg_temp.expect_error('Photo de plus de 10 Mo refusée', $$
  INSERT INTO incident_photos (incident_id, storage_key, content_type, size_bytes)
  SELECT id, 'x.jpg', 'image/jpeg', 10485761 FROM incidents WHERE title = 'Fuite'
$$, '23514');

SELECT pg_temp.expect_error('Photo dans un format non autorisé refusée', $$
  INSERT INTO incident_photos (incident_id, storage_key, content_type, size_bytes)
  SELECT id, 'x.gif', 'image/gif', 1000 FROM incidents WHERE title = 'Fuite'
$$, '23514');

-- Audit trail.
INSERT INTO audit_logs (actor_type, actor_user_id, action, entity_type, entity_id, changes)
VALUES ('staff', '00000000-0000-0000-0000-0000000000e1', 'reservation.cancelled', 'reservation',
        gen_random_uuid(), '{"status": ["confirmed", "cancelled"]}');

SELECT pg_temp.expect_error('Modifier une entrée du journal est refusé',
  $$UPDATE audit_logs SET action = 'reservation.created'$$, '23000');
SELECT pg_temp.expect_error('Supprimer une entrée récente du journal est refusé',
  $$DELETE FROM audit_logs$$, '23000');
SELECT pg_temp.expect_error('Vider le journal (TRUNCATE) est refusé', $$TRUNCATE audit_logs$$, '23000');

INSERT INTO audit_logs (occurred_at, actor_type, action, entity_type, entity_id)
VALUES (now() - interval '2 years', 'system', 'customer.anonymized', 'customer', gen_random_uuid());
SELECT pg_temp.expect_ok('La purge d''une entrée de plus d''un an est autorisée',
  $$DELETE FROM audit_logs WHERE occurred_at < now() - interval '1 year'$$);

SELECT pg_temp.expect_error('Action du personnel sans auteur refusée', $$
  INSERT INTO audit_logs (actor_type, action, entity_type, entity_id)
  VALUES ('staff', 'rate_period.updated', 'rate_period', gen_random_uuid())
$$, '23514');

SELECT pg_temp.expect_error('Rôle inconnu refusé', $$
  INSERT INTO users (email, password_hash, first_name, last_name, role)
  VALUES ('x@example.org', 'h', 'X', 'Y', 'admin')
$$, '23514');

SELECT pg_temp.expect_error('E-mail en double (casse différente) refusé', $$
  INSERT INTO users (email, password_hash, first_name, last_name, role)
  VALUES ('RECEPTION@example.org', 'h', 'X', 'Y', 'reception')
$$, '23505');

SELECT pg_temp.expect_error('Deuxième ligne de paramètres de l''hôtel refusée', $$
  INSERT INTO hotel_settings (id, name, address, phone, email) VALUES (2, 'X', 'X', 'X', 'x@x.fr')
$$, '23514');

ROLLBACK;
