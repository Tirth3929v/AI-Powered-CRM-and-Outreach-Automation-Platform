# Team Tasksheet & Complete Ticket Index

This document is the single engineering reference index derived from the project roadmap. It contains all 117 detailed task tickets across Frontend (35), Backend (60), and AI (22).

---

## Quick Reference: Recommended First Tasks (Size S Warm-Ups)

Every new intern starts with at least one **Size S** warm-up task to guarantee a successful first commit:
- **Frontend**: `FE-02` (Design tokens), `FE-06` (Mock API), `FE-13` (Score badge), `FE-15` (Feedback components), `FE-19` (Verification chips), `FE-20` (Credit meter)
- **Backend**: `BE-02` (DB pool), `BE-04` (Users migration), `BE-05` (Orgs migration), `BE-11` (Demo seeds), `BE-14` (RBAC), `BE-17` (Claim endpoint), `BE-19` (Audit writer)
- **AI**: `AI-01` (Package skeleton), `AI-04` (Sample fixtures), `AI-06` (Category classifier), `AI-09` (Prompt versioning), `AI-14` (Score explainer), `AI-20` (Cost tracking)

---

## 1. Frontend Tickets Summary (`frontend/`)

| Ticket ID | Title | Size | Target Files | Dependencies |
| :--- | :--- | :---: | :--- | :--- |
| **FE-01** | Create Vite + React app, ESLint, Prettier | M | `frontend/`, root configs | none |
| **FE-02** | Colors, fonts, spacing (design tokens) | S | `src/styles/tokens.css`, `global.css` | FE-01 |
| **FE-03** | App layout: sidebar, header, routing | M | `src/components/layout/`, `src/App.jsx` | FE-01 |
| **FE-04** | UI kit: Button, Input, Select, Modal, Badge, Table | M | `src/components/ui/`, `src/pages/_Kitchen/` | FE-02 |
| **FE-05** | API client wrapper (auth header, error handling) | S | `src/api/client.js` | FE-01 |
| **FE-06** | Mock API with sample leads (MSW) | S | `src/mocks/` | FE-01 |
| **FE-07** | Login page, auth context, protected routes | M | `src/pages/Login/`, `src/store/auth.js` | FE-05 |
| **FE-08** | Role-based menu and page guard | S | `src/utils/roles.js` | FE-07 |
| **FE-09** | Lead Pipeline table (pagination, sorting) | L | `src/pages/LeadPipeline/LeadTable.jsx` | FE-04, FE-06 |
| **FE-10** | Filters and search (source, exp, score, status) | M | `src/pages/LeadPipeline/LeadFilters.jsx` | FE-09 |
| **FE-11** | Lead detail drawer (provenance, score reasons) | M | `src/pages/LeadPipeline/LeadDetailDrawer.jsx` | FE-09 |
| **FE-12** | Kanban view toggle | M | `src/pages/LeadPipeline/LeadKanban.jsx` | FE-09 |
| **FE-13** | Score badge with reason-code tooltip | S | `src/components/score/` | FE-04 |
| **FE-14** | "My Leads" page and claim/assign button | M | `src/pages/MyLeads/` | FE-09 |
| **FE-15** | Loading, empty and error states | S | `src/components/feedback/` | FE-04 |
| **FE-16** | Enrichment Queue page | L | `src/pages/EnrichmentQueue/` | FE-09 |
| **FE-17** | Enrich confirm modal with estimated credit cost | S | `src/pages/EnrichmentQueue/EnrichConfirmModal.jsx` | FE-16 |
| **FE-18** | Enrichment history panel | S | `src/pages/EnrichmentQueue/History.jsx` | FE-16 |
| **FE-19** | Verify Email button and status chips | S | `src/components/verification/` | FE-04 |
| **FE-20** | Credit usage meter widget | S | `src/components/credits/` | FE-04 |
| **FE-21** | Campaign Manager: audience review list | M | `src/pages/CampaignManager/Audience.jsx` | FE-09 |
| **FE-22** | Draft review and edit screen | L | `src/pages/CampaignManager/DraftEditor.jsx` | FE-21 |
| **FE-23** | Approval screen with final checklist summary | M | `src/pages/CampaignManager/Approval.jsx` | FE-22 |
| **FE-24** | Send, schedule and pause controls | S | `src/pages/CampaignManager/Controls.jsx` | FE-23 |
| **FE-25** | Campaign outcomes (delivered, replied, bounced) | M | `src/pages/CampaignManager/Outcomes.jsx` | FE-21 |
| **FE-26** | Suppression Management page | M | `src/pages/Suppression/` | FE-04 |
| **FE-27** | System Health dashboard | L | `src/pages/SystemHealth/` | FE-04 |
| **FE-28** | Error Center page (retry state, owner, replay) | L | `src/pages/ErrorCenter/` | FE-04 |
| **FE-29** | Source health panel | S | `src/pages/SystemHealth/SourceHealth.jsx` | FE-27 |
| **FE-30** | Admin: users and roles screen | M | `src/pages/Admin/Users.jsx` | FE-04 |
| **FE-31** | Admin: source registry and budget settings | M | `src/pages/Admin/Sources.jsx` | FE-04 |
| **FE-32** | Accessibility and mobile-responsive pass | M | `src/styles/`, responsive testing | most pages |
| **FE-33** | Component tests (Vitest + Testing Library) | M | `src/**/__tests__/` | page done |
| **FE-34** | Cloudflare Pages build config | S | `frontend/public/_redirects` | FE-01 |
| **FE-35** | Frontend user guide with screenshots | S | `docs/frontend-guide.md` | all pages |

