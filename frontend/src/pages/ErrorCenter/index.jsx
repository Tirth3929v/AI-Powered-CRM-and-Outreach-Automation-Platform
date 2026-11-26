import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Table } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Input'
import { Spinner, EmptyState, ErrorBanner } from '../../components/feedback/Spinner'
import { apiClient } from '../../api/client'
import { can } from '../../utils/roles'

/**
 * Automation Error Center page (FE-28).
 *
 * Lists failures reported by n8n workflows and scraper workers so an engineer
 * can inspect them and replay the ones that are safe to retry.
 *
 *   GET  /error_center              -> list of error records (admin, developer)
 *   POST /error_center/{id}/replay  -> queue a retry; 409 if not replayable
 *
 * Notes for reviewers:
 *  - /error_center is not in contracts/openapi.yaml yet (contract change request pending).
 *  - The API has no endpoint for resolution notes, so notes live in the page
 *    state for the current session only.
 *  - The browser only ever shows the redacted fields the backend returns.
 *  - Mock mode: VITE_USE_MOCKS=true, or the backend being unreachable, serves
 *    the sample records below so the page can be built and demoed offline.
 */

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'

/* ----------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------- */

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'retrying', label: 'Retrying' },
  { value: 'resolved', label: 'Resolved' },
]

// Categories from docs/error-playbook.md plus the name the backend uses for rejections.
const KNOWN_CATEGORIES = [
  'temporary_network',
  'rate_limit',
  'invalid_input',
  'expired_credential',
  'credit_exhaustion',
  'source_layout_changed',
  'ai_output_invalid',
  'send_timeout',
  'provider_rejection',
  'permanent_provider_rejection',
]

// Dispatch failures: never replay without reconciling with the provider first.
const SEND_CATEGORIES = new Set(['send_timeout', 'provider_rejection', 'permanent_provider_rejection'])

// Marked "Replay Eligible: No" in the playbook (the send categories above are included).
const NON_REPLAYABLE_CATEGORIES = new Set([...SEND_CATEGORIES, 'invalid_input', 'source_layout_changed'])

const TABLE_HEADERS = [
  'Workflow',
  'Job ID',
  'Correlation ID',
  'Failed Step',
  'Error Category',
  'Retry Count',
  'Next Retry At',
  'Owner',
  'Status',
  'Details',
]

const PAGE_CSS = `
.ec-row { border-bottom: 1px solid var(--color-border); }
.ec-row:last-child { border-bottom: none; }
.ec-row:hover { background: var(--color-bg-subtle); }
.ec-row[data-selected="true"] { background: var(--color-primary-light); }
.ec-td { padding: 12px 16px; vertical-align: middle; white-space: nowrap; }
.ec-mono { font-family: var(--font-mono); font-size: 12px; }
.ec-pre {
  margin: 0; padding: 12px; max-height: 220px; overflow: auto;
  white-space: pre-wrap; word-break: break-word;
  font-family: var(--font-mono); font-size: 12px; line-height: 1.5;
  background: var(--color-bg-subtle); border: 1px solid var(--color-border);
  border-radius: var(--radius-md); color: var(--color-text-main);
}
.ec-notes {
  width: 100%; min-height: 88px; padding: 8px 12px; resize: vertical;
  font: inherit; font-size: 14px; color: var(--color-text-main);
  background: var(--color-bg-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
`

/* ----------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function display(value) {
  return value !== null && value !== undefined && value !== '' ? String(value) : '—'
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function categoryLabel(category) {
  if (!category) return '—'
  const text = String(category).replace(/_/g, ' ').replace(/\bai\b/gi, 'AI')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function statusVariant(status) {
  if (status === 'resolved') return 'success'
  if (status === 'retrying') return 'info'
  return 'warning'
}

/** Returns why Replay must be disabled, or null when replaying is allowed. */
function replayBlockReason(error, canReplay) {
  if (!canReplay) return 'Your role is not allowed to replay jobs.'
  if (SEND_CATEGORIES.has(error.category)) {
    return 'Send errors are never replayed automatically. Check the message status with the provider first.'
  }
  if (NON_REPLAYABLE_CATEGORIES.has(error.category) || error.replay_eligible === false) {
    return 'This error cannot be replayed automatically. Fix the cause first.'
  }
  if (error.status === 'retrying') return 'A replay is already in progress for this job.'
  if (error.status === 'resolved') return 'This error is already resolved.'
  return null
}

const NOTES_STORAGE_KEY = 'error_center_notes'

