import { describe, it, expect } from 'vitest'
import { isFutureSchedule } from './dispatchValidation'

describe('FE-24 scheduling validation', () => {
  it('rejects empty and invalid dates', () => {
    expect(isFutureSchedule('')).toBe(false)
    expect(isFutureSchedule('2099-02-31T10:00')).toBe(false)
    expect(isFutureSchedule('not-a-date')).toBe(false)
  })
  it('rejects past times', () => {
    expect(isFutureSchedule('2020-01-01T12:00')).toBe(false)
  })
  it('accepts a valid future local time', () => {
    expect(isFutureSchedule('2099-01-01T12:00')).toBe(true)
  })
})