---

## 2. Backend Tickets Summary (`backend/`, `database/`, `automation/`, `infra/`)

| Ticket ID | Title | Size | Target Files |
| :--- | :--- | :---: | :--- |
| **BE-01** | FastAPI skeleton, config, `/health` endpoint | M | `backend/app/main.py`, `core/config.py` |
| **BE-02** | Database pool with `psycopg_pool` | S | `backend/app/core/db.py` |
| **BE-03** | Migration runner script | M | `database/run_migrations.py` |
| **BE-04** | Migration 001: users, roles, user_roles | S | `database/migrations/001_*.sql` |
| **BE-05** | Migration 002: organizations, sources | S | `database/migrations/002_*.sql` |
| **BE-06** | Migration 003: opportunities, contacts | M | `database/migrations/003_*.sql` |
| **BE-07** | Migration 004: enrichment, verification, scores | S | `database/migrations/004_*.sql` |
| **BE-08** | Migration 005: campaigns, drafts, approvals | S | `database/migrations/005_*.sql` |
| **BE-09** | Migration 006: messages, events, suppression | S | `database/migrations/006_*.sql` |
| **BE-10** | Migration 007: jobs, errors, audit | S | `database/migrations/007_*.sql` |
| **BE-11** | Seed data: demo users, orgs, leads | S | `database/seeds/001_demo.sql` |
| **BE-12** | Backend Dockerfile and base Docker Compose | M | `backend/Dockerfile` |
| **BE-13** | Password hashing, JWT, login endpoint | M | `backend/app/api/v1/auth.py`, `core/security.py` |
| **BE-14** | Role-based access dependency | S | `backend/app/core/security.py` |
| **BE-15** | Leads repository (parameterised raw SQL) | M | `backend/app/repositories/leads_repo.py` |
| **BE-16** | `GET /leads` and `GET /leads/{id}` | M | `backend/app/api/v1/leads.py` |
| **BE-17** | Claim / assign endpoint ("My Leads") | S | `backend/app/api/v1/leads.py` |
| **BE-18** | Dedup service (source ID, URL, normalized title) | M | `backend/app/services/dedup_service.py` |
| **BE-19** | Audit log writer (actor, action, details) | S | `backend/app/services/audit_service.py` |
| **BE-20** | Structured logging and correlation-ID middleware | S | `backend/app/core/logging.py` |
| **BE-21** | Scraper base class with exception wrapper | M | `automation/scrapers/base.py` |
| **BE-22** | Approved source registry | S | `automation/scrapers/registry.py` |
| **BE-23** | Field normalizer (experience, salary, location)| M | `automation/scrapers/normalizer.py` |
| **BE-24** | `POST /webhooks/scraper-ingest` bulk upsert | M | `backend/app/api/v1/webhooks.py` |
| **BE-25** | Scraper: Internshala | M | `automation/scrapers/sources/internshala.py` |
| **BE-26** | Scraper: Naukri | M | `automation/scrapers/sources/naukri.py` |
| **BE-27** | Scraper: Apna | M | `automation/scrapers/sources/apna.py` |
| **BE-28** | Campaign CRUD API (assigned to Manoj) | M | `backend/app/api/v1/campaigns.py`, `backend/app/repositories/campaigns_repo.py`, `backend/tests/test_campaigns.py` |
| **BE-29** | Scraper: Shine | M | `automation/scrapers/sources/shine.py` |
| **BE-30** | Scraper: Hackathons | M | `automation/scrapers/sources/hackathons.py` |
| **BE-31** | Scraper: College & TPO directories | M | `automation/scrapers/sources/college_tpo.py` |
| **BE-32** | Scraper: Startup portals | M | `automation/scrapers/sources/startups.py` |
| **BE-33** | n8n daily discovery workflow | M | `automation/n8n/workflows/daily_discovery.json` |
| **BE-34** | Playwright concurrency limit & run window | S | `automation/scrapers/runner.py` |
| **BE-35** | Email verification client | M | `backend/app/integrations/email_verifier.py` |
| **BE-36** | `POST /leads/{id}/verify` endpoint | S | `backend/app/api/v1/verification.py` |
| **BE-37** | ContactOut client (enrichment) | M | `backend/app/integrations/contactout_client.py`|
| **BE-38** | Snov.io client (enrichment) | M | `backend/app/integrations/snov_client.py` |
| **BE-39** | Enrichment endpoint with credit confirmation | L | `backend/app/api/v1/enrichment.py` |
| **BE-40** | Credit tracking (daily/monthly limits) | M | `backend/app/services/credit_service.py` |
| **BE-41** | Fallback contact logic (`needs_research`) | S | `backend/app/services/contact_fallback.py` |
| **BE-42** | Scoring service: 5 factors, reason codes | L | `backend/app/services/scoring_service.py` |
| **BE-43** | Score bands & eligibility gate (80+ rule) | S | `backend/app/services/eligibility.py` |
| **BE-44** | Draft endpoints (call AI package, store draft) | M | `backend/app/api/v1/campaigns.py` |
| **BE-45** | Approval endpoints (lock recipient & body hash)| M | `backend/app/api/v1/approvals.py` |
| **BE-46** | Final send checks: suppression, idempotency | L | `backend/app/services/dispatch_service.py` |
| **BE-47** | Email provider integration (Resend / SendGrid) | M | `backend/app/integrations/email_provider.py` |
| **BE-48** | Provider callback webhook with HMAC check | M | `backend/app/api/v1/callbacks.py` |
| **BE-49** | Suppression & unsubscribe endpoints | M | `backend/app/api/v1/suppression.py` |
| **BE-50** | Follow-up rules: cancel on reply/bounce/pause | M | `backend/app/services/followup_service.py` |
| **BE-51** | n8n workflows: enrichment, verification, dispatch | M | `automation/n8n/workflows/` |
| **BE-52** | Error webhook & automation errors storage | M | `backend/app/api/v1/guardrails.py` |
| **BE-53** | n8n global error workflow | S | `automation/n8n/workflows/global_error_workflow.json` |
| **BE-54** | Retry helper with backoff & jitter | S | `backend/app/core/retry.py` |
| **BE-55** | Error Center & system health endpoints | M | `backend/app/api/v1/error_center.py` |
| **BE-56** | Pytest suites per module | M | `backend/tests/` |
| **BE-57** | Neon backup and export script | S | `infra/backup/backup.sh` |
| **BE-58** | Security review: rate limits, secrets, logging | M | `docs/security-review.md` |
| **BE-59** | Postman collection & API guide | S | `docs/backend-guide.md` |
| **BE-60** | Oracle VM setup guide & Caddy config | M | `infra/oracle-vm-setup.md` |