// The API cannot store resolution notes yet, so they are kept for the browser session.
function readStoredNotes() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(NOTES_STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStoredNotes(notes) {
  try {
    sessionStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes))
  } catch {
    // Storage can be unavailable (private mode); the note then lasts until the page reloads.
  }
}

/** Accepts the backend record shape and tolerates missing optional fields. */
function normalizeError(raw) {
  const retryCount = Number(raw.retry_count)
  return {
    id: String(raw.id),
    workflow: raw.workflow ?? raw.workflow_name ?? null,
    job_id: raw.job_id ?? null,
    correlation_id: raw.correlation_id ?? null,
    failed_step: raw.failed_step ?? null,
    category: raw.category ?? null,
    status: raw.status || 'open',
    retry_count: Number.isFinite(retryCount) ? retryCount : 0,
    next_retry_at: raw.next_retry_at ?? null,
    owner: raw.owner ?? null,
    replay_eligible: raw.replay_eligible,
    stack_trace: raw.redacted_stack_trace ?? raw.redacted_message ?? null,
    payload_snapshot: raw.payload_snapshot ?? null,
    ai_suggestion: raw.ai_suggestion ?? null,
  }
}

/* ----------------------------------------------------------------------------
 * Mock data (offline mode)
 * ------------------------------------------------------------------------- */

const MOCK_ERRORS = [
  {
    id: 'err_001', workflow: 'daily_discovery', job_id: 'job_sample_01',
    correlation_id: 'corr_c8f2b730-811c', failed_step: 'fetch_naukri_listings',
    category: 'rate_limit', status: 'open', retry_count: 2,
    next_retry_at: '2026-11-21T14:30:00Z', owner: 'automation', replay_eligible: true,
    redacted_message: 'HTTP 429 Too Many Requests received from target source\n  at fetchListings (scraper/naukri.py:88)\n  at run_batch (scraper/runner.py:41)',
    payload_snapshot: { source_id: 'naukri', batch_id: 'batch_20261120_090000', page: 7 },
    ai_suggestion: 'The source is rate limiting requests. Increase the backoff window or reduce concurrency.',
  },
  {
    id: 'err_002', workflow: 'enrichment_batch', job_id: 'job_sample_02',
    correlation_id: 'corr_41ab9e02-77d3', failed_step: 'contactout_lookup',
    category: 'temporary_network', status: 'retrying', retry_count: 1,
    next_retry_at: '2026-11-20T18:05:00Z', owner: 'automation', replay_eligible: true,
    redacted_message: 'ConnectionResetError: connection reset by peer\n  at lookup (enrichment/contactout.py:52)',
    payload_snapshot: { lead_id: 'lead_1042', provider: 'contactout' },
    ai_suggestion: 'Transient network failure. The bounded retry should recover without changes.',
  },
  {
    id: 'err_003', workflow: 'dispatch_send', job_id: 'job_sample_03',
    correlation_id: 'corr_9d7712ce-30aa', failed_step: 'provider_send',
    category: 'send_timeout', status: 'open', retry_count: 0,
    next_retry_at: null, owner: 'campaign_manager', replay_eligible: false,
    redacted_message: 'Socket timeout after 30s while sending to provider\n  at send (dispatch/resend_client.py:67)',
    payload_snapshot: { approval_id: 'appr_204', recipient: 'j***@example.com' },
    ai_suggestion: 'The provider may have accepted the message. Reconcile its status before any retry.',
  },
  {
    id: 'err_004', workflow: 'dispatch_send', job_id: 'job_sample_04',
    correlation_id: 'corr_ee51d0b8-5c19', failed_step: 'provider_send',
    category: 'permanent_provider_rejection', status: 'open', retry_count: 0,
    next_retry_at: null, owner: 'campaign_manager', replay_eligible: false,
    redacted_message: 'Provider rejected recipient: hard bounce (invalid address)',
    payload_snapshot: { approval_id: 'appr_207', recipient: 'r***@example.com' },
    ai_suggestion: null,
  },
  {
    id: 'err_005', workflow: 'daily_discovery', job_id: 'job_sample_05',
    correlation_id: 'corr_a05c3f17-2b64', failed_step: 'parse_internshala_listing',
    category: 'source_layout_changed', status: 'open', retry_count: 0,
    next_retry_at: null, owner: 'developer', replay_eligible: false,
    redacted_message: 'Selector .internship_meta .company_name matched 0 elements',
    payload_snapshot: { source_id: 'internshala', url: 'https://internshala.com/internships' },
    ai_suggestion: 'The page layout changed. Update the company name selector.',
  },
  {
    id: 'err_006', workflow: 'draft_generation', job_id: 'job_sample_06',
    correlation_id: 'corr_6b2e8d94-f0a1', failed_step: 'fact_check_draft',
    category: 'ai_output_invalid', status: 'resolved', retry_count: 1,
    next_retry_at: null, owner: 'ai', replay_eligible: true,
    redacted_message: 'Draft failed schema validation: missing field "subject"',
    payload_snapshot: { lead_id: 'lead_0988', prompt_version: 'v3' },
    ai_suggestion: 'The model skipped the subject line. The retry prompt fixed it.',
  },
]

