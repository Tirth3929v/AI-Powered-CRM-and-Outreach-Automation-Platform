import React, { useMemo, useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'

const PROVIDERS = ['ContactOut', 'Snov.io']

function asNonNegativeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

function formatCredits(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
}

/**
 * FE-17: Explicit confirmation gate for a credit-governed enrichment run.
 *
 * This component intentionally does not make API calls itself. The parent may
 * start enrichment only from onConfirm, which is invoked after the user clicks
 * the enabled "Confirm & Deduct Credits" button. Closing with Escape, the X,
 * the backdrop, or Cancel only calls onClose.
 *
 * Props:
 * - isOpen: whether the modal is visible
 * - onClose: close/cancel callback (never starts enrichment)
 * - onConfirm: callback invoked only after an explicit valid confirmation click
 * - provider: 'ContactOut' or 'Snov.io'
 * - selectedRecords: selected lead array (optional)
 * - selectedCount: selected record count when an array is not provided
 * - estimatedCredits: estimated total credits for the selection
 * - remainingDailyCredits / remainingMonthlyCredits: remaining budgets
 */
export default function EnrichConfirmModal({
  isOpen = false,
  onClose = () => {},
  onConfirm = () => {},
  provider = 'ContactOut',
  selectedRecords,
  selectedCount,
  estimatedCredits = 0,
  remainingDailyCredits,
  remainingMonthlyCredits,
}) {
  const [isConfirming, setIsConfirming] = useState(false)

  const safeProvider = PROVIDERS.includes(provider) ? provider : null
  const recordCount = Array.isArray(selectedRecords)
    ? selectedRecords.length
    : Math.max(0, Math.floor(asNonNegativeNumber(selectedCount)))
  const cost = asNonNegativeNumber(estimatedCredits)
  const dailyRemaining = remainingDailyCredits == null
    ? null
    : asNonNegativeNumber(remainingDailyCredits)
  const monthlyRemaining = remainingMonthlyCredits == null
    ? null
    : asNonNegativeNumber(remainingMonthlyCredits)

  const budgetMessage = useMemo(() => {
    if (!safeProvider) return 'Choose a supported provider (ContactOut or Snov.io) before continuing.'
    if (recordCount < 1) return 'Select at least one record before confirming enrichment.'
    if (dailyRemaining !== null && cost > dailyRemaining) {
      return `This request needs ${formatCredits(cost)} credits, but only ${formatCredits(dailyRemaining)} daily credits remain.`
    }
    if (monthlyRemaining !== null && cost > monthlyRemaining) {
      return `This request needs ${formatCredits(cost)} credits, but only ${formatCredits(monthlyRemaining)} monthly credits remain.`
    }
    return ''
  }, [safeProvider, recordCount, dailyRemaining, monthlyRemaining, cost])

  const isBlocked = Boolean(budgetMessage)

  async function handleConfirm() {
    // Keep the guard inside the handler as well as on the disabled button.
    // This prevents accidental/programmatic activation from bypassing limits.
    if (isBlocked || isConfirming) return

    setIsConfirming(true)
    try {
      await onConfirm({
        provider: safeProvider,
        selectedRecords: Array.isArray(selectedRecords) ? selectedRecords : undefined,
        selectedCount: recordCount,
        estimatedCredits: cost,
        remainingDailyCredits: dailyRemaining,
        remainingMonthlyCredits: monthlyRemaining,
      })
    } finally {
      setIsConfirming(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Confirm contact enrichment">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>
          Review the provider, selected records, and credit usage before starting. No lookup starts until you confirm.
        </p>

        <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '12px 16px', margin: 0 }}>
          <dt style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>Provider</dt>
          <dd style={{ margin: 0, fontWeight: 600, textAlign: 'right' }}>{safeProvider || 'Not selected'}</dd>

          <dt style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>Records selected</dt>
          <dd style={{ margin: 0, fontWeight: 600, textAlign: 'right' }}>{formatCredits(recordCount)}</dd>

          <dt style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>Estimated credit cost</dt>
          <dd style={{ margin: 0, fontWeight: 700, textAlign: 'right' }}>{formatCredits(cost)} credits</dd>

          <dt style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>Daily credits remaining</dt>
          <dd style={{ margin: 0, fontWeight: 600, textAlign: 'right' }}>
            {dailyRemaining === null ? 'Not provided' : `${formatCredits(dailyRemaining)} credits`}
          </dd>

          <dt style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>Monthly credits remaining</dt>
          <dd style={{ margin: 0, fontWeight: 600, textAlign: 'right' }}>
            {monthlyRemaining === null ? 'Not provided' : `${formatCredits(monthlyRemaining)} credits`}
          </dd>
        </dl>

        {isBlocked && (
          <div
            role="alert"
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-md, 8px)',
              border: '1px solid var(--color-danger, #dc2626)',
              background: 'var(--color-score-low-bg, #fee2e2)',
              color: 'var(--color-score-low, #b91c1c)',
              fontSize: '13px',
            }}
          >
            <strong>Cannot confirm enrichment.</strong>
            <div style={{ marginTop: '4px' }}>{budgetMessage}</div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={onClose} disabled={isConfirming}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isBlocked || isConfirming} isLoading={isConfirming}>
            Confirm &amp; Deduct Credits
          </Button>
        </div>
      </div>
    </Modal>
  )
}
