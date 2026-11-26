import React, { useState, useMemo } from 'react'
import { Badge } from '../../components/ui/Badge'

/**
 * Approved portal sources according to system architecture
 * Default mock data used when offline or standalone
 */
const DEFAULT_SOURCES = [
  {
    id: 'internshala',
    name: 'Internshala',
    portalType: 'Internships & Fresher Jobs',
    lastRun: '10 mins ago',
    lastRunTimestamp: '2026-11-19T17:15:00Z',
    recordsExtracted: 142,
    failureRate: 0.8,
    status: 'healthy',
    details: 'Regular daily discovery cycle running normally.'
  },
  {
    id: 'naukri',
    name: 'Naukri Freshers',
    portalType: 'Fresher Portal',
    lastRun: '25 mins ago',
    lastRunTimestamp: '2026-11-19T17:00:00Z',
    recordsExtracted: 87,
    failureRate: 24.5,
    status: 'rate_limited',
    details: 'HTTP 429 received on page 4. Cooling down with backoff.'
  },
  {
    id: 'apna',
    name: 'Apna Jobs',
    portalType: 'Entry-Level Jobs',
    lastRun: '45 mins ago',
    lastRunTimestamp: '2026-11-19T16:40:00Z',
    recordsExtracted: 0,
    failureRate: 68.2,
    status: 'quarantined',
    details: 'DOM selector mismatch detected on listing container.'
  },
  {
    id: 'workindia',
    name: 'WorkIndia',
    portalType: 'Blue & Grey Collar Opportunities',
    lastRun: '1 hour ago',
    lastRunTimestamp: '2026-11-19T16:20:00Z',
    recordsExtracted: 64,
    failureRate: 1.2,
    status: 'healthy',
    details: 'Extraction completed with expected schema.'
  },
  {
    id: 'shine',
    name: 'Shine Freshers',
    portalType: 'Graduate Portals',
    lastRun: '2 hours ago',
    lastRunTimestamp: '2026-11-19T15:30:00Z',
    recordsExtracted: 53,
    failureRate: 3.1,
    status: 'healthy',
    details: 'Normal batch throughput.'
  },
  {
    id: 'hackathons',
    name: 'Devpost & Unstop',
    portalType: 'Hackathons & Challenges',
    lastRun: '3 hours ago',
    lastRunTimestamp: '2026-11-19T14:30:00Z',
    recordsExtracted: 29,
    failureRate: 0.0,
    status: 'healthy',
    details: 'All event payloads parsed cleanly.'
  },
  {
    id: 'college_tpo',
    name: 'College TPO Directories',
    portalType: 'Public Placement Portals',
    lastRun: '4 hours ago',
    lastRunTimestamp: '2026-11-19T13:30:00Z',
    recordsExtracted: 0,
    failureRate: 85.0,
    status: 'quarantined',
    details: 'Connection timeouts across 3 institution endpoints.'
  },
  {
    id: 'startups',
    name: 'Workatastartup & YC Portals',
    portalType: 'Startup Roles',
    lastRun: '30 mins ago',
    lastRunTimestamp: '2026-11-19T16:55:00Z',
    recordsExtracted: 38,
    failureRate: 1.5,
    status: 'healthy',
    details: 'API payload matched expected schema.'
  }
]

/**
 * Priority order for sorting:
 * Acceptance Criteria: Quarantined sources MUST be automatically highlighted and sorted to the top.
 */
const STATUS_PRIORITY = {
  quarantined: 1,
  rate_limited: 2,
  healthy: 3
}

