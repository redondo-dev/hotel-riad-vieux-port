-- 0007 — Audit trail and technical tables (architecture §4 "Traçabilité et tables techniques").

-- Journal of sensitive actions. Append-only (decision P4): rows can never be modified, and can
-- only be deleted once older than one year (validated retention period).
CREATE TABLE audit_logs (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  actor_type     text NOT NULL CHECK (actor_type IN ('staff', 'customer', 'system')),
  actor_user_id  uuid REFERENCES users (id) ON DELETE RESTRICT,
  action         text NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type    text NOT NULL,
  entity_id      uuid NOT NULL,
  changes        jsonb,
  ip_address     inet,
  CONSTRAINT audit_logs_staff_actor_check
    CHECK ((actor_type = 'staff') = (actor_user_id IS NOT NULL))
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_occurred_at_idx ON audit_logs (occurred_at);

CREATE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit log entries cannot be modified'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.occurred_at > now() - interval '1 year' THEN
    RAISE EXCEPTION 'audit log entries can only be purged after one year'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();

-- Messages of the public contact form (EF-03), purged after one year.
CREATE TABLE contact_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  email       citext NOT NULL,
  subject     text NOT NULL CHECK (subject IN ('existing_booking', 'group_request', 'other')),
  message     text NOT NULL CHECK (length(message) BETWEEN 1 AND 4000),
  language    char(2) NOT NULL DEFAULT 'fr' CHECK (language IN ('fr', 'en')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_messages_created_at_idx ON contact_messages (created_at);

-- A request repeated with the same key (double click, unstable network) gets the stored
-- response instead of creating a second reservation or payment. Purged after 24 hours.
CREATE TABLE idempotency_keys (
  key              text PRIMARY KEY CHECK (length(key) BETWEEN 16 AND 128),
  scope            text NOT NULL,
  request_hash     text NOT NULL,
  response_status  smallint,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idempotency_keys_created_at_idx ON idempotency_keys (created_at);

-- Stripe may send the same event twice: it is processed only once.
CREATE TABLE webhook_events (
  provider      text NOT NULL CHECK (provider IN ('stripe')),
  event_id      text NOT NULL,
  type          text NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  PRIMARY KEY (provider, event_id)
);
