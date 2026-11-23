# AI-Powered Lead Intelligence, CRM & Outreach Automation Platform

> **Technical Product Requirements Document (PRD) v1.0 & Monorepo Foundation**  
> *A contract-first, free-tier deployment architecture for automated lead discovery, intelligent contact enrichment, explainable quality scoring, and human-in-the-loop email outreach.*

---

## 1. System Overview

This platform automatically discovers fresher (0–2 year) and student job opportunities across approved portals, stores them in a central PostgreSQL CRM, supports cost-controlled manual contact enrichment, executes email deliverability verification, calculates an explainable 0–100 data quality score, generates fact-grounded outreach email drafts via **Google Gemini Flash**, and requires strict **human approval** prior to message dispatch.

### Core Architectural Principles
1. **Free-Tier First**: Zero paid cloud infrastructure required. The MVP runs completely on free-tier services (Cloudflare Pages, Oracle Cloud Always Free VM, Neon Free PostgreSQL, Gemini Flash free quota).
2. **Strictly No ORM**: All database interactions use parameterised raw SQL via `psycopg3` and connection pooling with `psycopg_pool`. No ORM overhead, magic query caching, or abstraction leaks.
3. **Contract-First Monorepo**: Teams (Frontend, Backend, AI, Automation) build concurrently against strict interface contracts in `contracts/openapi.yaml`, `contracts/events.md`, and `contracts/ai-schemas/`.
4. **Human-in-the-Loop Dispatch**: The system never sends outreach automatically. A Campaign Manager reviews and approves every exact recipient and message body.
5. **Traceability & Auditability**: Complete source provenance, immutable audit trails, and correlation IDs across every request.

---

## 2. Monorepo Structure

```text
├── .github/                      # CI/CD workflows, CODEOWNERS, PR & issue templates
├── contracts/                    # [LEADS ONLY] OpenAPI 3.0 spec, event contracts, AI schemas
├── docs/                         # Guides: architecture, frontend, backend, AI, error playbook, tasksheet
├── database/                     # Sequential raw SQL migrations, reusable queries, demo seeds, runner
├── backend/                      # FastAPI core backend service, API routes, direct SQL repos
├── automation/                   # Scrapers (Playwright), source registry, normalizers, n8n workflows
├── ai/                           # Isolated AI Python package: Gemini client, prompts, fact-checkers, evals
├── frontend/                     # Vite + React 18 CRM dashboard, design tokens, MSW mocks
└── infra/                        # Caddy reverse proxy config, VM setup instructions, backup scripts
```

---

## 3. Technology Stack & Free-Tier Services

| Layer | Technology | Free Tier Service | Role |
| :--- | :--- | :--- | :--- |
| **Frontend** | React 18, Vite | Cloudflare Pages | CRM dashboard & manual trigger controls |
| **Backend API** | Python 3.11+, FastAPI | Oracle Always Free VM | Business logic, direct SQL, auth, and coordination |
| **Database** | PostgreSQL 16 | Neon Free Tier | Serverless remote database (managed direct SQL) |
| **Automation** | n8n Community Edition | Oracle Always Free VM | Scheduled orchestration, webhooks, retries |
| **Scraper** | Playwright (Python) | Oracle Always Free VM | Headless browser data extraction (max 2 concurrency) |
| **AI Engine** | Gemini Flash model | Google AI Studio Free | Structured, fact-grounded email drafting |
| **Reverse Proxy**| Caddy v2 (Docker) | Oracle Always Free VM | Automatic TLS certificates & route proxy |

---

## 4. Quickstart for Interns

### Step 1: Clone and Set Up Environment
```bash
git clone https://github.com/Akshay-Sharma777/AI-Powered-CRM-and-Outreach-Automation-Platform.git
cd AI-Powered-CRM-and-Outreach-Automation-Platform

# Copy template environment variables
cp .env.example .env
```

### Step 2: Running the Backend
```bash
# Set up Python virtual environment
python -m venv venv
# Windows: venv\Scripts\activate | macOS/Linux: source venv/bin/activate

pip install -r backend/requirements.txt

# Run migrations (inspect pending with --dry-run)
python database/run_migrations.py --dry-run

# Start FastAPI development server
uvicorn backend.app.main:app --reload --port 8000
```
API Documentation will be live at: [http://localhost:8000/docs](http://localhost:8000/docs)

### Step 3: Running the Frontend
```bash
cd frontend
npm install
npm run dev
```
Dashboard will be live at: [http://localhost:5173](http://localhost:5173)  
*(Frontend runs offline against mock data by default; no backend required to build UI screens!)*

### Step 4: Running AI Evaluation Suite
```bash
pytest ai/
python ai/evals/ci_eval.py
```

---

## 5. Working Rules for Interns

Before starting any task, carefully read [CONTRIBUTING.md](CONTRIBUTING.md).

1. **One Task = One Branch = One PR**: Branch naming format `feature/<TASK-ID>-<short-name>` (e.g. `feature/FE-09-lead-table`).
2. **Touch Only Assigned Files**: Never edit files outside your assigned ticket scope.
3. **Shared Files are Lead-Only**: Do not modify `package.json`, `requirements.txt`, `docker-compose.yml`, or `contracts/` without an approved issue.
4. **Contract-First**: Always build against `contracts/openapi.yaml` and mock data.
5. **Strictly No ORM**: All database queries must be parameterised raw SQL (`%s`).
6. **Never Commit Secrets**: Live keys stay in `.env`.
7. **Complete Ticket Index**: Find your assigned tasks and acceptance criteria in [docs/tasksheet.md](docs/tasksheet.md).

---

## 6. Default Demo Credentials (Local Dev Only)

| Role | Email | Password | Allowed Capabilities |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@example.com` | `Password123!` | Full permissions, user management, budgets |
| **Researcher** | `researcher@example.com` | `Password123!` | Review leads, claim leads, enrich, verify |
| **Campaign Manager**| `campaigns@example.com` | `Password123!` | Review AI drafts, approve, dispatch outreach |
| **Developer** | `developer@example.com` | `Password123!` | View Error Center, replay transient jobs |
### Step 5: Running Backend API Tests

Run backend API tests from the repository root: `python -m pytest backend/tests -q`

Run the complete project test suite: `python -m pytest -q`

Test environment:
- ENVIRONMENT, SECRET_KEY and GEMINI_MOCK_MODE are configured with test values in backend/tests/conftest.py.
- DATABASE_URL is optional. Database integration tests are skipped when it is not configured.
- If DATABASE_URL is configured, use a disposable test database, never production.
- Never commit real credentials or secrets.