export function SourceHealth({ sources = DEFAULT_SOURCES, onRefresh }) {
  const [filter, setFilter] = useState('all')

  // Auto-sort sources so Quarantined items are strictly at the top
  const sortedAndFilteredSources = useMemo(() => {
    let list = [...sources]

    if (filter !== 'all') {
      list = list.filter((s) => s.status === filter)
    }

    return list.sort((a, b) => {
      const priorityDiff = (STATUS_PRIORITY[a.status] || 99) - (STATUS_PRIORITY[b.status] || 99)
      if (priorityDiff !== 0) return priorityDiff
      return (b.failureRate || 0) - (a.failureRate || 0)
    })
  }, [sources, filter])

  const counts = useMemo(() => {
    return sources.reduce(
      (acc, s) => {
        acc.total += 1
        if (s.status === 'quarantined') acc.quarantined += 1
        else if (s.status === 'rate_limited') acc.rate_limited += 1
        else if (s.status === 'healthy') acc.healthy += 1
        return acc
      },
      { total: 0, healthy: 0, rate_limited: 0, quarantined: 0 }
    )
  }, [sources])

  const getBadgeVariant = (status) => {
    switch (status) {
      case 'healthy':
        return 'success'
      case 'rate_limited':
        return 'warning'
      case 'quarantined':
        return 'danger'
      default:
        return 'neutral'
    }
  }

  const getStatusLabel = (status) => {
    switch (status) {
      case 'healthy':
        return 'Healthy'
      case 'rate_limited':
        return 'Rate Limited'
      case 'quarantined':
        return 'Quarantined'
      default:
        return status
    }
  }

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Scoped styles for subtle elevation & micro-transitions */}
      <style>{`
        .sh-card {
          transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease;
          box-shadow: var(--shadow-sm);
        }
        .sh-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }
        .sh-tab-btn {
          transition: all 0.15s ease;
        }
        .sh-tab-btn:hover {
          opacity: 0.88;
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '12px',
          borderBottom: '1px solid var(--color-border)',
          paddingBottom: '16px'
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--color-text-main)' }}>
              Source Health Monitoring Panel
            </h2>
            <Badge variant="info">FE-29</Badge>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--color-text-muted)' }}>
            Real-time operational status, extraction throughput, and failure rates across approved portal scrapers.
          </p>
        </div>

        {onRefresh && (
          <button
            onClick={onRefresh}
            className="sh-tab-btn"
            style={{
              padding: '6px 14px',
              backgroundColor: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              fontSize: '13px',
              cursor: 'pointer',
              color: 'var(--color-text-main)',
              fontWeight: 500
            }}
          >
            Refresh
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <button
          onClick={() => setFilter('all')}
          className="sh-tab-btn"
          style={{
            border: '1px solid',
            borderColor: filter === 'all' ? 'var(--color-primary)' : 'var(--color-border)',
            backgroundColor: filter === 'all' ? 'var(--color-primary-light)' : 'var(--color-bg-surface)',
            color: filter === 'all' ? 'var(--color-primary)' : 'var(--color-text-main)',
            fontWeight: filter === 'all' ? 600 : 500,
            padding: '6px 14px',
            borderRadius: 'var(--radius-full)',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          All Sources ({counts.total})
        </button>

        <button
          onClick={() => setFilter('quarantined')}
          className="sh-tab-btn"
          style={{
            border: '1px solid',
            borderColor: filter === 'quarantined' ? 'var(--color-score-low)' : 'var(--color-border)',
            backgroundColor: filter === 'quarantined' ? 'var(--color-score-low-bg)' : 'var(--color-bg-surface)',
            color: filter === 'quarantined' ? 'var(--color-score-low)' : 'var(--color-text-main)',
            fontWeight: filter === 'quarantined' ? 600 : 500,
            padding: '6px 14px',
            borderRadius: 'var(--radius-full)',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          Quarantined ({counts.quarantined})
        </button>

        <button
          onClick={() => setFilter('rate_limited')}
          className="sh-tab-btn"
          style={{
            border: '1px solid',
            borderColor: filter === 'rate_limited' ? 'var(--color-score-medium)' : 'var(--color-border)',
            backgroundColor: filter === 'rate_limited' ? 'var(--color-score-medium-bg)' : 'var(--color-bg-surface)',
            color: filter === 'rate_limited' ? 'var(--color-score-medium)' : 'var(--color-text-main)',
            fontWeight: filter === 'rate_limited' ? 600 : 500,
            padding: '6px 14px',
            borderRadius: 'var(--radius-full)',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          Rate Limited ({counts.rate_limited})
        </button>

        <button
          onClick={() => setFilter('healthy')}
          className="sh-tab-btn"
          style={{
            border: '1px solid',
            borderColor: filter === 'healthy' ? 'var(--color-score-high)' : 'var(--color-border)',
            backgroundColor: filter === 'healthy' ? 'var(--color-score-high-bg)' : 'var(--color-bg-surface)',
            color: filter === 'healthy' ? 'var(--color-score-high)' : 'var(--color-text-main)',
            fontWeight: filter === 'healthy' ? 600 : 500,
            padding: '6px 14px',
            borderRadius: 'var(--radius-full)',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          Healthy ({counts.healthy})
        </button>
      </div>

      {/* Quarantined Notice */}
      {counts.quarantined > 0 && filter === 'all' && (
        <div
          style={{
            backgroundColor: 'var(--color-score-low-bg)',
            border: '1px solid var(--color-score-low)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 16px',
            fontSize: '13px',
            color: 'var(--color-score-low)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span style={{ fontWeight: 600 }}>Quarantine Notice:</span>
          <span>{counts.quarantined} scraper source(s) require attention and are prioritized at the top of the grid.</span>
        </div>
      )}

      {/* Grid of Sources with Modern Elevation */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
          gap: '18px'
        }}
      >
        {sortedAndFilteredSources.map((source) => {
          const isQuarantined = source.status === 'quarantined'
          const isRateLimited = source.status === 'rate_limited'

          return (
            <div
              key={source.id}
              className="sh-card"
              style={{
                backgroundColor: 'var(--color-bg-surface)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid',
                borderColor: isQuarantined
                  ? 'var(--color-score-low)'
                  : isRateLimited
                  ? 'var(--color-score-medium)'
                  : 'var(--color-border)',
                borderTop: isQuarantined
                  ? '3px solid var(--color-score-low)'
                  : isRateLimited
                  ? '3px solid var(--color-score-medium)'
                  : '1px solid var(--color-border)',
                padding: '18px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '14px',
                cursor: 'default'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--color-text-main)' }}>
                      {source.name}
                    </h3>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                      {source.portalType}
                    </div>
                  </div>

                  <Badge variant={getBadgeVariant(source.status)}>
                    {getStatusLabel(source.status)}
                  </Badge>
                </div>

                {source.details && (
                  <p
                    style={{
                      margin: '12px 0 0 0',
                      fontSize: '12px',
                      color: isQuarantined
                        ? 'var(--color-score-low)'
                        : isRateLimited
                        ? 'var(--color-score-medium)'
                        : 'var(--color-text-muted)',
                      backgroundColor: isQuarantined
                        ? 'var(--color-score-low-bg)'
                        : isRateLimited
                        ? 'var(--color-score-medium-bg)'
                        : 'var(--color-bg-subtle)',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      lineHeight: '1.45'
                    }}
                  >
                    {source.details}
                  </p>
                )}
              </div>

              {/* Metrics Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '6px',
                  backgroundColor: 'var(--color-bg-subtle)',
                  padding: '10px 8px',
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'center'
                }}
              >
                <div>
                  <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px', fontWeight: 500 }}>
                    Records
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-main)', marginTop: '2px' }}>
                    {source.recordsExtracted}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px', fontWeight: 500 }}>
                    Failure
                  </div>
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      marginTop: '2px',
                      color:
                        source.failureRate > 20
                          ? 'var(--color-score-low)'
                          : source.failureRate > 5
                          ? 'var(--color-score-medium)'
                          : 'var(--color-score-high)'
                    }}
                  >
                    {source.failureRate}%
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px', fontWeight: 500 }}>
                    Last Run
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-main)', marginTop: '2px' }} title={source.lastRunTimestamp}>
                    {source.lastRun}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default SourceHealth
