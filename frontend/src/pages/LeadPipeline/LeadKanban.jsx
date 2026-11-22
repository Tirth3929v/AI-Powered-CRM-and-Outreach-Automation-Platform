
import React, { useEffect, useState } from 'react'
import { Badge } from '../../components/ui/Badge'
import { ScoreBadge } from '../../components/score/ScoreBadge'
import { listLeads, MAX_PAGE_SIZE } from '../../api/leads'

const COLUMNS = [
  { key: 'new', label: 'New', variant: 'neutral' },
  { key: 'needs_enrichment', label: 'Needs Enrichment', variant: 'warning' },
  { key: 'verified', label: 'Verified', variant: 'success' },
  { key: 'draft_ready', label: 'Draft Ready', variant: 'info' },
  { key: 'approved', label: 'Approved', variant: 'info' },
  { key: 'sent', label: 'Sent', variant: 'success' },
]

const styles = {
  board: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, minmax(230px, 1fr))',
    gap: '14px',
    overflowX: 'auto',
    paddingBottom: '12px',
    alignItems: 'start',
  },
  column: {
    minWidth: '230px',
    background: 'var(--color-bg-subtle)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '12px',
    minHeight: '220px',
  },
  columnHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
  },
  cards: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  card: {
    width: '100%',
    textAlign: 'left',
    padding: '12px',
    background: 'var(--color-bg-surface)',
    color: 'var(--color-text-main)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
}

export function LeadKanban({
  filters,
  selectedId,
  refreshKey = 0,
  onSelect,
}) {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const filtersKey = JSON.stringify(filters || {})

  useEffect(() => {
    let cancelled = false

    async function loadLeads() {
      setLoading(true)
      setError(null)

      try {
        const activeFilters = JSON.parse(filtersKey)

        const firstPage = await listLeads({
          page: 1,
          pageSize: MAX_PAGE_SIZE,
          filters: activeFilters,
        })

        const allLeads = [...firstPage.items]

        for (let page = 2; page <= firstPage.total_pages; page += 1) {
          const result = await listLeads({
            page,
            pageSize: MAX_PAGE_SIZE,
            filters: activeFilters,
          })

          allLeads.push(...result.items)
        }

        if (!cancelled) {
          setLeads(allLeads)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load Kanban leads')
          setLeads([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadLeads()

    return () => {
      cancelled = true
    }
  }, [filtersKey, refreshKey])

  if (loading) {
    return <p role="status">Loading Kanban board...</p>
  }

  if (error) {
    return (
      <div role="alert" style={{ color: 'var(--color-danger, #dc2626)' }}>
        {error}
      </div>
    )
  }

  return (
    <div style={styles.board}>
      {COLUMNS.map((column) => {
        const columnLeads = leads.filter(
          (lead) => lead.status === column.key
        )

        return (
          <section
            key={column.key}
            style={styles.column}
            aria-label={`${column.label} leads`}
          >
            <div style={styles.columnHeader}>
              <h2 style={{ fontSize: '14px', fontWeight: 700, margin: 0 }}>
                {column.label}
              </h2>

              <Badge variant={column.variant}>
                {columnLeads.length}
              </Badge>
            </div>

            <div style={styles.cards}>
              {columnLeads.length === 0 ? (
                <p
                  style={{
                    fontSize: '12px',
                    color: 'var(--color-text-muted)',
                    textAlign: 'center',
                    padding: '18px 4px',
                  }}
                >
                  No leads
                </p>
              ) : (
                columnLeads.map((lead) => (
                  <button
                    key={lead.id}
                    type="button"
                    style={{
                      ...styles.card,
                      borderColor:
                        selectedId === lead.id
                          ? 'var(--color-primary)'
                          : 'var(--color-border)',
                    }}
                    aria-label={`Open ${lead.organization_name}, ${lead.title}`}
                    aria-pressed={selectedId === lead.id}
                    onClick={() => onSelect?.(lead.id, lead)}
                  >
                    <strong style={{ fontSize: '13px' }}>
                      {lead.organization_name || 'Unknown organization'}
                    </strong>

                    <span style={{ fontSize: '12px' }}>
                      {lead.title || 'Untitled role'}
                    </span>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '6px',
                      }}
                    >
                      <Badge variant="info">
                        {lead.source_name || 'Unknown source'}
                      </Badge>

                      <ScoreBadge
                        score={lead.score}
                        band={lead.score_band}
                      />
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export default LeadKanban
