#!/usr/bin/env bash
# Self-test for infra/backup/backup.sh (BE-57).
# Needs no database: a fake pg_dump (and, in some cases, a fake gzip) is put
# first on the PATH. Covers retention, credentials, permissions and failures.
# Usage: bash infra/backup/backup_selftest.sh
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SH="${HERE}/backup.sh"
[ -f "${BACKUP_SH}" ] || { echo "backup.sh not found next to this script" >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
OUT="${WORK}/out.txt"
export FAKE_LOG="${WORK}/fakelog"
PASS=0; FAIL=0; SKIP=0; N=0

ok()   { echo "  PASS: $1"; PASS=$((PASS + 1)); }
bad()  { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }
skip() { echo "  SKIP: $1"; SKIP=$((SKIP + 1)); }
assert() { local msg="$1"; shift; if "$@"; then ok "${msg}"; else bad "${msg}"; fi; }
refute() { local msg="$1"; shift; if "$@"; then bad "${msg}"; else ok "${msg}"; fi; }

mode()  { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1" 2>/dev/null; }
count() { find "$1" -maxdepth 1 -type f -name 'crm_db_*.sql.gz' | wc -l | tr -d ' '; }
list()  { find "$1" -type f | sort; }

# Does this filesystem honour chmod? (Windows drives under Git Bash do not.)
mkdir "${WORK}/probe"; chmod 700 "${WORK}/probe"
if [ "$(mode "${WORK}/probe")" = "700" ]; then PERMS_OK=1; else PERMS_OK=0; fi

# ---- fake tools ---------------------------------------------------------------
mkdir -p "${WORK}/bin"
REAL_GZIP="$(command -v gzip)"; export REAL_GZIP

cat > "${WORK}/bin/pg_dump" <<'EOF'
#!/usr/bin/env bash
mode="${FAKE_PG_DUMP_MODE:-ok}"
if [ -n "${FAKE_LOG:-}" ]; then
  {
    echo "ARGS=$*"
    echo "DATABASE_URL_SET=${DATABASE_URL+yes}"
    echo "PGPASSWORD_SET=${PGPASSWORD+yes}"
    echo "PGHOST=${PGHOST:-}"
    echo "PGPORT=${PGPORT:-}"
    echo "PGUSER=${PGUSER:-}"
    echo "PGDATABASE=${PGDATABASE:-}"
    echo "PGSSLMODE=${PGSSLMODE:-}"
  } > "${FAKE_LOG}"
  pf="${PGPASSFILE:-}"
  if [ -n "${pf}" ]; then
    if command -v cygpath >/dev/null 2>&1; then pf="$(cygpath -u "${pf}")"; fi
    echo "${pf}" > "${FAKE_LOG}.passpath"
    cat "${pf}" > "${FAKE_LOG}.passfile"
    (stat -c %a "${pf}" 2>/dev/null || stat -f %Lp "${pf}" 2>/dev/null) > "${FAKE_LOG}.passmode"
  fi
  ( ps -ef 2>/dev/null || ps aux 2>/dev/null || ps 2>/dev/null ) > "${FAKE_LOG}.ps"
fi
case "${mode}" in
  fail)    echo "pg_dump: simulated failure" >&2; exit 1 ;;
  partial) echo "-- partial dump"; echo "CREATE TABLE t (id int);"
           echo "pg_dump: simulated failure half-way" >&2; exit 1 ;;
  *)       echo "-- fake dump"; echo "CREATE TABLE leads (id int);" ;;
esac
EOF

cat > "${WORK}/bin/gzip" <<'EOF'
#!/usr/bin/env bash
case "${FAKE_GZIP_MODE:-}" in
  fail)    cat >/dev/null 2>&1; echo "gzip: simulated failure" >&2; exit 1 ;;
  corrupt) if [ "${1:-}" = "-t" ]; then exec "${REAL_GZIP}" "$@"; fi; cat; exit 0 ;;
  *)       exec "${REAL_GZIP}" "$@" ;;
