# Backend Developer Guide

Welcome to the backend engineering team! This guide explains our architecture, direct SQL conventions, and development workflow.

---

## 1. Tech Stack & Engineering Principles

- **Framework**: FastAPI (asynchronous, type-safe, auto-documenting)
- **Database Driver**: `psycopg` (v3) + `psycopg_pool` (ConnectionPool)
- **Database**: Remote Neon PostgreSQL (Free Tier)
- **Strict Rule: NO ORM**
  - We do NOT use SQLAlchemy ORM, Tortoise, or Peewee.
  - Every query is written as parameterised SQL (`%s` placeholders).
  - Why? Full control over indexes, query plans, execution time, zero magic caching bugs, and rock-solid performance on free-tier compute.
- **Security First**: All endpoints authenticate via JWT. Passwords use bcrypt/argon2. Never commit secrets.

---

## 2. Directory Structure

```
backend/
├── Dockerfile
├── requirements.txt         # (LEAD-ONLY) Root dependencies
├── app/
│   ├── main.py              # FastAPI application entry point & router mounting
│   ├── core/
│   │   ├── config.py        # Settings loaded from environment variables
│   │   ├── db.py            # psycopg_pool connection pool & transaction helper
│   │   ├── security.py      # JWT creation, password hashing, role guard dependencies
│   │   ├── logging.py       # JSON logging & X-Correlation-ID middleware
│   │   ├── errors.py        # Centralized HTTP exception classes
│   │   └── retry.py         # Exponential backoff with jitter helper
│   ├── api/v1/              # Endpoint route controllers
│   │   ├── auth.py
│   │   ├── leads.py
│   │   ├── enrichment.py
│   │   ├── verification.py
│   │   ├── campaigns.py
│   │   ├── approvals.py
│   │   ├── suppression.py
│   │   ├── webhooks.py
│   │   └── health.py
│   ├── services/            # Business logic (dedup, scoring, audit, dispatch)
│   ├── repositories/        # Raw SQL queries (leads_repo, contacts_repo, etc.)
│   ├── schemas/             # Pydantic request/response models
│   └── integrations/        # External clients (ContactOut, Snov, Verifier, Email)
└── tests/
    ├── conftest.py
    └── test_health.py
```

---

## 3. Database & Migrations

All database schema changes are managed via raw SQL migration files in `database/migrations/`:
- `001_users_roles.sql`
- `002_organizations_sources.sql`
- `003_opportunities_contacts.sql`
- `004_enrichment_verification_scores.sql`
- `005_campaigns_drafts_approvals.sql`
- `006_messages_events_suppression.sql`
- `007_jobs_errors_audit.sql`

### Running Migrations:
```bash
# Check what migrations are pending (dry run)
python database/run_migrations.py --dry-run

# Apply all migrations
python database/run_migrations.py
```

The migration runner records checksums in `schema_migrations`. If an already-applied file has been modified, it aborts to prevent drift.

---

## 4. Query Guidelines: Parameterised SQL Only

Always use tuple parameterisation. **NEVER use Python f-strings or `.format()` to construct SQL queries!**

```python
# CORRECT:
with get_conn() as conn:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, title FROM opportunities WHERE status = %s AND score >= %s",
            (status, min_score)
        )
        rows = cur.fetchall()

# FORBIDDEN (SECURITY RISK & CODE REVIEW REJECTION):
cur.execute(f"SELECT * FROM opportunities WHERE status = '{status}'")  # REJECTED!
```

---

## 5. Local Setup & Testing

```bash
# 1. Create Python virtual environment
python -m venv venv
venv\Scripts\activate       # On Windows
# source venv/bin/activate  # On macOS/Linux

# 2. Install dependencies
pip install -r backend/requirements.txt

# 3. Start development server
uvicorn backend.app.main:app --reload --port 8000
```

Visit the interactive OpenAPI docs at `http://localhost:8000/docs`.

### Running Tests:
```bash
pytest backend/tests
```

## Audit Logging Service

- **File:** `backend/app/services/audit_service.py`
- **Helper:** `log_action(conn, actor, action, entity_type, entity_id, details_dict)`
- Writes audit events using parameterized SQL and stores details as JSONB.
- Redacts sensitive information, including email addresses, phone numbers, and authentication tokens, before persistence.
- Uses the caller's database transaction; the service does not commit or roll back independently.
- **Tests:** Run `python -m pytest backend/tests -v`.

## Lead List API: Pagination, Filtering & Sorting (BE-30)

**Endpoint:** `GET /api/v1/leads`

The endpoint returns a paginated response containing `items`, `total`, `page`, `page_size`, and `total_pages`.

### Pagination
- `page`: 1-based page number; defaults to `1`; minimum value is `1`.
- `page_size`: defaults to `25`; allowed range is `1`�`100`.
- Offset is calculated as `(page - 1) * page_size`.
- `total` represents the number of records matching the filters.

### Filters
The endpoint supports these optional query parameters:
- `source`
- `experience_min` and `experience_max` (non-negative values; minimum must not exceed maximum)
- `score_band`: `high`, `medium`, `low`, or `suppressed`
- `status`: `new`, `needs_enrichment`, `verified`, `draft_ready`, `approved`, `sent`, or `closed`
- `assigned_to`
- `search`: searches lead titles and organization names.

### Sorting
- `sort_by` defaults to `discovered_at`.
- Supported fields: `discovered_at`, `score`, `experience_min`, `experience_max`, `organization_name`, and `title`.
- `sort_order` defaults to `desc`; supported values are `asc` and `desc`.
- Sorting uses predefined SQL column and direction allowlists. `o.id ASC` is used as a stable tie-breaker.

### SQL Safety
- User-provided filter values are passed through parameterized SQL queries.
- Sort column names and directions are selected only from predefined allowlists.
- Never interpolate raw user input into SQL statements.
