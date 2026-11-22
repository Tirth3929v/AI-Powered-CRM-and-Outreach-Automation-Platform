#!/usr/bin/env bash
# ==============================================================================
# Database Backup and Rotation Script (BE-57)
# Dumps the PostgreSQL (Neon) database to a compressed file and keeps the
# newest 7 daily and 4 weekly copies. Intended to run once a day.
#
# Usage:    DATABASE_URL="<direct connection string>" ./infra/backup/backup.sh
# Optional: BACKUP_DIR   (default /var/backups/outreach-crm)
#           DAILY_KEEP   (default 7)
#           WEEKLY_KEEP  (default 4)
# Restore:  see infra/backup/restore_guide.md
#
# Security notes:
#   * DATABASE_URL is split into PG* settings. The password goes into a
#     temporary owner-only password file (PGPASSFILE), never onto a command
#     line, so it cannot show up in process listings. DATABASE_URL is unset
#     before any other program runs.
#   * The script never prints the connection string and never uses `set -x`.
#   * Backups contain customer data: umask 077 makes new directories 700 and
#     new files 600 (owner only).
# ==============================================================================

set -euo pipefail
umask 077

BACKUP_DIR="${BACKUP_DIR:-/var/backups/outreach-crm}"
DAILY_KEEP="${DAILY_KEEP:-7}"
WEEKLY_KEEP="${WEEKLY_KEEP:-4}"
DATE_TAG="$(date +'%Y%m%d_%H%M%S')"
DAY_OF_WEEK="${DAY_OF_WEEK:-$(date +'%u')}" # 1 = Monday, 7 = Sunday (override only for testing)
DAILY_DIR="${BACKUP_DIR}/daily"
WEEKLY_DIR="${BACKUP_DIR}/weekly"
DUMP_FILE="${DAILY_DIR}/crm_db_${DATE_TAG}.sql.gz"
TMP_FILE="${DUMP_FILE}.partial"
PGPASS_TMP=""

# Runs on every exit: removes temporary files and reports failures.
cleanup() {
  local status=$?
  rm -f -- "${TMP_FILE}"
  if [ -n "${PGPASS_TMP}" ]; then
    rm -f -- "${PGPASS_TMP}"
  fi
  if [ "${status}" -ne 0 ]; then
    echo "[$(date -u)] Backup FAILED (exit code ${status})." >&2
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ---- Checks before anything is touched ---------------------------------------

for tool in pg_dump gzip; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    echo "Error: required tool '${tool}' was not found in PATH." >&2
    exit 1
  fi
done

for setting in DAILY_KEEP WEEKLY_KEEP; do
  case "${!setting}" in
    '' | *[!0-9]* | 0)
      echo "Error: ${setting} must be a whole number of 1 or more." >&2
      exit 1
      ;;
  esac
done

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL environment variable is not set." >&2
  exit 1
fi

# ---- Turn DATABASE_URL into PG* settings (password stays off command lines) ---

urldecode() {
  local s="${1//\\/\\\\}"
  printf '%b' "${s//%/\\x}"
}

# In a password file, ':' and '\' must be escaped with a backslash.
pgpass_escape() {
  local s="${1//\\/\\\\}"
  printf '%s' "${s//:/\\:}"
}

url_pattern='^postgres(ql)?://([^:@/]+)(:([^@]*))?@([^:/?]+)(:([0-9]+))?/([^?]+)(\?(.*))?$'
if [[ ! "${DATABASE_URL}" =~ ${url_pattern} ]]; then
  echo "Error: DATABASE_URL must look like postgresql://user:password@host[:port]/dbname[?sslmode=require]." >&2
  exit 1
fi

DB_USER="$(urldecode "${BASH_REMATCH[2]}")"
DB_PASS="$(urldecode "${BASH_REMATCH[4]:-}")"
DB_HOST="${BASH_REMATCH[5]}"
DB_PORT="${BASH_REMATCH[7]:-5432}"
DB_NAME="$(urldecode "${BASH_REMATCH[8]}")"
DB_QUERY="${BASH_REMATCH[10]:-}"
unset DATABASE_URL

export PGHOST="${DB_HOST}" PGPORT="${DB_PORT}" PGUSER="${DB_USER}" PGDATABASE="${DB_NAME}"

IFS='&' read -r -a url_options <<< "${DB_QUERY}"
for option in "${url_options[@]:-}"; do
  key="${option%%=*}"
  value="$(urldecode "${option#*=}")"
  case "${key}" in
    '') ;;
    sslmode) export PGSSLMODE="${value}" ;;
    channel_binding) export PGCHANNELBINDING="${value}" ;;
    connect_timeout) export PGCONNECT_TIMEOUT="${value}" ;;
    *) echo "Warning: ignoring unsupported DATABASE_URL option '${key}'." >&2 ;;
  esac
done

if [ -n "${DB_PASS}" ]; then
  PGPASS_TMP="$(mktemp)"
  chmod 600 "${PGPASS_TMP}"
  printf '%s:%s:%s:%s:%s\n' \
    "$(pgpass_escape "${DB_HOST}")" "${DB_PORT}" "$(pgpass_escape "${DB_NAME}")" \
    "$(pgpass_escape "${DB_USER}")" "$(pgpass_escape "${DB_PASS}")" > "${PGPASS_TMP}"
  if command -v cygpath >/dev/null 2>&1; then
    export PGPASSFILE="$(cygpath -w "${PGPASS_TMP}")" # native Windows tools need a Windows path
  else
    export PGPASSFILE="${PGPASS_TMP}"
  fi
  unset PGPASSWORD
fi
unset DB_PASS

# ---- Backup ------------------------------------------------------------------
[ -d "${BACKUP_DIR}" ] || { mkdir -p "${BACKUP_DIR}" && chmod 700 "${BACKUP_DIR}"; }

mkdir -p "${DAILY_DIR}" "${WEEKLY_DIR}"
chmod 700 "${DAILY_DIR}" "${WEEKLY_DIR}"

echo "[$(date -u)] Starting database backup..."

# Plain SQL dump without owner/privilege statements, so it restores into any
# empty database. Compress, verify the archive, then move it into place.
pg_dump --no-owner --no-privileges | gzip > "${TMP_FILE}"
gzip -t "${TMP_FILE}"
mv "${TMP_FILE}" "${DUMP_FILE}"
chmod 600 "${DUMP_FILE}"

# Weekly retention copy on Sundays
if [ "${DAY_OF_WEEK}" -eq 7 ]; then
  echo "[$(date -u)] Storing weekly retention copy..."
  cp "${DUMP_FILE}" "${WEEKLY_DIR}/"
  chmod 600 "${WEEKLY_DIR}/$(basename "${DUMP_FILE}")"
fi

# Keep only the newest N files in a folder. File names start with a timestamp,
# so a reverse name sort puts the newest first.
prune() {
  local dir="$1" keep="$2"
  find "${dir}" -maxdepth 1 -type f -name 'crm_db_*.sql.gz' \
    | sort -r \
    | tail -n +"$((keep + 1))" \
    | while IFS= read -r old; do
        echo "Removing old backup: ${old}"
        rm -f -- "${old}"
      done
}

prune "${DAILY_DIR}" "${DAILY_KEEP}"
prune "${WEEKLY_DIR}" "${WEEKLY_KEEP}"

echo "[$(date -u)] Database backup completed successfully: ${DUMP_FILE}"
