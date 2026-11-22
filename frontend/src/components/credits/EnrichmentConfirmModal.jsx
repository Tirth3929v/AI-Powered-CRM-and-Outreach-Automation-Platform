import React, { useEffect, useId, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'

const PROVIDER_NAMES = {
  contactout: 'ContactOut',
  snov: 'Snov.io',
}

/**
 * FE-17: explicit confirmation for credit-consuming enrichment.
 * This component does not call an API; the parent owns the request in onConfirm.
 */
export function EnrichmentConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  provider,
  selectedRecords = [],
  selectedCount,
  estimatedCredits,
  remainingDailyCredits,
  remainingMonthlyCredits,
  isSubmitting = false,
}) {
  const confirmationId = useId()
  const [confirmed, setConfirmed] = useState(false)
  const providerName = PROVIDER_NAMES[provider] || provider || 'Selected provider'
  const recordCount = selectedCount ?? selectedRecords.length
  const estimate = Number(estimatedCredits)
  const dailyRemaining = Number(remainingDailyCredits)
  const monthlyRemaining = Number(remainingMonthlyCredits)
  const validNumbers = [estimate, dailyRemaining, monthlyRemaining].every(Number.isFinite)
  const validRequest = Object.hasOwn(PROVIDER_NAMES, provider) && Number.isInteger(recordCount) && recordCount > 0 && Number.isInteger(estimate) && estimate >= 1
  const overBudget = !validNumbers || !validRequest || estimate > dailyRemaining || estimate > monthlyRemaining
  const canConfirm = confirmed && !overBudget && !isSubmitting && typeof onConfirm === 'function'

  useEffect(() => {
    if (isOpen) setConfirmed(false)
  }, [isOpen, provider, recordCount, estimatedCredits])

  function handleConfirm() {
    if (!canConfirm) return
    onConfirm({
      provider,
      selectedRecords,
      selectedCount: recordCount,
      estimatedCredits: estimate,
      confirmedCredits: estimate,
    })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Confirm contact enrichment">
      <div style={{ display: 'grid', gap: '16px' }}>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>
          Review the estimated credit use before sending these contacts to the enrichment provider.
        </p>

        <dl style={{ display: 'grid', gap: '10px', margin: 0 }}>
          <SummaryRow label="Provider" value={providerName} />
          <SummaryRow label="Selected records" value={recordCount} />
          <SummaryRow label="Estimated credits" value={Number.isFinite(estimate) ? estimate : 'Unavailable'} />
        </dl>

        <section
          aria-label="Credit budget"
          style={{
            background: 'var(--color-bg-subtle)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px',
            display: 'grid',
            gap: '8px',
            fontSize: '13px',
          }}
        >
          <strong>Remaining credit budget</strong>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
            <span>Today</span><span>{formatCredits(dailyRemaining)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
            <span>This month</span><span>{formatCredits(monthlyRemaining)}</span>
          </div>
        </section>

        {overBudget && (
          <p role="alert" style={{ color: 'var(--color-danger)', fontSize: '13px' }}>
            {validNumbers
              ? 'This request exceeds the remaining daily or monthly credit budget.'
              : 'Credit estimate or remaining budget is unavailable. Enrichment cannot be confirmed.'}
          </p>
        )}

        <label htmlFor={confirmationId} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '14px' }}>
          <input
            id={confirmationId}
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            disabled={overBudget || isSubmitting}
            style={{ marginTop: '4px' }}
          />
          <span>I understand that this enrichment will use the estimated credits shown above.</span>
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '4px' }}>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm} isLoading={isSubmitting}>
            Confirm enrichment
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function SummaryRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '14px' }}>
      <dt style={{ color: 'var(--color-text-muted)' }}>{label}</dt>
      <dd style={{ margin: 0, fontWeight: 600, textAlign: 'right' }}>{value}</dd>
    </div>
  )
}

function formatCredits(value) {
  return Number.isFinite(value) ? `${value} credits` : 'Unavailable'
}


