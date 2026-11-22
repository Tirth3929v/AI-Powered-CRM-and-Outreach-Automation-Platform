/* @vitest-environment jsdom */

import React from 'react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
afterEach(() => {
  cleanup()
})
const { listLeadsMock } = vi.hoisted(() => ({
  listLeadsMock: vi.fn(),
}))

vi.mock('../../api/leads', () => ({
  listLeads: listLeadsMock,
  MAX_PAGE_SIZE: 100,
}))

import { LeadKanban } from './LeadKanban'

const sampleLeads = [
  {
    id: 'lead-1',
    organization_name: 'Google',
    title: 'Frontend Engineer',
    source_name: 'LinkedIn',
    score: 90,
    score_band: 'high',
    status: 'new',
  },
  {
    id: 'lead-2',
    organization_name: 'Microsoft',
    title: 'Backend Developer',
    source_name: 'Internshala',
    score: 75,
    score_band: 'medium',
    status: 'verified',
  },
]

describe('FE-12 LeadKanban', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    listLeadsMock.mockResolvedValue({
      items: sampleLeads,
      total: sampleLeads.length,
      page: 1,
      page_size: 100,
      total_pages: 1,
    })
  })

  it('loads and displays leads in their correct status columns', async () => {
    render(<LeadKanban filters={{}} />)

    expect(await screen.findByText('Google')).toBeTruthy()
    expect(screen.getByText('Frontend Engineer')).toBeTruthy()
    expect(screen.getByText('Microsoft')).toBeTruthy()
    expect(screen.getByText('Backend Developer')).toBeTruthy()

    expect(
      screen.getByRole('region', { name: 'New leads' })
    ).toBeTruthy()

    expect(
      screen.getByRole('region', { name: 'Verified leads' })
    ).toBeTruthy()

    expect(listLeadsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 100,
        filters: {},
      })
    )
  })

  it('renders all six Kanban status columns', async () => {
    render(<LeadKanban filters={{}} />)

    await screen.findByText('Google')

    const columnNames = [
      'New leads',
      'Needs Enrichment leads',
      'Verified leads',
      'Draft Ready leads',
      'Approved leads',
      'Sent leads',
    ]

    columnNames.forEach((name) => {
      expect(
        screen.getByRole('region', { name })
      ).toBeTruthy()
    })
  })

  it('calls onSelect with the selected lead ID and lead object', async () => {
    const onSelect = vi.fn()

    render(
      <LeadKanban
        filters={{}}
        onSelect={onSelect}
      />
    )

    const leadCard = await screen.findByRole('button', {
      name: 'Open Google, Frontend Engineer',
    })

    fireEvent.click(leadCard)

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(
      'lead-1',
      sampleLeads[0]
    )
  })

  it('highlights the currently selected lead', async () => {
    render(
      <LeadKanban
        filters={{}}
        selectedId="lead-1"
      />
    )

    const leadCard = await screen.findByRole('button', {
      name: 'Open Google, Frontend Engineer',
    })

    expect(leadCard.getAttribute('aria-pressed')).toBe('true')
  })

  it('updates and persists active filters when filter properties change', async () => {
    const { rerender } = render(<LeadKanban filters={{ search: 'InitialSearch' }} />)

    expect(await screen.findByText('Google')).toBeTruthy()
    expect(listLeadsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { search: 'InitialSearch' },
      })
    )

    rerender(
      <LeadKanban
        filters={{
          search: 'UpdatedSearch',
          score_band: 'high',
          status: 'new',
        }}
      />
    )

    await waitFor(() => {
      expect(listLeadsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: {
            search: 'UpdatedSearch',
            score_band: 'high',
            status: 'new',
          },
        })
      )
    })
  })

  it('loads additional pages when the API returns multiple pages', async () => {
    listLeadsMock
      .mockResolvedValueOnce({
        items: [sampleLeads[0]],
        total: 2,
        page: 1,
        page_size: 100,
        total_pages: 2,
      })
      .mockResolvedValueOnce({
        items: [sampleLeads[1]],
        total: 2,
        page: 2,
        page_size: 100,
        total_pages: 2,
      })

    render(<LeadKanban filters={{}} />)

    expect(await screen.findByText('Microsoft')).toBeTruthy()

    expect(listLeadsMock).toHaveBeenCalledTimes(2)

    expect(listLeadsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 2,
      })
    )
  })

  it('displays an error when the API request fails', async () => {
    listLeadsMock.mockRejectedValueOnce(
      new Error('Unable to load leads')
    )

    render(<LeadKanban filters={{}} />)

    const alert = await screen.findByRole('alert')

    expect(alert.textContent).toContain('Unable to load leads')
  })

  it('displays empty columns when there are no leads', async () => {
    listLeadsMock.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      page_size: 100,
      total_pages: 1,
    })

    render(<LeadKanban filters={{}} />)

    await waitFor(() => {
      expect(screen.getAllByText('No leads')).toHaveLength(6)
    })
  })
})