---

## 3. AI Team Tickets Summary (`ai/`)

| Ticket ID | Title | Size | Target Files |
| :--- | :--- | :---: | :--- |
| **AI-01** | Package skeleton, README, config | S | `ai/README.md`, `ai/config.py` |
| **AI-02** | Gemini client wrapper (timeout, backoff, fake mode) | M | `ai/gemini_client.py` |
| **AI-03** | Draft output schema (Pydantic model) | M | `ai/schemas/draft_output.py` |
| **AI-04** | Sample fixtures (30-50 mock job records) | S | `ai/fixtures/` |
| **AI-05** | Experience-range parser (rules + AI fallback)| M | `ai/extraction/experience_parser.py` |
| **AI-06** | Lead category classifier (job, startup, hackathon)| S | `ai/extraction/category_classifier.py` |
| **AI-07** | Fuzzy company-name matcher | M | `ai/extraction/company_matcher.py` |
| **AI-08** | Email draft prompt v1 (verified facts only) | L | `ai/prompts/email_draft_v1.md` |
| **AI-09** | Prompt versioning (`load_prompt`) | S | `ai/prompts/__init__.py` |
| **AI-10** | Output fact-checker (no invented facts/claims) | L | `ai/validators/fact_check.py` |
| **AI-11** | Tone variants: HR, TPO, startup founder | M | `ai/prompts/tone_*.md` |
| **AI-12** | Invalid-output handling (retry once -> review) | S | `ai/validators/output_guard.py` |
| **AI-13** | Safety checks: length, spam words, opt-out line | M | `ai/validators/safety_checks.py` |
| **AI-14** | Score explainer: reason codes to sentences | S | `ai/explain/score_explainer.py` |
| **AI-15** | Draft quality eval set and scoring script | M | `ai/evals/run_eval.py` |
| **AI-16** | Error diagnosis prompt: stack trace to root cause| M | `ai/diagnosis/error_diagnoser.py` |
| **AI-17** | Selector suggester for broken HTML | L | `ai/diagnosis/selector_suggester.py` |
| **AI-18** | n8n payload fix suggester | M | `ai/diagnosis/payload_fixer.py` |
| **AI-19** | Prompt-injection guard for scraped content | M | `ai/validators/injection_guard.py` |
| **AI-20** | Token and cost tracking, hash cache | S | `ai/usage.py` |
| **AI-21** | Prompt catalog documentation | S | `docs/ai-guide.md` |
| **AI-22** | Evaluation in CI quality gate | M | `ai/evals/ci_eval.py` |
