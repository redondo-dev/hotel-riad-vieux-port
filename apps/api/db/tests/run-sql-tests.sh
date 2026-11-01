#!/usr/bin/env bash
# Database verification, run directly against PostgreSQL with psql.
#
# Creates a THROWAWAY database (riad_sqltest_<pid>), then:
#   1. applies every migration;  2. loads the demo data twice (idempotence);
#   3. runs the SQL tests;       4. runs a real two-session concurrency test;
#   5. reverts every migration;  6. applies them again (reversibility).
# The throwaway database is always dropped at the end. No other database is touched.
#
# Connection: standard libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD).
# The user must be allowed to create databases. Usage: npm run db:test:sql
set -euo pipefail
export LC_COLLATE=C  # glob order = byte order, the same on every machine

here="$(cd "$(dirname "$0")" && pwd)"
db_dir="$(dirname "$here")"
test_db="riad_sqltest_$$"
admin_db="${PGADMIN_DATABASE:-postgres}"

psql_admin() { psql -X -q -v ON_ERROR_STOP=1 -d "$admin_db" "$@"; }
psql_test() { psql -X -q -v ON_ERROR_STOP=1 -d "$test_db" "$@"; }
# Migrations and seeds run without informational notices ("already exists, skipping"…).
psql_quiet() { PGOPTIONS='-c client_min_messages=warning' psql_test "$@"; }
step() { printf '\n== %s\n' "$1"; }

cleanup() { psql_admin -c "DROP DATABASE IF EXISTS $test_db WITH (FORCE)" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Files are listed with globs, which Bash expands in alphabetical order and which stay intact when
# the project path contains spaces (audit QA-02).
apply_up() {
  for file in "$db_dir"/migrations/*.up.sql; do
    psql_quiet --single-transaction -f "$file"
    echo "   appliquée : $(basename "$file")"
  done
}
apply_down() {
  local files=("$db_dir"/migrations/*.down.sql)
  local i
  for ((i = ${#files[@]} - 1; i >= 0; i--)); do
    file="${files[i]}"
    psql_quiet --single-transaction -f "$file"
    echo "   annulée   : $(basename "$file")"
  done
}
count_tables() {
  psql_test -tAc "SELECT count(*) FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
}

echo "Base de test jetable : $test_db (serveur ${PGHOST:-local}:${PGPORT:-5432})"
psql_admin -c "CREATE DATABASE $test_db"

step "1. Application des migrations"
apply_up
echo "   tables créées : $(count_tables)"

step "2. Données de démonstration, chargées deux fois (idempotence)"
for run in 1 2; do
  for file in "$db_dir"/seeds/demo/*.sql; do
    psql_quiet --single-transaction -f "$file"
  done
  echo "   passage $run : $(psql_test -tAc 'SELECT count(*) FROM rooms') chambres"
done

step "3. Tests des contraintes"
passed=0
for file in "$here"/[0-9]*.sql; do
  echo "-- $(basename "$file")"
  output="$(cd "$here" && psql_test -f "$file" 2>&1)" || { echo "$output"; exit 1; }
  echo "$output" | sed -n 's/.*NOTICE:  \(OK .*\)/   \1/p'
  passed=$((passed + $(echo "$output" | grep -c 'NOTICE:  OK' || true)))
done
echo "   => $passed vérifications réussies"

step "4. Concurrence : deux sessions réservent la même chambre au même moment"
psql_test -c "
  INSERT INTO customers (id, first_name, last_name, email)
  VALUES ('00000000-0000-0000-0000-00000000cc01', 'Session', 'Concurrente', 'c@example.org');
  INSERT INTO reservations (id, reference, customer_id, source, check_in, check_out, status,
                            rate_plan, total_amount_cents, free_cancellation_until)
  VALUES
    ('00000000-0000-0000-0000-00000000aa01', 'CONCUR01', '00000000-0000-0000-0000-00000000cc01',
     'website', '2027-08-10', '2027-08-13', 'confirmed', 'flexible', 1, '2027-08-08'),
    ('00000000-0000-0000-0000-00000000aa02', 'CONCUR02', '00000000-0000-0000-0000-00000000cc01',
     'website', '2027-08-11', '2027-08-14', 'confirmed', 'flexible', 1, '2027-08-09');"
book_room_sql="INSERT INTO reservation_rooms (reservation_id, category_id, room_id, adults, subtotal_cents)
               SELECT '%s', category_id, id, 2, 1 FROM rooms WHERE number = '112';"
# Session A takes room 112 and keeps its transaction open for 2 seconds.
psql_test -c "BEGIN; $(printf "$book_room_sql" '00000000-0000-0000-0000-00000000aa01') SELECT pg_sleep(2); COMMIT;" >/dev/null &
session_a=$!
sleep 0.5
# Session B tries the same room on overlapping nights while A is still open.
if session_b="$(psql_test -c "$(printf "$book_room_sql" '00000000-0000-0000-0000-00000000aa02')" 2>&1)"; then
  wait "$session_a"
  echo "   ECHEC : la seconde session a obtenu la chambre"; exit 1
fi
wait "$session_a"
if echo "$session_b" | grep -q 'reservation_rooms_no_double_booking'; then
  echo "   OK    la session B a attendu la fin de A, puis a été refusée (contrainte anti-double attribution)"
else
  echo "   ECHEC : erreur inattendue : $session_b"; exit 1
fi
echo "   attributions de la chambre 112 : $(psql_test -tAc "SELECT count(*) FROM reservation_rooms rr JOIN rooms r ON r.id = rr.room_id WHERE r.number = '112'")"

step "5. Annulation de toutes les migrations"
apply_down
remaining="$(count_tables)"
echo "   tables restantes : $remaining"
[ "$remaining" = "0" ] || { echo "   ECHEC : des tables subsistent"; exit 1; }

step "6. Nouvelle application (réversibilité)"
apply_up
echo "   tables créées : $(count_tables)"

printf '\nToutes les vérifications de la base sont passées.\n'