const mockStore = MOCK_ERRORS.map((item) => ({ ...item }))

async function mockList() {
  await sleep(300)
  return mockStore.map((item) => ({ ...item }))
}

async function mockReplay(id) {
  await sleep(300)
  const record = mockStore.find((item) => item.id === id)
  if (!record) throw { status: 404, code: 'NOT_FOUND', message: 'Error record not found' }
  if (replayBlockReason(normalizeError(record), true)) {
    throw {
      status: 409,
      code: 'NOT_REPLAYABLE',
      message: 'This error category is not eligible for automated replay. Manual reconciliation required.',
    }
  }
  record.status = 'retrying'
  return { status: 'replay_queued', error_id: id }
}

/* ----------------------------------------------------------------------------
 * API calls (always through our own backend)
 * ------------------------------------------------------------------------- */

async function fetchErrors() {
  if (USE_MOCKS) {
    return { items: (await mockList()).map(normalizeError), usedMock: true }
  }
  try {
    const data = await apiClient('/error_center')
    const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
    return { items: list.map(normalizeError), usedMock: false }
  } catch (err) {
    if (err?.status === 0) {
      return { items: (await mockList()).map(normalizeError), usedMock: true }
    }
    throw err
  }
}

async function replayJob(id, usedMock) {
  if (usedMock) return mockReplay(id)
  return apiClient(`/error_center/${encodeURIComponent(id)}/replay`, { method: 'POST' })
}

/* ----------------------------------------------------------------------------
 * Table
 * ------------------------------------------------------------------------- */

export function ErrorTable({ errors = [], selectedId = null, onSelect = () => {} }) {
  return (
    <Table headers={TABLE_HEADERS}>
      {errors.map((error) => (
        <tr key={error.id} className="ec-row" data-selected={error.id === selectedId}>
          <td className="ec-td">{display(error.workflow)}</td>
          <td className="ec-td ec-mono">{display(error.job_id)}</td>
          <td className="ec-td ec-mono">{display(error.correlation_id)}</td>
          <td className="ec-td">{display(error.failed_step)}</td>
          <td className="ec-td">
            <Badge variant="neutral">{categoryLabel(error.category)}</Badge>
          </td>
          <td className="ec-td">{error.retry_count}</td>
          <td className="ec-td">{formatDateTime(error.next_retry_at)}</td>
          <td className="ec-td">{display(error.owner)}</td>
          <td className="ec-td">
            <Badge variant={statusVariant(error.status)}>{categoryLabel(error.status)}</Badge>
          </td>
          <td className="ec-td">
            <Button
              variant="secondary"
              style={{ padding: '4px 12px', fontSize: '13px' }}
              aria-label={`View details for job ${display(error.job_id)}`}
              onClick={() => onSelect(error.id)}
            >
              View
            </Button>
          </td>
        </tr>
      ))}
    </Table>
  )
}

/* ----------------------------------------------------------------------------
 * Slide-over detail panel
 * ------------------------------------------------------------------------- */

function DetailRow({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: '12px', padding: '6px 0', fontSize: '14px' }}>
      <dt style={{ width: '130px', flexShrink: 0, color: 'var(--color-text-muted)' }}>{label}</dt>
      <dd style={{ margin: 0, wordBreak: 'break-word' }}>{children}</dd>
    </div>
  )
}

function PanelSection({ title, children }) {
  return (
    <section style={{ marginTop: '24px' }}>
      <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>{title}</h3>
      {children}
    </section>
  )
}

