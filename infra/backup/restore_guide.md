# Database Restore Guide (BE-57)

How to take a backup with `infra/backup/backup.sh`, restore it, and prove that the restored database matches the source.
Practise restores on an empty **test** database. Never restore on top of the live database.

## 1. What a backup is

- File name: `crm_db_<YYYYMMDD_HHMMSS>.sql.gz`. It is gzip-compressed plain SQL made with `pg_dump --no-owner --no-privileges`.
- Location: `$BACKUP_DIR/daily/` (newest 7 files) and `$BACKUP_DIR/weekly/` (newest 4 files, one per Sunday). The default `BACKUP_DIR` is `/var/backups/outreach-crm`.
- Backups hold customer data. The script creates the folders as `700` and the files as `600` (owner only). Do not loosen these permissions.
- Backups are never committed to Git. `.gitignore` excludes `*.sql.gz`, `*.dump` and `infra/backup/dumps/`.

## 2. Requirements and test setup

These commands were written for Linux, macOS, WSL and Git Bash on Windows.

- `pg_dump`, `psql`, `createdb` and `dropdb` must be installed. The `pg_dump` major version must be the same as, or newer than, the database server's. Check with `pg_dump --version`.
- On Windows Git Bash, add the PostgreSQL tools to the PATH for the current session (change `18` to your version):
  ```bash
  export PATH="$PATH:/c/Program Files/PostgreSQL/18/bin"
  ```
- For Neon, back up with the **direct** connection string (the host without `-pooler`), not the pooled one.
- Connection details come from environment variables only. Never write passwords or connection strings into files, commits, tickets or chat.

### Connect to a local test server

These variables last only for the current terminal. The password prompt hides what you type:

```bash
export PGHOST=localhost PGPORT=5432 PGUSER=postgres   # use your server's port
read -s -p "postgres password: " PGPASSWORD; echo; export PGPASSWORD
psql -d postgres -c "SELECT version();"
```

The last command must print the server version. If it fails, fix the connection before going on.

### Create a sample source database

Skip this section if you are restoring a real backup.

```bash
createdb crm_backup_src
psql -d crm_backup_src <<'SQL'
CREATE TABLE leads (id serial PRIMARY KEY, company text NOT NULL, email text);
INSERT INTO leads (company, email) VALUES
  ('Acme', 'hr@acme.test'), ('Globex', 'jobs@globex.test'), ('Initech', 'talent@initech.test');
CREATE TABLE campaigns (id serial PRIMARY KEY, name text NOT NULL);
INSERT INTO campaigns (name) VALUES ('Spring outreach');
SQL
```

## 3. Take a backup

Build `DATABASE_URL` without putting the password in your shell history:

```bash
read -s -p "Database password: " DB_PASSWORD; echo
export DATABASE_URL="postgresql://USER:${DB_PASSWORD}@HOST:5432/DBNAME?sslmode=require"
unset DB_PASSWORD
export BACKUP_DIR="$HOME/backups-test"      # optional; the default is /var/backups/outreach-crm
./infra/backup/backup.sh
```

- Replace `USER`, `HOST` and `DBNAME`. For the local sample database use `localhost:<port>`, `crm_backup_src` and your `postgres` user, and drop `?sslmode=require`.
- Special characters in the password must be percent-encoded in the URL (`@` is `%40`, `:` is `%3A`, `/` is `%2F`, `%` is `%25`). A connection string copied from Neon is already encoded.
- A successful run ends with `Database backup completed successfully` and prints the new file name.
- If a run fails, it prints `Backup FAILED`, keeps no new file, and leaves all existing backups untouched.

How the connection string is protected:

- The script splits `DATABASE_URL` into `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` and `PGSSLMODE`. The password goes into a temporary owner-only password file that is deleted when the script ends. It never appears on a command line, so it is not visible in `ps` or in logs.
- The script never prints the connection string and never uses `set -x`. Do not add `set -x` or `echo "$DATABASE_URL"`.

## 4. Restore into an empty database and verify

1. **Pick a dump.** For the newest daily one:
   ```bash
   LATEST="$(ls -1 "$BACKUP_DIR"/daily/*.sql.gz | sort | tail -n 1)"
   echo "$LATEST"
   ```
2. **Check the archive.** No output means the file is intact:
   ```bash
   gzip -t "$LATEST"
   ```
3. **Create an empty test database.** It must be new and separate from the source (locally, or a new Neon branch or database):
   ```bash
   createdb crm_restore_test
   ```
4. **Restore it.** `ON_ERROR_STOP` makes the restore stop at the first error:
   ```bash
   gunzip -c "$LATEST" | psql -X -v ON_ERROR_STOP=1 -q -d crm_restore_test
   ```
