/**
 * Enrichment API client (FE-16).
 *
 * The browser NEVER talks to ContactOut or Snov.io directly. Every call here
 * goes to our own backend (contracts/openapi.yaml):
 *
 *   GET  /leads?status=needs_enrichment   -> the queue (operationId: listLeads)
 *   POST /leads/{id}/enrich               -> one lookup (operationId: enrichLeadContact)
 *        body: { provider: 'contactout' | 'snov', confirmed_credits: integer >= 1 }
 *   GET  /system/health                   -> daily / monthly credit usage + budget
 *
 * Mock mode: when VITE_USE_MOCKS=true (or the backend is unreachable) the same
 * contract is served from the fixtures below, so the page can be built and
 * demoed fully offline.
 */
import { apiClient } from './client'
import { listLeads } from './leads'

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'

/* ----------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------- */

export const QUEUE_STATUS = 'needs_enrichment'
export const QUEUE_PAGE_SIZE = 100 // API max page size

export const PROVIDERS = [
  { value: 'contactout', label: 'ContactOut' },
  { value: 'snov', label: 'Snov.io' },
]
export const DEFAULT_PROVIDER = 'contactout'

// FRONTEND ESTIMATE ONLY (credits per lookup). The backend is the source of
// truth for what is really deducted; change these numbers if pricing changes.
export const CREDITS_PER_LOOKUP = { contactout: 2, snov: 1 }

export const MISSING_FIELD_LABELS = {
  email: 'Email',
  phone: 'Phone',
  linkedin_url: 'LinkedIn',
}
const ALL_FIELDS = Object.keys(MISSING_FIELD_LABELS)

export function providerLabel(value) {
  return PROVIDERS.find((p) => p.value === value)?.label || value
}

export function estimateCredits(provider, count = 1) {
  const perLookup = CREDITS_PER_LOOKUP[provider] ?? CREDITS_PER_LOOKUP[DEFAULT_PROVIDER]
  return perLookup * count
}

/* ----------------------------------------------------------------------------
 * Mock data (offline mode)
 * ------------------------------------------------------------------------- */

const MOCK_QUEUE = [
  { id: 'enq-001', organization_name: 'Bharat Fintech Solutions', title: 'Associate React Frontend Engineer', contact_name: 'Priya Nair', missing_fields: ['email', 'phone'], score: 65, discovered_at: '2026-10-15T14:20:00Z' },
  { id: 'enq-002', organization_name: 'Gamma Data Fintech', title: 'Associate Data Analyst', contact_name: 'Rohan Kulkarni', missing_fields: ['email', 'phone', 'linkedin_url'], score: 68, discovered_at: '2026-10-15T09:10:00Z' },
  { id: 'enq-003', organization_name: 'Apex Institute of Technology', title: 'Campus Placement TPO Drive', contact_name: 'Dr. Meera Joshi', missing_fields: ['email'], score: 72, discovered_at: '2026-10-14T16:45:00Z' },
  { id: 'enq-004', organization_name: 'Zeta Stealth Startup', title: 'Founding Engineer (Junior Fullstack)', contact_name: null, missing_fields: ['email', 'linkedin_url'], score: 61, discovered_at: '2026-10-14T09:30:00Z' },
  { id: 'enq-005', organization_name: 'Nimbus Analytics', title: 'ML Intern', contact_name: 'Aditya Rao', missing_fields: ['phone'], score: 77, discovered_at: '2026-10-13T12:00:00Z' },
  { id: 'enq-006', organization_name: 'Lotus Health Tech', title: 'Junior Backend Developer', contact_name: 'Sneha Pillai', missing_fields: ['email', 'phone'], score: 58, discovered_at: '2026-10-13T08:20:00Z' }, // mock lookup finds nothing -> needs_research
  { id: 'enq-007', organization_name: 'Orbit Logistics', title: 'Software Trainee', contact_name: null, missing_fields: ['email', 'phone', 'linkedin_url'], score: 63, discovered_at: '2026-10-12T17:40:00Z' },
  { id: 'enq-008', organization_name: 'Pune Robotics Lab', title: 'Embedded Systems Intern', contact_name: 'Kavita Deshmukh', missing_fields: ['email'], score: 80, discovered_at: '2026-10-12T10:05:00Z' },
]
const MOCK_NO_RESULT_IDS = new Set(['enq-006'])

// Lives only for the browser session so enriched leads do not come back on refresh.
const mockDone = new Set()
const mockUsage = { dailyUsed: 14, dailyBudget: 50, monthlyUsed: 240, monthlyBudget: 1000 }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function mockBudget() {
  return { ...mockUsage }
}

async function mockEnrich(leadId, { provider, confirmed_credits: credits }) {
  await sleep(450)
  if (credits > mockUsage.dailyBudget - mockUsage.dailyUsed) {
    throw { status: 422, code: 'CREDIT_LIMIT', message: 'Daily credit budget exceeded' }
  }
  mockUsage.dailyUsed += credits
  mockUsage.monthlyUsed += credits
  mockDone.add(leadId)
  const found = !MOCK_NO_RESULT_IDS.has(leadId)
  return {
    status: 'success',
    provider,
    credits_used: credits,
    contact: {
      id: `contact-${leadId}`,
      name: 'Jane Doe',
      role_title: 'Technical Recruiter',
      methods: found
        ? [{ kind: 'email', value: 'jane.doe@example.com', provenance: `Enriched via ${provider}` }]
        : [],
    },
  }
}

