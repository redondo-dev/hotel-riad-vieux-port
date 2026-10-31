-- 0006 — Incidents and out-of-service periods (architecture §4 "Pannes et indisponibilités").

CREATE SEQUENCE incident_number_seq;

CREATE TABLE incidents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference            text NOT NULL UNIQUE
                         DEFAULT 'INC-' || lpad(nextval('incident_number_seq')::text, 6, '0'),
  room_id              uuid REFERENCES rooms (id) ON DELETE RESTRICT,
  location             text CHECK (length(location) <= 120),
  title                text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description          text NOT NULL CHECK (length(description) BETWEEN 1 AND 4000),
  priority             text NOT NULL CHECK (priority IN ('urgent', 'normal', 'low')),
  -- RM-23: ticked by the reporter ("room unusable"); takes the room out of sale.
  blocks_room          boolean NOT NULL DEFAULT false,
  status               text NOT NULL DEFAULT 'reported'
                         CHECK (status IN ('reported', 'in_progress', 'resolved', 'closed')),
  reported_by          uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  assigned_to          uuid REFERENCES users (id) ON DELETE RESTRICT,
  -- External contractor, named in plain text: contractors have no account (EF-46).
  external_contractor  text CHECK (length(external_contractor) <= 120),
  reported_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at          timestamptz,
  closed_at            timestamptz,
  closed_by            uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incidents_room_or_location_check CHECK (room_id IS NOT NULL OR location IS NOT NULL),
  CONSTRAINT incidents_blocks_room_check CHECK (NOT blocks_room OR room_id IS NOT NULL),
  CONSTRAINT incidents_closed_check CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
ALTER SEQUENCE incident_number_seq OWNED BY incidents.reference;
CREATE INDEX incidents_status_priority_idx ON incidents (status, priority);
CREATE INDEX incidents_room_history_idx ON incidents (room_id, reported_at DESC);
CREATE TRIGGER incidents_set_updated_at BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Out-of-service periods. The end stays open ([start, ∞)) until the room is released.
-- No exclusion constraint here: a real breakdown must always be recordable, even on a room
-- that is already booked; the API then alerts the reception (use case CU5).
CREATE TABLE room_blocks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      uuid NOT NULL REFERENCES rooms (id) ON DELETE RESTRICT,
  period       daterange NOT NULL CHECK (
                 NOT isempty(period) AND NOT lower_inf(period)
                 AND lower_inc(period) AND NOT upper_inc(period)),
  reason       text NOT NULL CHECK (reason IN ('incident', 'maintenance', 'other')),
  incident_id  uuid REFERENCES incidents (id) ON DELETE RESTRICT,
  note         text,
  created_by   uuid REFERENCES users (id) ON DELETE RESTRICT,
  released_at  timestamptz,
  released_by  uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_blocks_incident_link_check
    CHECK ((reason = 'incident') = (incident_id IS NOT NULL))
);
CREATE INDEX room_blocks_room_period_idx ON room_blocks USING gist (room_id, period);

CREATE TABLE incident_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id   uuid NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  storage_key   text NOT NULL,
  content_type  text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes    integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  uploaded_by   uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incident_photos_incident_id_idx ON incident_photos (incident_id);

-- Dated history of an incident (EF-47).
CREATE TABLE incident_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id  uuid NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  event_type   text NOT NULL CHECK (event_type IN ('status_change', 'assignment', 'comment')),
  from_status  text CHECK (from_status IN ('reported', 'in_progress', 'resolved', 'closed')),
  to_status    text CHECK (to_status IN ('reported', 'in_progress', 'resolved', 'closed')),
  comment      text CHECK (length(comment) <= 4000),
  actor_id     uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incident_events_status_change_check
    CHECK (event_type <> 'status_change' OR to_status IS NOT NULL)
);
CREATE INDEX incident_events_incident_id_idx ON incident_events (incident_id, created_at);
