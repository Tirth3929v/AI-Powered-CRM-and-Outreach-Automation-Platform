/* @vitest-environment jsdom */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import ErrorCenterPage, { ErrorDetailPanel, ErrorTable } from './index'

const RECORDS = [
  {
    id: 'err_001', workflow: 'daily_discovery', job_id: 'job_a', correlation_id: 'corr_a',
    failed_step: 'fetch_listings', category: 'rate_limit', status: 'open', retry_count: 2,
    next_retry_at: '2026-11-21T14:30:00Z', owner: 'automation', replay_eligible: true,
    redacted_message: 'HTTP 429 Too Many Requests', payload_snapshot: { page: 7 },
    ai_suggestion: 'Increase the backoff window.',
  },
  {
    id: 'err_002', workflow: 'dispatch_send', job_id: 'job_b', correlation_id: 'corr_b',
    failed_step: 'provider_send', category: 'send_timeout', status: 'open', retry_count: 0,
    next_retry_at: null, owner: 'campaign_manager', replay_eligible: false,
    redacted_message: 'Socket timeout',
  },
  {
    id: 'err_003', workflow: 'draft_generation', job_id: 'job_c', correlation_id: 'corr_c',
    failed_step: 'fact_check', category: 'ai_output_invalid', status: 'resolved', retry_count: 1,
    next_retry_at: null, owner: 'ai', replay_eligible: true, redacted_message: 'Schema invalid',
  },
]

function panelError(overrides = {}) {
  return {
    id: 'err_x', workflow: 'wf', job_id: 'job_x', correlation_id: 'corr_x', failed_step: 'step',
    category: 'rate_limit', status: 'open', retry_count: 0, next_retry_at: null, owner: 'automation',
    replay_eligible: true, stack_trace: 'trace', payload_snapshot: { a: 1 }, ai_suggestion: 'hint',
    ...overrides,
  }
}

function renderPanel(error, props = {}) {
  return render(<ErrorDetailPanel error={error} isOpen onClose={() => {}} {...props} />)
}

