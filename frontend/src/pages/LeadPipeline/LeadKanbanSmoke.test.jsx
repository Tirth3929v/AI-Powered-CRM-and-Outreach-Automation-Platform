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
} from '@testing-library/react'

const { listLeadsMock } = vi.hoisted(() => ({
  listLeadsMock: vi.fn(),
}))

vi.mock('../../api/leads', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    listLeads: listLeadsMock,
  }
})

import LeadPipelinePage from './index'

const mockLeads = [
  {
    id: 'lead-smoke-1',
    organization_name: 'Acme Cloud Robotics',
    title: 'Junior Python Backend Developer',
    opportunity_type: 'job',
    source_name: 'Internshala',
    source_url: 'https://internshala.com/job/detail/python-001',
    experience_min: 0,
    experience_max: 1,
    status: 'new',
    score: 94,
    score_band: 'high',
    description: 'Build robust Python microservices and backend data pipelines.',
    contacts: [
      {
        name: 'Jane Doe',
        title: 'Engineering Recruiter',
        email: 'jane@acme.com',
        phone: '9876543210',
        verified: true,
      },
    ],
  },
  {
    id: 'lead-smoke-2',
    organization_name: 'Starlight BioTech',
    title: 'Machine Learning Research Intern',
    opportunity_type: 'internship',
    source_name: 'LinkedIn',
    source_url: 'https://linkedin.com/jobs/view/ml-002',
    experience_min: 0,
    experience_max: 0,
    status: 'needs_enrichment',
    score: 82,
    score_band: 'high',
    description: 'Train foundational deep learning vision and sequence models.',
    contacts: [],
  },
  {
    id: 'lead-smoke-3',
    organization_name: 'Bharat Fintech Solutions',
    title: 'Associate React Frontend Engineer',
    opportunity_type: 'job',
    source_name: 'Naukri Freshers',
    source_url: 'https://naukri.com/job/detail/react-003',
    experience_min: 0,
    experience_max: 2,
    status: 'verified',
    score: 75,
    score_band: 'medium',
    description: 'Design interactive web portals using React and TypeScript.',
    contacts: [],
  },
]

describe('FE-12 LeadKanban Smoke Test', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    window.history.replaceState({}, '', '/pipeline')

    listLeadsMock.mockResolvedValue({
      items: mockLeads,
      total: mockLeads.length,
      page: 1,
      page_size: 100,
      total_pages: 1,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders 2-3 mocked leads in Kanban columns and opens the detail drawer on card click', async () => {
    render(<LeadPipelinePage />)

    // Switch from default Table view to Kanban view
    const kanbanToggle = screen.getByRole('button', { name: 'Kanban' })
    fireEvent.click(kanbanToggle)

    // Verify all 3 mock leads appear in their respective columns
    expect(await screen.findByText('Acme Cloud Robotics')).toBeTruthy()
    expect(screen.getByText('Starlight BioTech')).toBeTruthy()
    expect(screen.getByText('Bharat Fintech Solutions')).toBeTruthy()

    // 1. Click on Lead 1 (New column)
    const card1 = screen.getByRole('button', {
      name: 'Open Acme Cloud Robotics, Junior Python Backend Developer',
    })
    fireEvent.click(card1)

    // Drawer should open and display Lead 1 details
    expect(
      await screen.findByRole('heading', {
        name: 'Junior Python Backend Developer',
      })
    ).toBeTruthy()
    expect(screen.getByText('Acme Cloud Robotics')).toBeTruthy()
    expect(screen.getByText('Source Information')).toBeTruthy()
    expect(screen.getByText(/Build robust Python microservices/)).toBeTruthy()

    // 2. Click on Lead 2 (Needs Enrichment column)
    const card2 = screen.getByRole('button', {
      name: 'Open Starlight BioTech, Machine Learning Research Intern',
    })
    fireEvent.click(card2)

    // Drawer should switch to Lead 2 details
    expect(
      await screen.findByRole('heading', {
        name: 'Machine Learning Research Intern',
      })
    ).toBeTruthy()
    expect(screen.getByText('Starlight BioTech')).toBeTruthy()
    expect(screen.getByText(/Train foundational deep learning/)).toBeTruthy()

    // 3. Click on Lead 3 (Verified column)
    const card3 = screen.getByRole('button', {
      name: 'Open Bharat Fintech Solutions, Associate React Frontend Engineer',
    })
    fireEvent.click(card3)

    // Drawer should switch to Lead 3 details
    expect(
      await screen.findByRole('heading', {
        name: 'Associate React Frontend Engineer',
      })
    ).toBeTruthy()
    expect(screen.getByText('Bharat Fintech Solutions')).toBeTruthy()
    expect(screen.getByText(/Design interactive web portals/)).toBeTruthy()

    // Close the drawer
    const closeBtn = screen.getByRole('button', { name: 'Close drawer' })
    fireEvent.click(closeBtn)

    // Drawer headings should be unmounted
    expect(
      screen.queryByRole('heading', {
        name: 'Associate React Frontend Engineer',
      })
    ).toBeNull()
  })
})
