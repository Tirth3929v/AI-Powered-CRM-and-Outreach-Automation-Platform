import React, { useEffect, useMemo } from 'react'
import { MOCK_LEADS } from '../../mocks/sampleLeads'

const displayValue = (value) => {
  return value !== null && value !== undefined && value !== ''
    ? String(value)
    : '—'
}

export default function LeadDetailDrawer({ lead: rawLead, isOpen, onClose }) {
  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const lead = useMemo(() => {
    if (!rawLead) return null
    if (typeof rawLead === 'object') return rawLead
    return MOCK_LEADS.find((item) => item.id === rawLead) || { id: rawLead, title: rawLead }
  }, [rawLead])

  const scoreBreakdown = useMemo(() => {
    if (!lead) return []
    if (Array.isArray(lead.score_breakdown) && lead.score_breakdown.length > 0) {
      return lead.score_breakdown
    }
    if (Array.isArray(lead.score_reasons) && lead.score_reasons.length > 0) {
      return lead.score_reasons
    }
    return []
  }, [lead])

  if (!isOpen || !lead) return null

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.4)',
          zIndex: 999
        }}
      />

      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: '500px',
          maxWidth: '100%',
          height: '100vh',
          overflowY: 'auto',
          backgroundColor: 'white',
          boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
          padding: '24px',
          zIndex: 1000
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px'
          }}
        >
          <h2>{displayValue(lead.title)}</h2>

          <button
            onClick={onClose}
            aria-label="Close drawer"
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: '22px'
            }}
          >
            ✕
          </button>
        </div>

        {/* Source Details */}
        <section style={{ marginBottom: '24px' }}>
          <h3>Source Information</h3>

          <p>
            <strong>Source Name:</strong>{' '}
            {displayValue(lead.source_name)}
          </p>

          <p>
            <strong>Publication Time:</strong>{' '}
            {lead?.published_at
              ? new Date(lead.published_at).toLocaleString()
              : '—'}
          </p>

          <p>
            <strong>Discovery Time:</strong>{' '}
            {lead?.discovered_at
              ? new Date(lead.discovered_at).toLocaleString()
              : '—'}
          </p>

          <p>
            <strong>Source URL:</strong>{' '}
            {lead.source_url ? (
              <a
                href={lead.source_url}
                target="_blank"
                rel="noreferrer"
              >
                Open Original Listing
              </a>
            ) : (
              '—'
            )}
          </p>
        </section>

        {/* Description */}
        <section style={{ marginBottom: '24px' }}>
          <h3>Opportunity Description</h3>

          <p>
            {displayValue(
              lead.description || lead.job_description
            )}
          </p>
        </section>

        {/* Contacts */}
        <section style={{ marginBottom: '24px' }}>
          <h3>Associated Contacts</h3>

          {lead.contacts?.length ? (
            lead.contacts.map((contact, index) => {
              const email = contact.email || contact.methods?.find((m) => m.kind === 'email')?.value
              const phone = contact.phone || contact.methods?.find((m) => m.kind === 'phone')?.value
              const isVerified = contact.verified || contact.methods?.some((m) => m.verified_status === 'verified')

              return (
                <div
                  key={index}
                  style={{
                    border: '1px solid #e5e7eb',
                    padding: '12px',
                    borderRadius: '8px',
                    marginBottom: '10px'
                  }}
                >
                  <p>
                    <strong>Name:</strong>{' '}
                    {displayValue(contact.name)}
                  </p>

                  <p>
                    <strong>Role:</strong>{' '}
                    {displayValue(contact.role || contact.role_title)}
                  </p>

                  <p>
                    <strong>Email:</strong>{' '}
                    {displayValue(email)}
                  </p>

                  <p>
                    <strong>Phone:</strong>{' '}
                    {displayValue(phone)}
                  </p>

                  <span
                    style={{
                      background: isVerified
                        ? '#dcfce7'
                        : '#f3f4f6',
                      padding: '4px 8px',
                      borderRadius: '12px',
                      fontSize: '12px'
                    }}
                  >
                    {isVerified ? 'Verified' : 'Unverified'}
                  </span>
                </div>
              )
            })
          ) : (
            <p>—</p>
          )}
        </section>

        {/* Score Breakdown */}
        <section style={{ marginBottom: '24px' }}>
          <h3>Score Breakdown</h3>

          {scoreBreakdown.length ? (
            scoreBreakdown.map((item, index) => {
              const factor = item.factor || item.name || 'Factor'
              const score = item.score ?? item.points ?? item.weight
              const reasonCode = item.reason_code || item.code
              const explanation = item.explanation || item.reason || item.message

              return (
                <div
                  key={index}
                  style={{
                    borderBottom: '1px solid #eee',
                    padding: '8px 0'
                  }}
                >
                  <p>
                    <strong>Factor:</strong>{' '}
                    {displayValue(factor)}
                  </p>

                  {score !== undefined && (
                    <p>
                      <strong>Score:</strong>{' '}
                      {displayValue(score)}
                    </p>
                  )}

                  {reasonCode && (
                    <p>
                      <strong>Reason Code:</strong>{' '}
                      {displayValue(reasonCode)}
                    </p>
                  )}

                  {explanation && (
                    <p>
                      <strong>Explanation:</strong>{' '}
                      {displayValue(explanation)}
                    </p>
                  )}
                </div>
              )
            })
          ) : (
            <p>—</p>
          )}
        </section>

        {/* Audit Log */}
        <section>
          <h3>Audit History</h3>

          <div
            style={{
              border: '1px dashed #cbd5e1',
              padding: '16px',
              borderRadius: '8px'
            }}
          >
            Immutable audit log history will appear here.
          </div>
        </section>
      </div>
    </>
  )
}