function replayButton() {
  return screen.getByRole('button', { name: 'Replay Job' })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('FE-28 ErrorTable', () => {
  it('shows every required column', () => {
    render(<ErrorTable errors={[]} />)
    for (const header of [
      'Workflow', 'Job ID', 'Correlation ID', 'Failed Step',
      'Error Category', 'Retry Count', 'Next Retry At', 'Owner',
    ]) {
      expect(screen.getByText(header)).toBeTruthy()
    }
  })

  it('renders a row per error and a dash for a missing retry time', () => {
    const rows = RECORDS.map((r) => ({
      id: r.id, workflow: r.workflow, job_id: r.job_id, correlation_id: r.correlation_id,
      failed_step: r.failed_step, category: r.category, status: r.status,
      retry_count: r.retry_count, next_retry_at: r.next_retry_at, owner: r.owner,
    }))
    render(<ErrorTable errors={rows} />)
    expect(screen.getByText('job_a')).toBeTruthy()
    expect(screen.getByText('job_b')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})

describe('FE-28 ErrorDetailPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ErrorDetailPanel error={panelError()} isOpen={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows trace, payload, AI suggestion and a notes input', () => {
    renderPanel(panelError())
    expect(screen.getByText('Redacted stack trace')).toBeTruthy()
    expect(screen.getByText('trace')).toBeTruthy()
    expect(screen.getByText('Payload snapshot')).toBeTruthy()
    expect(screen.getByText('hint')).toBeTruthy()
    expect(screen.getByLabelText('Resolution notes')).toBeTruthy()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    renderPanel(panelError(), { onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('enables Replay for a replayable open error', () => {
    renderPanel(panelError())
    expect(replayButton().disabled).toBe(false)
  })

  it.each(['send_timeout', 'provider_rejection', 'permanent_provider_rejection'])(
    'disables Replay for %s',
    (category) => {
      renderPanel(panelError({ category }))
      expect(replayButton().disabled).toBe(true)
    }
  )

  it('disables Replay when the backend says replay_eligible is false', () => {
    renderPanel(panelError({ replay_eligible: false }))
    expect(replayButton().disabled).toBe(true)
  })

  it('disables Replay while retrying, when resolved, and for roles without permission', () => {
    renderPanel(panelError({ status: 'retrying' }))
    expect(replayButton().disabled).toBe(true)
    cleanup()
    renderPanel(panelError({ status: 'resolved' }))
    expect(replayButton().disabled).toBe(true)
    cleanup()
    renderPanel(panelError(), { canReplay: false })
    expect(replayButton().disabled).toBe(true)
  })

  it('saves the trimmed note and confirms it', () => {
    const onSaveNote = vi.fn()
    renderPanel(panelError(), { onSaveNote })
    fireEvent.change(screen.getByLabelText('Resolution notes'), { target: { value: '  Fixed backoff  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    expect(onSaveNote).toHaveBeenCalledWith('err_x', 'Fixed backoff')
    expect(screen.getByText('Note saved.')).toBeTruthy()
  })

  it('passes the error to onReplay when clicked', () => {
    const onReplay = vi.fn()
    const error = panelError()
    renderPanel(error, { onReplay })
    fireEvent.click(replayButton())
    expect(onReplay).toHaveBeenCalledWith(error)
  })
})

describe('FE-28 ErrorCenterPage', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options = {}) => {
        if (String(url).endsWith('/replay') && options.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ status: 'replay_queued' }) }
        }
        return { ok: true, status: 200, json: async () => RECORDS }
      })
    )
  })

  it('blocks roles that are not developer or admin', () => {
    render(<ErrorCenterPage currentUser={{ role: 'researcher' }} />)
    expect(screen.getByText('Error Center is restricted')).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('loads errors and filters by category and status', async () => {
    render(<ErrorCenterPage currentUser={{ role: 'developer' }} />)
    await screen.findByText('job_a')
    expect(screen.getByText('job_b')).toBeTruthy()
    expect(screen.getByText('job_c')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Filter by error category'), { target: { value: 'send_timeout' } })
    expect(screen.queryByText('job_a')).toBeNull()
    expect(screen.getByText('job_b')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'resolved' } })
    expect(screen.getByText('job_c')).toBeTruthy()
    expect(screen.queryByText('job_a')).toBeNull()
  })

  it('shows an empty state when nothing matches the filters', async () => {
    render(<ErrorCenterPage currentUser={{ role: 'admin' }} />)
    await screen.findByText('job_a')
    fireEvent.change(screen.getByLabelText('Filter by error category'), { target: { value: 'credit_exhaustion' } })
    expect(screen.getByText('No errors match these filters')).toBeTruthy()
  })

  it('opens the slide-over and replays an eligible job', async () => {
    render(<ErrorCenterPage currentUser={{ role: 'developer' }} />)
    await screen.findByText('job_a')
    fireEvent.click(screen.getByRole('button', { name: 'View details for job job_a' }))

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replay Job' }))

    await waitFor(() => expect(screen.getByText('Replay queued for job job_a.')).toBeTruthy())
    const call = fetch.mock.calls.find(([url]) => String(url).endsWith('/error_center/err_001/replay'))
    expect(call[1].method).toBe('POST')
  })

  it('keeps a saved note when the panel is reopened', async () => {
    render(<ErrorCenterPage currentUser={{ role: 'developer' }} />)
    await screen.findByText('job_a')
    fireEvent.click(screen.getByRole('button', { name: 'View details for job job_a' }))
    fireEvent.change(screen.getByLabelText('Resolution notes'), { target: { value: 'Check backoff' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close error details' }))
    fireEvent.click(screen.getByRole('button', { name: 'View details for job job_a' }))
    expect(screen.getByLabelText('Resolution notes').value).toBe('Check backoff')
  })

  it('keeps Replay disabled for a send timeout in the slide-over', async () => {
    render(<ErrorCenterPage currentUser={{ role: 'admin' }} />)
    await screen.findByText('job_b')
    fireEvent.click(screen.getByRole('button', { name: 'View details for job job_b' }))
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Replay Job' }).disabled).toBe(true)
  })
})