export function ErrorDetailPanel({
  error = null,
  isOpen = false,
  onClose = () => {},
  onReplay = () => {},
  isReplaying = false,
  canReplay = true,
  feedback = null,
  savedNote = '',
  onSaveNote = () => {},
}) {
  const panelRef = useRef(null)
  const [draft, setDraft] = useState(savedNote)
  const [noteSaved, setNoteSaved] = useState(false)
  const errorId = error?.id

  useEffect(() => {
    setDraft(savedNote)
  }, [errorId, savedNote])

  useEffect(() => {
    setNoteSaved(false)
  }, [errorId])

  useEffect(() => {
    if (!isOpen) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    if (panelRef.current) panelRef.current.focus()
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || !error) return null

  const blockReason = replayBlockReason(error, canReplay)
  const payloadText = error.payload_snapshot ? JSON.stringify(error.payload_snapshot, null, 2) : '—'

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.4)', zIndex: 999 }}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ec-panel-title"
        tabIndex={-1}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: '520px',
          maxWidth: '100%',
          height: '100vh',
          overflowY: 'auto',
          backgroundColor: 'var(--color-bg-surface)',
          boxShadow: 'var(--shadow-lg)',
          padding: '24px',
          zIndex: 1000,
          outline: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <h2 id="ec-panel-title" style={{ fontSize: '18px', fontWeight: 600 }}>
              {display(error.workflow)}
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
              Failed at {display(error.failed_step)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close error details"
            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '22px', color: 'var(--color-text-muted)' }}
          >
            ✕
          </button>
        </div>

        <dl style={{ margin: '16px 0 0' }}>
          <DetailRow label="Job ID"><span className="ec-mono">{display(error.job_id)}</span></DetailRow>
          <DetailRow label="Correlation ID"><span className="ec-mono">{display(error.correlation_id)}</span></DetailRow>
          <DetailRow label="Category">{categoryLabel(error.category)}</DetailRow>
          <DetailRow label="Status">
            <Badge variant={statusVariant(error.status)}>{categoryLabel(error.status)}</Badge>
          </DetailRow>
          <DetailRow label="Retry count">{error.retry_count}</DetailRow>
          <DetailRow label="Next retry at">{formatDateTime(error.next_retry_at)}</DetailRow>
          <DetailRow label="Owner">{display(error.owner)}</DetailRow>
        </dl>

        <PanelSection title="Redacted stack trace">
          <pre className="ec-pre">{display(error.stack_trace)}</pre>
        </PanelSection>

        <PanelSection title="Payload snapshot">
          <pre className="ec-pre">{payloadText}</pre>
        </PanelSection>

        <PanelSection title="AI-suggested root cause">
          <p style={{ fontSize: '14px', lineHeight: 1.5 }}>
            {error.ai_suggestion || 'No AI suggestion is available for this error yet.'}
          </p>
        </PanelSection>

        <PanelSection title="Resolution notes">
          <textarea
            className="ec-notes"
            aria-label="Resolution notes"
            placeholder="What was the cause and how was it fixed?"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              setNoteSaved(false)
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginTop: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
              Notes are kept in this browser session until the API supports saving them.
            </span>
            <Button
              variant="secondary"
              onClick={() => {
                onSaveNote(error.id, draft.trim())
                setNoteSaved(true)
              }}
            >
              Save note
            </Button>
          </div>
          {noteSaved && (
            <p role="status" style={{ marginTop: '8px', fontSize: '13px', color: 'var(--color-score-high)' }}>
              Note saved.
            </p>
          )}
        </PanelSection>

        <PanelSection title="Replay">
          {feedback && (
            <div
              role={feedback.type === 'error' ? 'alert' : 'status'}
              style={{
                marginBottom: '12px',
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                fontSize: '13px',
                backgroundColor: feedback.type === 'error' ? 'var(--color-score-low-bg)' : 'var(--color-score-high-bg)',
                color: feedback.type === 'error' ? 'var(--color-score-low)' : 'var(--color-score-high)',
              }}
            >
              {feedback.message}
            </div>
          )}
          <Button
            disabled={Boolean(blockReason)}
            isLoading={isReplaying}
            title={blockReason || 'Queue this job for another attempt'}
            onClick={() => onReplay(error)}
          >
            Replay Job
          </Button>
          {blockReason && (
            <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '8px' }}>{blockReason}</p>
          )}
        </PanelSection>
      </aside>
    </>
  )
}

/* ----------------------------------------------------------------------------
 * Page
 * ------------------------------------------------------------------------- */

