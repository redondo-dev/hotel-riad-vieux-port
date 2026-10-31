-- Test helpers, created in pg_temp: they vanish with the session and never touch the schema.

-- Runs a statement and checks that it fails with the expected SQLSTATE.
CREATE FUNCTION pg_temp.expect_error(label text, statement text, expected_state text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = expected_state THEN
      RAISE NOTICE 'OK    %', label;
      RETURN;
    END IF;
    RAISE EXCEPTION 'FAIL  % — expected SQLSTATE %, got % (%)', label, expected_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL  % — the statement was accepted but should have been refused', label;
END;
$$;

-- Runs a statement and checks that it succeeds.
CREATE FUNCTION pg_temp.expect_ok(label text, statement text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE NOTICE 'OK    %', label;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FAIL  % — unexpected error % (%)', label, SQLSTATE, SQLERRM;
END;
$$;

CREATE FUNCTION pg_temp.expect_equal(label text, actual anyelement, expected anyelement)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL  % — expected %, got %', label, expected, actual;
  END IF;
  RAISE NOTICE 'OK    %', label;
END;
$$;
