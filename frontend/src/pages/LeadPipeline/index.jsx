
import React, { useState, useMemo } from 'react'
import { LeadTable } from './LeadTable'
import { LeadKanban } from './LeadKanban'
import { LeadFilters } from './LeadFilters'
import {
  createDefaultFilters,
  readFiltersFromUrl,
} from '../../store/filters'
import { Button } from '../../components/ui/Button'
import LeadDetailDrawer from './LeadDetailDrawer'
import { MOCK_LEADS } from '../../mocks/sampleLeads'

export default function LeadPipelinePage({ currentUser }) {
  const [filters, setFilters] = useState(() => readFiltersFromUrl())
  const [selectedLead, setSelectedLead] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [view, setView] = useState('table')

  const tableFilters = useMemo(() => {
    return {
      search: filters.search || '',
      score_band: filters.scoreBand === 'all' ? '' : filters.scoreBand,
      status: filters.status === 'all' ? '' : filters.status,
      assigned_to: filters.assignedTo === 'all' ? '' : filters.assignedTo,
      source: filters.sources?.length === 1
        ? filters.sources[0]
        : (filters.sources?.length > 1 ? filters.sources.join(',') : ''),
      experience_min: filters.experienceMin,
      experience_max: filters.experienceMax,
      ...filters,
    }
  }, [filters])

  const handleLeadSelect = (leadId, leadObj) => {
    setSelectedLead(leadObj || leadId)
  }

  return (
    <div
      style={{
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        minWidth: 0,
        maxWidth: '100%',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 700 }}>
            Lead Pipeline & Discovery
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
            Daily scraped 0-2 yr fresher opportunities across verified platforms.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div
            role="group"
            aria-label="Lead view selection"
            style={{
              display: 'flex',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '3px',
              gap: '3px',
            }}
          >
            <button
              type="button"
              onClick={() => setView('table')}
              aria-pressed={view === 'table'}
              style={{
                padding: '7px 12px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontWeight: 600,
                background: view === 'table'
                  ? 'var(--color-primary)'
                  : 'transparent',
                color: view === 'table' ? '#fff' : 'var(--color-text-main)',
              }}
            >
              Table
            </button>

            <button
              type="button"
              onClick={() => setView('kanban')}
              aria-pressed={view === 'kanban'}
              style={{
                padding: '7px 12px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontWeight: 600,
                background: view === 'kanban'
                  ? 'var(--color-primary)'
                  : 'transparent',
                color: view === 'kanban' ? '#fff' : 'var(--color-text-main)',
              }}
            >
              Kanban
            </button>
          </div>

          <Button variant="secondary" onClick={() => setRefreshKey((k) => k + 1)}>
            Refresh
          </Button>
        </div>
      </div>

      <LeadFilters
        leads={MOCK_LEADS}
        filters={filters}
        onFiltersChange={setFilters}
        onClear={() => {
          setFilters(createDefaultFilters())
        }}
      />

      {view === 'table' ? (
        <LeadTable
          filters={tableFilters}
          currentUserId={currentUser?.id}
          selectedId={typeof selectedLead === 'object' ? selectedLead?.id : selectedLead}
          refreshKey={refreshKey}
          onSelect={handleLeadSelect}
        />
      ) : (
        <LeadKanban
          filters={tableFilters}
          selectedId={typeof selectedLead === 'object' ? selectedLead?.id : selectedLead}
          refreshKey={refreshKey}
          onSelect={handleLeadSelect}
        />
      )}

      <LeadDetailDrawer
        lead={selectedLead}
        isOpen={!!selectedLead}
        onClose={() => setSelectedLead(null)}
      />
    </div>
  )
}
