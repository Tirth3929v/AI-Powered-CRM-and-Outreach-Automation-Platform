
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

import LeadPipelinePage from './index'

vi.mock('./LeadTable', () => ({
  LeadTable: ({ filters, onSelect }) => (
    <div data-testid="table-view">
      <p>Table View</p>
      <p data-testid="table-search">{filters.search}</p>
      <button
        type="button"
        onClick={() =>
          onSelect('lead-1', {
            id: 'lead-1',
            title: 'Frontend Engineer',
            source_name: 'LinkedIn',
            organization_name: 'Google',
          })
        }
      >
        Select Table Lead
      </button>
    </div>
  ),
}))

vi.mock('./LeadKanban', () => ({
  LeadKanban: ({ filters, onSelect }) => (
    <div data-testid="kanban-view">
      <p>Kanban View</p>
      <p data-testid="kanban-search">{filters.search}</p>
      <button
        type="button"
        onClick={() =>
          onSelect('lead-2', {
            id: 'lead-2',
            title: 'Backend Developer',
            source_name: 'Internshala',
            organization_name: 'Microsoft',
          })
        }
      >
        Select Kanban Lead
      </button>
    </div>
  ),
}))

vi.mock('./LeadFilters', () => ({
  LeadFilters: ({ filters, onFiltersChange }) => (
    <div data-testid="filters">
      <button
        type="button"
        onClick={() =>
          onFiltersChange({
            ...filters,
            search: 'Python Developer',
          })
        }
      >
        Apply Search Filter
      </button>
    </div>
  ),
}))

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  window.history.replaceState({}, '', '/pipeline')
})

describe('FE-12 Lead Pipeline Integration', () => {
  it('displays Table view by default', () => {
    render(<LeadPipelinePage />)

    expect(screen.getByTestId('table-view')).toBeTruthy()
    expect(screen.queryByTestId('kanban-view')).toBeNull()
  })

  it('switches between Table and Kanban views', () => {
    render(<LeadPipelinePage />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Kanban' })
    )

    expect(screen.getByTestId('kanban-view')).toBeTruthy()
    expect(screen.queryByTestId('table-view')).toBeNull()

    fireEvent.click(
      screen.getByRole('button', { name: 'Table' })
    )

    expect(screen.getByTestId('table-view')).toBeTruthy()
    expect(screen.queryByTestId('kanban-view')).toBeNull()
  })

  it('preserves applied filters when switching between views', () => {
    render(<LeadPipelinePage />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Apply Search Filter' })
    )

    expect(screen.getByTestId('table-search').textContent)
      .toBe('Python Developer')

    fireEvent.click(
      screen.getByRole('button', { name: 'Kanban' })
    )

    expect(screen.getByTestId('kanban-search').textContent)
      .toBe('Python Developer')

    fireEvent.click(
      screen.getByRole('button', { name: 'Table' })
    )

    expect(screen.getByTestId('table-search').textContent)
      .toBe('Python Developer')
  })

  it('opens the Lead Detail Drawer when a Table lead is selected', () => {
    render(<LeadPipelinePage />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Select Table Lead' })
    )

    expect(
      screen.getByRole('heading', { name: 'Frontend Engineer' })
    ).toBeTruthy()

    expect(screen.getByText('Source Information')).toBeTruthy()
  })

  it('opens the Lead Detail Drawer when a Kanban lead is selected', () => {
    render(<LeadPipelinePage />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Kanban' })
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Select Kanban Lead' })
    )

    expect(
      screen.getByRole('heading', { name: 'Backend Developer' })
    ).toBeTruthy()

    expect(screen.getByText('Source Information')).toBeTruthy()
  })

  it('closes the Lead Detail Drawer when its close button is clicked', () => {
    render(<LeadPipelinePage />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Select Table Lead' })
    )

    expect(
      screen.getByRole('heading', { name: 'Frontend Engineer' })
    ).toBeTruthy()

    fireEvent.click(
      screen.getByRole('button', { name: 'Close drawer' })
    )

    expect(
      screen.queryByRole('heading', { name: 'Frontend Engineer' })
    ).toBeNull()
  })
})