export default function ErrorCenterPage({ currentUser }) {
  const role = currentUser?.role
  const allowed = can(role, 'view_error_center')
  const canReplay = can(role, 'replay_errors')

  const [errors, setErrors] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [usingMock, setUsingMock] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [replayingId, setReplayingId] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [notes, setNotes] = useState(readStoredNotes)
  const usingMockRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const result = await fetchErrors()
      usingMockRef.current = result.usedMock
      setUsingMock(result.usedMock)
      setErrors(result.items)
    } catch (err) {
      setLoadError(err?.message || 'Could not load the error list.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (allowed) load()
    else setLoading(false)
  }, [allowed, load])

  const categoryOptions = useMemo(() => {
    const extra = errors.map((e) => e.category).filter((c) => c && !KNOWN_CATEGORIES.includes(c))
    const all = [...KNOWN_CATEGORIES, ...new Set(extra)]
    return [{ value: 'all', label: 'All categories' }, ...all.map((c) => ({ value: c, label: categoryLabel(c) }))]
  }, [errors])

  const filtered = useMemo(
    () =>
      errors.filter(
        (e) =>
          (categoryFilter === 'all' || e.category === categoryFilter) &&
          (statusFilter === 'all' || e.status === statusFilter)
      ),
    [errors, categoryFilter, statusFilter]
  )

  const selectedError = useMemo(() => errors.find((e) => e.id === selectedId) || null, [errors, selectedId])
  const filtersActive = categoryFilter !== 'all' || statusFilter !== 'all'

  const openError = useCallback((id) => {
    setFeedback(null)
    setSelectedId(id)
  }, [])

  const closePanel = useCallback(() => setSelectedId(null), [])

  const handleReplay = useCallback(async (error) => {
    setReplayingId(error.id)
    setFeedback(null)
    try {
      await replayJob(error.id, usingMockRef.current)
      setErrors((prev) => prev.map((e) => (e.id === error.id ? { ...e, status: 'retrying' } : e)))
      setFeedback({ type: 'success', message: `Replay queued for job ${display(error.job_id)}.` })
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'The replay could not be queued.' })
    } finally {
      setReplayingId(null)
    }
  }, [])

  const handleSaveNote = useCallback((id, text) => {
    setNotes((prev) => {
      const next = { ...prev, [id]: text }
      writeStoredNotes(next)
      return next
    })
  }, [])

  if (!allowed) {
    return (
      <div style={{ padding: '32px' }}>
        <EmptyState
          title="Error Center is restricted"
          message="Only developer and admin roles can view automation errors."
        />
      </div>
    )
  }

  return (
    <div style={{ padding: '32px' }}>
      <style>{PAGE_CSS}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600 }}>Automation Error Center</h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            Inspect failed workflows, review suggested root causes, and replay jobs that are safe to retry.
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      {usingMock && (
        <div
          role="status"
          style={{
            marginBottom: '16px',
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: '13px',
            backgroundColor: 'var(--color-primary-light)',
            color: 'var(--color-primary)',
          }}
        >
          Showing sample data because mock mode is on or the backend could not be reached.
        </div>
      )}

      {loadError && <ErrorBanner message={loadError} onRetry={load} />}

      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={{ minWidth: '220px' }}>
          <Select
            label="Error category"
            aria-label="Filter by error category"
            value={categoryFilter}
            options={categoryOptions}
            onChange={(event) => setCategoryFilter(event.target.value)}
          />
        </div>
        <div style={{ minWidth: '180px' }}>
          <Select
            label="Status"
            aria-label="Filter by status"
            value={statusFilter}
            options={STATUS_OPTIONS}
            onChange={(event) => setStatusFilter(event.target.value)}
          />
        </div>
        {filtersActive && (
          <Button
            variant="secondary"
            onClick={() => {
              setCategoryFilter('all')
              setStatusFilter('all')
            }}
          >
            Clear filters
          </Button>
        )}
        {!loading && (
          <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', paddingBottom: '10px' }}>
            Showing {filtered.length} of {errors.length} errors
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
          <Spinner size={32} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={filtersActive ? 'No errors match these filters' : 'No automation errors'}
          message={
            filtersActive
              ? 'Try a different category or status.'
              : 'Workflows and scrapers have not reported any failures.'
          }
        />
      ) : (
        <ErrorTable errors={filtered} selectedId={selectedId} onSelect={openError} />
      )}

      <ErrorDetailPanel
        error={selectedError}
        isOpen={Boolean(selectedError)}
        onClose={closePanel}
        onReplay={handleReplay}
        isReplaying={replayingId === selectedError?.id}
        canReplay={canReplay}
        feedback={feedback}
        savedNote={notes[selectedError?.id] || ''}
        onSaveNote={handleSaveNote}
      />
    </div>
  )
}