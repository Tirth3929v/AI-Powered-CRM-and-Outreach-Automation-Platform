import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/feedback/Spinner'
import { apiClient } from '../../api/client'
import { listLeads } from '../../api/leads'

const REFRESH_INTERVAL = 30000

export default function SystemHealthPage() {
  const [health, setHealth] = useState({})
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const timerRef = useRef(null)

  const fetchHealth = useCallback(async () => {
    const results = await Promise.allSettled([
      apiClient('/system/health'),
      listLeads({
        pageSize: 1,
        filters: { status: 'needs_enrichment' },
      }),
    ])

    setHealth((prev) => ({
      system:
        results[0].status === 'fulfilled'
          ? { data: results[0].value, error: null }
          : {
              data: prev.system?.data,
              error:
                results[0].reason?.message || 'Unable to load system health',
            },
      queue:
        results[1].status === 'fulfilled'
          ? { data: results[1].value.total, error: null }
          : {
              data: prev.queue?.data,
              error:
                results[1].reason?.message || 'Unable to load scraper queue',
            },
    }))

    setLastUpdated(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchHealth()

    if (!autoRefresh) return

    const refresh = () => {
      if (document.visibilityState === 'visible') {
        fetchHealth()
      }
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchHealth()
      }
    }

    timerRef.current = setInterval(refresh, REFRESH_INTERVAL)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearInterval(timerRef.current)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [autoRefresh, fetchHealth])

  const system = health.system?.data
  const queue = health.queue

  const cards = [
    {
      title: 'n8n Workflow Engine',
      value: system?.n8n_status,
      error: health.system?.error,
      status: system?.n8n_status === 'online' ? 'Online' : 'Offline',
      healthy: system?.n8n_status === 'online',
    },
    {
      title: 'Scraper Queue',
      value: queue?.data,
      error: queue?.error,
      status: queue?.data != null ? `${queue.data} pending` : 'Unavailable',
      healthy: !queue?.error,
    },
    {
      title: 'Database Connection',
      value: system?.database,
      error: health.system?.error,
      status: system?.database || 'Unavailable',
      healthy: system?.database === 'connected',
    },
    {
      title: 'Errors (Last 24 Hours)',
      value: system?.errors_24h,
      error: health.system?.error,
      status: system?.errors_24h ?? 'Unavailable',
      healthy: system?.errors_24h === 0,
    },
  ]

  const formatTime = (date) =>
    date
      ? date.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      : 'Not updated yet'

  return (
    <div style={{ padding: '32px', maxWidth: '1200px', margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '24px', marginBottom: '8px' }}>
            System Health Dashboard
          </h1>
          <p style={{ color: 'var(--color-text-muted)' }}>
            Monitor workflow engine, scraper queue and system errors.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <Button onClick={fetchHealth}>Refresh Now</Button>
          <Button
            variant={autoRefresh ? 'primary' : 'secondary'}
            onClick={() => setAutoRefresh((prev) => !prev)}
          >
            Auto-refresh: {autoRefresh ? 'On' : 'Off'}
          </Button>
        </div>
      </div>

      <p
        style={{
          fontSize: '13px',
          color: 'var(--color-text-muted)',
          marginBottom: '24px',
        }}
      >
        Last updated: {formatTime(lastUpdated)}
        {' · '}
        {autoRefresh ? 'Refreshes every 30 seconds' : 'Auto-refresh paused'}
      </p>

      {loading && !lastUpdated ? (
        <Spinner />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '20px',
          }}
        >
          {cards.map((card) => (
            <div
              key={card.title}
              style={{
                padding: '24px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg-surface)',
              }}
            >
              <h3
                style={{
                  fontSize: '15px',
                  color: 'var(--color-text-muted)',
                  marginBottom: '16px',
                }}
              >
                {card.title}
              </h3>

              {card.error ? (
                <Badge variant="danger">Unable to load</Badge>
              ) : (
                <>
                  <p
                    style={{
                      fontSize: '24px',
                      fontWeight: 700,
                      marginBottom: '12px',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {card.value == null ? 'Unavailable' : card.status}
                  </p>
                  <Badge variant={card.healthy ? 'success' : 'warning'}>
                    {card.healthy ? 'Healthy' : 'Check status'}
                  </Badge>
                </>
              )}

              {card.error && (
                <p
                  style={{
                    marginTop: '12px',
                    fontSize: '13px',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {card.error}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
