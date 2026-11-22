import React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'
import EnrichConfirmModal from './EnrichConfirmModal'

const CONFIRM_LABEL = 'Confirm &amp; Deduct Credits'
const CONFIRM_BUTTON = new RegExp(`<button([^>]*)>${CONFIRM_LABEL}</button>`)

function render(props = {}) {
  // React inserts <!-- --> markers between adjacent text nodes; strip them for stable assertions.
  return renderToString(
    <EnrichConfirmModal
      isOpen
      provider="ContactOut"
      selectedCount={10}
      estimatedCredits={10}
      remainingDailyCredits={50}
      remainingMonthlyCredits={500}
      {...props}
    />
  ).replace(/<!-- -->/g, '')
}

function confirmButtonAttrs(html) {
  const match = html.match(CONFIRM_BUTTON)
  expect(match).not.toBeNull()
  return match[1]
}

describe('FE-17 EnrichConfirmModal with Credit Guard', () => {
  describe('Displayed information', () => {
    it('renders nothing when closed', () => {
      expect(render({ isOpen: false })).toBe('')
    })

    it('shows provider, record count, estimated cost and both remaining budgets', () => {
      const html = render()
      expect(html).toContain('role="dialog"')
      expect(html).toContain('ContactOut')
      expect(html).toContain('Records selected')
      expect(html).toContain('>10<')
      expect(html).toContain('10 credits')
      expect(html).toContain('Daily credits remaining')
      expect(html).toContain('50 credits')
      expect(html).toContain('Monthly credits remaining')
      expect(html).toContain('500 credits')
    })

    it('supports the Snov.io provider', () => {
      const html = render({ provider: 'Snov.io' })
      expect(html).toContain('Snov.io')
      expect(confirmButtonAttrs(html)).not.toContain('disabled')
    })

    it('uses selectedRecords array length over selectedCount', () => {
      const html = render({ selectedRecords: [{ id: 1 }, { id: 2 }, { id: 3 }], selectedCount: 99 })
      expect(html).toContain('>3<')
      expect(html).not.toContain('>99<')
    })

    it('renders the explicit Confirm & Deduct Credits and Cancel buttons', () => {
      const html = render()
      expect(html).toContain(CONFIRM_LABEL)
      expect(html).toContain('Cancel')
    })
  })

  describe('Credit guard', () => {
    it('enables Confirm when cost is within both budgets', () => {
      const html = render()
      expect(confirmButtonAttrs(html)).not.toContain('disabled')
      expect(html).not.toContain('role="alert"')
    })

    it('enables Confirm when cost exactly equals the remaining budget', () => {
      const html = render({ estimatedCredits: 50, remainingDailyCredits: 50, remainingMonthlyCredits: 50 })
      expect(confirmButtonAttrs(html)).not.toContain('disabled')
    })

    it('disables Confirm and explains why when cost exceeds the daily budget', () => {
      const html = render({ estimatedCredits: 60, remainingDailyCredits: 50 })
      expect(confirmButtonAttrs(html)).toContain('disabled')
      expect(html).toContain('role="alert"')
      expect(html).toContain('Cannot confirm enrichment.')
      expect(html).toContain('only 50 daily credits remain')
    })

    it('disables Confirm and explains why when cost exceeds the monthly budget', () => {
      const html = render({ estimatedCredits: 60, remainingDailyCredits: 100, remainingMonthlyCredits: 40 })
      expect(confirmButtonAttrs(html)).toContain('disabled')
      expect(html).toContain('only 40 monthly credits remain')
    })

    it('disables Confirm when no records are selected', () => {
      const html = render({ selectedCount: 0, estimatedCredits: 0 })
      expect(confirmButtonAttrs(html)).toContain('disabled')
      expect(html).toContain('Select at least one record')
    })

    it('disables Confirm when the provider is unsupported', () => {
      const html = render({ provider: 'UnknownProvider' })
      expect(confirmButtonAttrs(html)).toContain('disabled')
      expect(html).toContain('Choose a supported provider')
    })
  })

  describe('No accidental API calls', () => {
    it('never invokes onConfirm or onClose while rendering', () => {
      const onConfirm = vi.fn()
      const onClose = vi.fn()
      render({ onConfirm, onClose })
      render({ onConfirm, onClose, estimatedCredits: 999 })
      expect(onConfirm).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})