esac
EOF
chmod +x "${WORK}/bin/pg_dump" "${WORK}/bin/gzip"
export PATH="${WORK}/bin:${PATH}"

# ---- helpers ------------------------------------------------------------------
# seed <dir> <n_daily> <n_weekly>: old backups with timestamps from 2019/2020
seed() {
  local dir="$1" nd="$2" nw="$3" i
  mkdir -p "${dir}/daily" "${dir}/weekly"
  for i in $(seq 1 "${nd}"); do printf 'x' > "${dir}/daily/$(printf 'crm_db_2020%02d01_000000.sql.gz' "${i}")"; done
  for i in $(seq 1 "${nw}"); do printf 'x' > "${dir}/weekly/$(printf 'crm_db_2019%02d01_000000.sql.gz' "${i}")"; done
}

# run_backup <backup_dir> <database_url|__unset__> [VAR=value ...]  -> sets RC, writes ${OUT}
run_backup() {
  local dir="$1" url="$2"; shift 2
  (
    unset DATABASE_URL DAILY_KEEP WEEKLY_KEEP DAY_OF_WEEK PGPASSWORD
    export BACKUP_DIR="${dir}"
    if [ "${url}" != "__unset__" ]; then export DATABASE_URL="${url}"; fi
    for kv in "$@"; do export "${kv}"; done
    bash "${BACKUP_SH}"
  ) > "${OUT}" 2>&1
  RC=$?
}

PLAIN='p:a@s/s%w0rd'
ENCODED='p%3Aa%40s%2Fs%25w0rd'
GOOD_URL="postgresql://dbuser:${ENCODED}@db.example.test:5433/crm_test?sslmode=require"

# ---- 1. Retention -------------------------------------------------------------
echo "== Retention =="
D="${WORK}/ret1"; seed "${D}" 10 6
run_backup "${D}" "${GOOD_URL}" DAY_OF_WEEK=7
assert "Sunday run succeeds" [ "${RC}" -eq 0 ]
assert "daily folder ends with exactly 7" [ "$(count "${D}/daily")" -eq 7 ]
assert "weekly folder ends with exactly 4" [ "$(count "${D}/weekly")" -eq 4 ]
NEWEST="$(ls -1 "${D}/daily" | sort | tail -n 1)"
assert "Sunday run adds a weekly copy of the new backup" [ -f "${D}/weekly/${NEWEST}" ]
assert "oldest daily backup was removed" [ ! -e "${D}/daily/crm_db_20200101_000000.sql.gz" ]
assert "newer old daily backup was kept" [ -e "${D}/daily/crm_db_20201001_000000.sql.gz" ]

D="${WORK}/ret2"; seed "${D}" 3 2
run_backup "${D}" "${GOOD_URL}" DAY_OF_WEEK=3
assert "mid-week run succeeds" [ "${RC}" -eq 0 ]
assert "mid-week run adds a daily backup" [ "$(count "${D}/daily")" -eq 4 ]
assert "mid-week run adds no weekly copy" [ "$(count "${D}/weekly")" -eq 2 ]

# ---- 2. Credentials -----------------------------------------------------------
echo "== Credentials =="
rm -f "${FAKE_LOG}"*
D="${WORK}/cred"
run_backup "${D}" "${GOOD_URL}"
assert "backup with a special-character password succeeds" [ "${RC}" -eq 0 ]
refute "password absent from script output" grep -Fq -- "${PLAIN}" "${OUT}"
refute "encoded password absent from script output" grep -Fq -- "${ENCODED}" "${OUT}"
refute "password absent from process list" grep -Fq -- "${PLAIN}" "${FAKE_LOG}.ps"
refute "encoded password absent from process list" grep -Fq -- "${ENCODED}" "${FAKE_LOG}.ps"
assert "pg_dump got no connection details on its command line" \
  grep -qx -- "ARGS=--no-owner --no-privileges" "${FAKE_LOG}"
