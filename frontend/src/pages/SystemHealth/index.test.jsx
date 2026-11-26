/* @vitest-environment jsdom */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { apiClient } from '../../api/client'
import { listLeads } from '../../api/leads'
import SystemHealthPage from './index'

vi.mock('../../api/client', () => ({ apiClient: vi.fn() }))
vi.mock('../../api/leads', () => ({ listLeads: vi.fn() }))

vi.mock('../../components/ui/Badge', () => ({
  Badge: ({ children }) => <span>{children}</span>,
}))

vi.mock('../../components/ui/Button', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}))

vi.mock('../../components/feedback/Spinner', () => ({
  Spinner: () => <div>Loading...</div>,
}))

const SYSTEM_HEALTH = {
  n8n_status: 'online',
  database: 'connected',
  errors_24h: 2,
}

beforeEach(() => {
  vi.clearAllMocks()
  apiClient.mockResolvedValue(SYSTEM_HEALTH)
  listLeads.mockResolvedValue({ total: 7 })
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('FE-27 System Health Dashboard', () => {
  it('loads system health and queue metrics', async () => {
    render(<SystemHealthPage />)

    expect(await screen.findByText('Online')).toBeTruthy()
    expect(screen.getByText('7 pending')).toBeTruthy()
    expect(screen.getByText('connected')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('keeps system metrics available when the queue request fails', async () => {
    listLeads.mockRejectedValueOnce(new Error('Queue unavailable'))

    render(<SystemHealthPage />)

    expect(await screen.findByText('Online')).toBeTruthy()
    expect(screen.getByText('Queue unavailable')).toBeTruthy()
    expect(screen.getByText('connected')).toBeTruthy()
  })

  it('keeps queue metrics available when the system request fails', async () => {
    apiClient.mockRejectedValueOnce(new Error('System unavailable'))

    render(<SystemHealthPage />)

    expect(await screen.findByText('7 pending')).toBeTruthy()
    expect(screen.getAllByText('System unavailable').length).toBeGreaterThan(0)
  })

  it('refreshes every 30 seconds and pauses while the tab is inactive', async () => {
    vi.useFakeTimers()

    await act(async () => {
      render(<SystemHealthPage />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(apiClient).toHaveBeenCalledTimes(1)
    expect(listLeads).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(30000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(apiClient).toHaveBeenCalledTimes(2)
    expect(listLeads).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })

    await act(async () => {
      vi.advanceTimersByTime(30000)
      await Promise.resolve()
    })

    expect(apiClient).toHaveBeenCalledTimes(2)
    expect(listLeads).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })

    await act(async () => {
      fireEvent(document, new Event('visibilitychange'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(apiClient).toHaveBeenCalledTimes(3)
    expect(listLeads).toHaveBeenCalledTimes(3)
  })
})
