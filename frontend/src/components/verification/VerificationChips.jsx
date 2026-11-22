import React, { useState } from 'react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { apiClient } from '../../api/client'
const STATUS_CONFIG = {
  deliverable: {
    label: 'Deliverable',
    variant: 'success',
  },
  undeliverable: {
    label: 'Undeliverable',
    variant: 'danger',
  },
  catch_all: {
    label: 'Catch-All',
    backgroundColor: '#fef3c7',
    color: '#92400e',
  },
  risky: {
    label: 'Risky',
    backgroundColor: '#ffedd5',
    color: '#9a3412',
  },
  unknown: {
    label: 'Unknown',
    variant: 'neutral',
  },
  verification_failed: {
    label: 'Verification Failed',
    variant: 'neutral',
  },
}
function formatVerifiedTime(timestamp) {
  if (!timestamp) return null

  const diffMs = Date.now() - new Date(timestamp).getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))

  if (diffMinutes < 1) return 'Verified just now'
  if (diffMinutes < 60) {
    return `Verified ${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`
  }

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return `Verified ${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  }

  const diffDays = Math.floor(diffHours / 24)
  return `Verified ${diffDays} day${diffDays === 1 ? '' : 's'} ago`
}
export function VerificationChips({ leadId, leadIds = [], onVerified }) {
  const [isVerifying, setIsVerifying] = useState(false)
  const [verification, setVerification] = useState(null)
  const handleVerify = async () => {
    const ids = leadIds.length > 0 ? leadIds : [leadId]

    setIsVerifying(true)

    try {
      const results = await Promise.all(
        ids.map((id) =>
          apiClient(`/leads/${id}/verify`, {
            method: 'POST',
          })
        )
      )

      if (results.length === 1) {
        setVerification(results[0])
      }

      onVerified?.(results)
    } catch {
      setVerification({
        result: 'verification_failed',
        checked_at: new Date().toISOString(),
      })
    } finally {
      setIsVerifying(false)
    }
  }
  return (
    <div>
      <Button isLoading={isVerifying} onClick={handleVerify}>
        Verify Email
      </Button>

      {verification && (
        <div style={{ marginTop: '8px' }}>
          {STATUS_CONFIG[verification.result]?.backgroundColor ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
                fontSize: '12px',
                fontWeight: 500,
                backgroundColor:
                  STATUS_CONFIG[verification.result].backgroundColor,
                color: STATUS_CONFIG[verification.result].color,
              }}
            >
              {STATUS_CONFIG[verification.result].label}
            </span>
          ) : (
            <Badge
              variant={STATUS_CONFIG[verification.result]?.variant || 'neutral'}
            >
              {STATUS_CONFIG[verification.result]?.label ||
                'Verification Failed'}
            </Badge>
          )}

          {formatVerifiedTime(verification.checked_at) && (
            <div
              style={{
                marginTop: '4px',
                fontSize: '12px',
                color: 'var(--color-text-muted)',
              }}
            >
              {formatVerifiedTime(verification.checked_at)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