refute "pg_dump did not see DATABASE_URL" grep -q "^DATABASE_URL_SET=yes" "${FAKE_LOG}"
refute "pg_dump did not see PGPASSWORD" grep -q "^PGPASSWORD_SET=yes" "${FAKE_LOG}"
assert "connection settings passed through PG* variables" \
  [ "$(grep -cE '^(PGHOST=db.example.test|PGPORT=5433|PGUSER=dbuser|PGDATABASE=crm_test|PGSSLMODE=require)$' "${FAKE_LOG}")" -eq 5 ]
EXPECTED_LINE="db.example.test:5433:crm_test:dbuser:p\\:a@s/s%w0rd"
assert "password file holds the decoded, escaped password" \
  [ "$(cat "${FAKE_LOG}.passfile" 2>/dev/null)" = "${EXPECTED_LINE}" ]
if [ "${PERMS_OK}" -eq 1 ]; then
  assert "password file has mode 600" [ "$(cat "${FAKE_LOG}.passmode" 2>/dev/null)" = "600" ]
else
  skip "password file mode (this filesystem ignores chmod; run in WSL/Linux)"
fi
assert "password file deleted after the run" [ ! -e "$(cat "${FAKE_LOG}.passpath" 2>/dev/null)" ]

# ---- 3. Permissions -----------------------------------------------------------
echo "== Permissions =="
D="${WORK}/perm/new"
run_backup "${D}" "${GOOD_URL}" DAY_OF_WEEK=7
assert "run that creates the folders succeeds" [ "${RC}" -eq 0 ]
if [ "${PERMS_OK}" -eq 1 ]; then
  assert "folder the script creates is 700" [ "$(mode "${D}")" = "700" ]
  assert "daily folder is 700" [ "$(mode "${D}/daily")" = "700" ]
  assert "weekly folder is 700" [ "$(mode "${D}/weekly")" = "700" ]
  F="$(find "${D}/daily" -type f | head -n 1)"
  assert "daily backup file is 600" [ "$(mode "${F}")" = "600" ]
  W="$(find "${D}/weekly" -type f | head -n 1)"
  assert "weekly backup file is 600" [ "$(mode "${W}")" = "600" ]
else
  skip "folder and file modes (this filesystem ignores chmod; run in WSL/Linux)"
fi

# ---- 4. Failures --------------------------------------------------------------
echo "== Failures =="
failure_case() { # failure_case <name> <database_url|__unset__> [VAR=value ...]
  local name="$1" url="$2"; shift 2
  local d="${WORK}/fail_$((++N))" before
  seed "${d}" 7 4
  before="$(list "${d}")"
  run_backup "${d}" "${url}" DAY_OF_WEEK=7 "$@"
  assert "${name}: exits with an error" [ "${RC}" -ne 0 ]
  assert "${name}: prints Backup FAILED" grep -q "Backup FAILED" "${OUT}"
  assert "${name}: no new or partial file, nothing deleted" [ "$(list "${d}")" = "${before}" ]
}
failure_case "pg_dump fails at once"       "${GOOD_URL}" FAKE_PG_DUMP_MODE=fail
failure_case "pg_dump fails half-way"      "${GOOD_URL}" FAKE_PG_DUMP_MODE=partial
failure_case "compression fails"           "${GOOD_URL}" FAKE_GZIP_MODE=fail
failure_case "compression gives corrupt archive" "${GOOD_URL}" FAKE_GZIP_MODE=corrupt
failure_case "DATABASE_URL missing"        "__unset__"
failure_case "DATABASE_URL malformed"      "not-a-url"
failure_case "DAILY_KEEP=0"                "${GOOD_URL}" DAILY_KEEP=0

echo
echo "Passed: ${PASS}   Failed: ${FAIL}   Skipped: ${SKIP}"
[ "${FAIL}" -eq 0 ]
