DROP TABLE IF EXISTS reservation_charges;
DROP TABLE IF EXISTS reservation_nights;
DROP TRIGGER IF EXISTS reservations_propagate ON reservations;
DROP FUNCTION IF EXISTS reservations_propagate_to_rooms();
DROP TABLE IF EXISTS reservation_rooms;
DROP FUNCTION IF EXISTS reservation_rooms_sync_from_reservation();
DROP FUNCTION IF EXISTS reservation_holds_rooms(text);
DROP TABLE IF EXISTS reservations;
DROP TABLE IF EXISTS customers;