5. **Verify that the restored database matches the source.** This compares the columns, the row count of every table, and a checksum of every table's contents:
   ```bash
   snapshot() { # snapshot <database>
     local db="$1" table
     echo "== columns =="
     psql -X -At -d "${db}" -c "SELECT table_schema::text || '.' || table_name::text || ' ' || ordinal_position::text || ' ' || column_name::text || ' ' || data_type::text FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name, ordinal_position"
     echo "== rows and checksums =="
     psql -X -At -d "${db}" -c "SELECT format('%I.%I', schemaname, tablename) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1" |
       while IFS= read -r table; do
         printf '%s ' "${table}"
         psql -X -At -d "${db}" -c "SELECT count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM ${table} t"
       done
   }
   snapshot crm_backup_src   > source_snapshot.txt
   snapshot crm_restore_test > restored_snapshot.txt
   cat source_snapshot.txt
   diff source_snapshot.txt restored_snapshot.txt && echo "MATCH: the restored database matches the source"
   ```
   The restore is verified when `diff` prints nothing and the last line says `MATCH`. Check that `source_snapshot.txt` lists your tables, because two empty snapshots would also match. With the sample database it must list `public.campaigns` (1 row) and `public.leads` (3 rows).
6. **Clean up:**

   ```bash
   dropdb crm_restore_test
   rm -f source_snapshot.txt restored_snapshot.txt
   ```






## 5. Restoring after a real incident

Do not restore on top of the live database. Restore into a **new** empty database (or a new Neon branch), run the checks in section 4, then point the application's `DATABASE_URL` at it in the deployment environment (never in Git) and tell the team.




## 6. Checking the backup script itself

The script is covered by a self-test that needs no database: it puts a fake `pg_dump` (and, for the compression failures, a fake `gzip`) first on the PATH and runs `backup.sh` many times. It checks:

- **Retention:** 10 old daily and 6 old weekly backups plus one new run on a Sunday end at exactly 7 daily and 4 weekly. A mid-week run adds no weekly copy.
- **Credentials:** a fake password (with `:`, `@` and `/` in it) is absent from the process list and from the script output. `pg_dump` receives no `DATABASE_URL`, no `PGPASSWORD` and no connection details on its command line. The temporary password file contains the correctly decoded and escaped password, has mode `600`, and is deleted afterwards.
- **Permissions:** backup folders are `700`, backup files are `600`, and a folder the script creates is `700`.
- **Failures:** `pg_dump` failing at once, `pg_dump` failing half-way, compression failing, compression producing a corrupt archive, a missing `DATABASE_URL`, a malformed `DATABASE_URL` and `DAILY_KEEP=0` all make the script exit with an error, print `Backup FAILED`, keep no new or partial file, and delete nothing.



```bash
bash infra/backup/backup_selftest.sh
```

It ends with a `Passed / Failed / Skipped` line and exits non-zero if anything failed. The file mode checks (password file `600`, folders `700`, backups `600`) need a filesystem that keeps Unix permissions, so on a Windows drive under Git Bash they are reported as `SKIP`. Run it in WSL or Linux to cover them. The process-list check is only a weak check on Git Bash, because its `ps` does not show full command lines.

## 7. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| `pg_dump: error: aborting because of server version mismatch` | `pg_dump` is older than the server | Install a newer PostgreSQL client |
| Backup fails to connect or hangs | A pooled connection string was used | Use the direct connection string |
| `Error: DATABASE_URL must look like postgresql://...` | The URL is malformed, often an unencoded special character in the password | Check the format and percent-encode the password |
| `Error: required tool 'pg_dump' was not found in PATH` | PostgreSQL tools are not installed or not on the PATH | Install them or add them to the PATH |
| `gzip: ... not in gzip format` or `unexpected end of file` | The file is truncated or corrupt | Use the previous backup |
| `relation ... already exists` during restore | The target database was not empty | Create a fresh empty database |
| `extension ... is not available` | The target server lacks an extension used by the schema | Install the extension, or restore into the same kind of server (for example a Neon branch) |
| `$'\r': command not found` | The script was saved with Windows line endings | Save `backup.sh` with LF line endings |

## 8. Running it on a schedule (example)

Keep the connection string in a file **outside the repository**, readable only by its owner (for example `/etc/outreach-crm/backup.env` with `chmod 600`), containing `export DATABASE_URL=...`. Then add a cron entry like:

```
0 2 * * * umask 077; . /etc/outreach-crm/backup.env && /path/to/repo/infra/backup/backup.sh >> /var/log/outreach-crm-backup.log 2>&1
```

- Run it once a day. The weekly copy is taken on Sundays, so the job must run on Sundays.
- The log file contains no secrets, but keep it owned by the backup user.
- Cron runs the script as one user. Make sure that user owns `BACKUP_DIR`.