/* ----------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

/**
 * Turns a lead from the API into one queue row.
 * Works with the plain LeadSummary (no contact info yet) and also with richer
 * objects that carry contact_name / missing_fields / contacts.
 */
export function normalizeQueueItem(lead) {
  const contacts = Array.isArray(lead.contacts) ? lead.contacts : []
  const contactName = lead.contact_name || lead.recruiter_name || contacts[0]?.name || null

  let missing = Array.isArray(lead.missing_fields) ? lead.missing_fields : null
  if (!missing) {
    const have = new Set()
    contacts.forEach((c) =>
      (c.methods || []).forEach((m) => {
        // an email only counts once it is verified deliverable
        if (m.kind === 'email' && m.verified_status !== 'deliverable') return
        have.add(m.kind)
      })
    )
    missing = ALL_FIELDS.filter((field) => !have.has(field))
  }

  return {
    id: lead.id,
    organization_name: lead.organization_name,
    title: lead.title,
    contact_name: contactName,
    missing_fields: missing,
    score: lead.score,
    discovered_at: lead.discovered_at,
  }
}

/* ----------------------------------------------------------------------------
 * Public API
 * ------------------------------------------------------------------------- */

/**
 * Leads that have an organization but still need verified contact details.
 * @returns {Promise<{ items: Array, total: number }>}
 */
export async function getEnrichmentQueue() {
  if (USE_MOCKS) {
    await sleep(250)
    const items = MOCK_QUEUE.filter((l) => !mockDone.has(l.id)).map(normalizeQueueItem)
    return { items, total: items.length }
  }

  const result = await listLeads({
    page: 1,
    pageSize: QUEUE_PAGE_SIZE,
    sortBy: 'discovered_at',
    sortOrder: 'desc',
    filters: { status: QUEUE_STATUS },
  })
  const items = (result.items || []).map(normalizeQueueItem)
  return { items, total: result.total ?? items.length }
}

/**
 * Remaining credit budget, shown in the confirmation modal.
 * @returns {Promise<{dailyUsed:number, dailyBudget:number, monthlyUsed:number, monthlyBudget:number}>}
 */
export async function getCreditBudget() {
  if (USE_MOCKS) return mockBudget()

  try {
    const data = await apiClient('/system/health')
    return {
      dailyUsed: data.daily_credits_used ?? 0,
      dailyBudget: data.daily_credit_budget ?? 0,
      monthlyUsed: data.monthly_credits_used ?? 0,
      monthlyBudget: data.monthly_credit_budget ?? 0,
    }
  } catch (err) {
    if (err?.code === 'NETWORK_ERROR') return mockBudget()
    throw err
  }
}

/**
 * Enrich ONE lead through our backend.
 * @param {string} leadId
 * @param {{provider: 'contactout'|'snov', confirmedCredits: number}} options
 */
export async function enrichLead(leadId, { provider, confirmedCredits }) {
  const body = { provider, confirmed_credits: confirmedCredits }

  if (USE_MOCKS) return mockEnrich(leadId, body)

  try {
    return await apiClient(`/leads/${encodeURIComponent(leadId)}/enrich`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  } catch (err) {
    if (err?.code === 'NETWORK_ERROR') return mockEnrich(leadId, body)
    throw err
  }
}

/**
 * Enrich several leads, one after the other (the backend endpoint is per lead).
 * If the backend says the budget is exceeded (HTTP 422) we STOP, so we never
 * keep hammering a provider after the limit is hit.
 *
 * @param {Array<{leadId: string, provider: string}>} items
 * @param {{onProgress?: (done:number, total:number) => void}} [options]
 * @returns {Promise<Array<{leadId, provider, status, creditsUsed, error?}>>}
 *   status is 'enriched' | 'needs_research' | 'failed' | 'skipped'
 */
export async function enrichLeads(items, { onProgress } = {}) {
  const results = []
  let stopReason = null

  for (let i = 0; i < items.length; i += 1) {
    const { leadId, provider } = items[i]

    if (stopReason) {
      results.push({ leadId, provider, status: 'skipped', creditsUsed: 0, error: stopReason })
    } else {
      try {
        const res = await enrichLead(leadId, {
          provider,
          confirmedCredits: estimateCredits(provider),
        })
        const foundSomething = (res?.contact?.methods || []).length > 0
        results.push({
          leadId,
          provider,
          status: foundSomething ? 'enriched' : 'needs_research',
          creditsUsed: res?.credits_used ?? 0,
        })
      } catch (err) {
        results.push({
          leadId,
          provider,
          status: 'failed',
          creditsUsed: 0,
          error: err?.message || 'Enrichment failed',
        })
        if (err?.status === 422) stopReason = 'Skipped: credit budget exceeded'
      }
    }

    onProgress?.(i + 1, items.length)
  }

  return results
}
