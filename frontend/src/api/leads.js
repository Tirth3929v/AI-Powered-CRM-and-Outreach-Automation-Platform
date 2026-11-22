/**
 * Leads API client (FE-09).
 * Wraps GET /leads from contracts/openapi.yaml (operationId: listLeads).
 *
 * Query params sent to the server:
 *   page, page_size (max 100), sort_by, sort_order (asc | desc),
 *   plus optional filters: source, experience_min, experience_max,
 *   score_band, status, assigned_to, search.
 *
 * Response shape (PaginatedLeadsResponse):
 *   { items: LeadSummary[], total, page, page_size, total_pages }
 *
 * Mock mode: when VITE_USE_MOCKS=true (or the backend is unreachable) the same
 * contract is served from the MOCK_LEADS fixture, so the table can be built
 * and demoed fully offline.
 */
import { apiClient } from './client'
import { MOCK_LEADS } from '../mocks/sampleLeads'

export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 100
export const DEFAULT_SORT_BY = 'discovered_at'
export const DEFAULT_SORT_ORDER = 'desc'

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'

/* ----------------------------------------------------------------------------
 * Query string helpers
 * ------------------------------------------------------------------------- */

function clampPageSize(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE
  return Math.min(Math.floor(n), MAX_PAGE_SIZE)
}

function buildQueryString(params) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || value === 'all') return
    query.set(key, String(value))
  })
  return query.toString()
}

/* ----------------------------------------------------------------------------
 * Mock backend (mirrors the server contract: filter -> sort -> paginate)
 * ------------------------------------------------------------------------- */

function bandFor(score, originalBand) {
  if (originalBand === 'suppressed') return 'suppressed'
  if (score >= 80) return 'high'
  if (score >= 60) return 'medium'
  return 'low'
}

// The fixture only has a handful of rows, so repeat it (with unique ids,
// slightly different scores and dates) to give pagination something to page.
const MOCK_DATASET = Array.from({ length: 48 }, (_, i) => {
  const base = MOCK_LEADS[i % MOCK_LEADS.length]
  const round = Math.floor(i / MOCK_LEADS.length)
  if (round === 0) return base

  const score = Math.max(0, base.score - round * 4)
  const discovered = new Date(base.discovered_at)
  discovered.setDate(discovered.getDate() - round * 2)

  return {
    ...base,
    id: `${base.id}-r${round}`,
    organization_name: `${base.organization_name} ${round + 1}`,
    score,
    score_band: bandFor(score, base.score_band),
    discovered_at: discovered.toISOString(),
  }
})

function compareValues(a, b, order) {
  const aEmpty = a === null || a === undefined
  const bEmpty = b === null || b === undefined
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1 // empty values always sort last
  if (bEmpty) return -1

  const result =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), undefined, { sensitivity: 'base' })

  return order === 'asc' ? result : -result
}

function applyMockFilters(items, filters) {
  const search = (filters.search || '').trim().toLowerCase()
  const expMin = filters.experience_min !== undefined && filters.experience_min !== '' ? Number(filters.experience_min) : null
  const expMax = filters.experience_max !== undefined && filters.experience_max !== '' ? Number(filters.experience_max) : null

  return items.filter((lead) => {
    if (search && !`${lead.title} ${lead.organization_name}`.toLowerCase().includes(search)) return false
    if (filters.score_band && filters.score_band !== 'all' && lead.score_band !== filters.score_band) return false
    if (filters.status && lead.status !== filters.status) return false
    if (filters.source && lead.source_name !== filters.source) return false
    if (filters.assigned_to && lead.assigned_to !== filters.assigned_to) return false
    if (expMin !== null && (lead.experience_min ?? 0) < expMin) return false
    if (expMax !== null && (lead.experience_max ?? lead.experience_min ?? 0) > expMax) return false
    return true
  })
}

async function listMockLeads({ page, pageSize, sortBy, sortOrder, filters }) {
  // Small delay so loading states are visible while developing.
  await new Promise((resolve) => setTimeout(resolve, 250))

  const filtered = applyMockFilters(MOCK_DATASET, filters)
  const sorted = [...filtered].sort(
    (a, b) => compareValues(a[sortBy], b[sortBy], sortOrder) || a.id.localeCompare(b.id)
  )

  const total = sorted.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * pageSize

  return {
    items: sorted.slice(start, start + pageSize),
    total,
    page: safePage,
    page_size: pageSize,
    total_pages: totalPages,
  }
}

/* ----------------------------------------------------------------------------
 * Public API
 * ------------------------------------------------------------------------- */

/**
 * Fetch one page of leads.
 *
 * @param {Object}  params
 * @param {number}  [params.page=1]
 * @param {number}  [params.pageSize=25]   Clamped to 1..100.
 * @param {string}  [params.sortBy='discovered_at']
 * @param {'asc'|'desc'} [params.sortOrder='desc']
 * @param {Object}  [params.filters]       Optional: search, source, score_band,
 *                                         status, assigned_to, experience_min, experience_max.
 * @returns {Promise<{items: Array, total: number, page: number, page_size: number, total_pages: number}>}
 */
export async function listLeads({
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  sortBy = DEFAULT_SORT_BY,
  sortOrder = DEFAULT_SORT_ORDER,
  filters = {},
} = {}) {
  const safePageSize = clampPageSize(pageSize)
  const safePage = Math.max(1, Math.floor(Number(page)) || 1)
  const safeOrder = sortOrder === 'asc' ? 'asc' : 'desc'

  if (USE_MOCKS) {
    return listMockLeads({ page: safePage, pageSize: safePageSize, sortBy, sortOrder: safeOrder, filters })
  }

  const query = buildQueryString({
    page: safePage,
    page_size: safePageSize,
    sort_by: sortBy,
    sort_order: safeOrder,
    ...filters,
  })

  try {
    return await apiClient(`/leads?${query}`)
  } catch (err) {
    // Backend not reachable: keep the UI usable with the offline fixture.
    if (err?.code === 'NETWORK_ERROR') {
      console.warn('Backend unavailable, falling back to offline fixtures:', err)
      return listMockLeads({ page: safePage, pageSize: safePageSize, sortBy, sortOrder: safeOrder, filters })
    }
    throw err
  }
}

/**
 * Retrieve complete details for a specific lead (FE-11).
 *
 * @param {string} id
 * @returns {Promise<Object>}

/**
 * Retrieve complete details for a specific lead (FE-11).
 *
 * @param {string} id
 * @returns {Promise<Object>}
 */
export async function getLeadById(id) {
  if (USE_MOCKS) {
    const found = MOCK_DATASET.find((l) => l.id === id) || MOCK_LEADS.find((l) => l.id === id)
    if (!found) {
      throw new Error(`Lead '${id}' not found`)
    }
    return found
  }

  try {
    return await apiClient(`/leads/${id}`)
  } catch (err) {
    if (err?.code === 'NETWORK_ERROR') {
      const found = MOCK_DATASET.find((l) => l.id === id) || MOCK_LEADS.find((l) => l.id === id)
      if (found) return found
    }
    throw err
  }
}
