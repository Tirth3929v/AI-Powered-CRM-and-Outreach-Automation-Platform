import { describe, expect, it } from 'vitest'
import { can, ROLES } from './roles'

describe('can', () => {
  it('allows roles granted the requested permission', () => {
    expect(can(ROLES.RESEARCHER, 'enrich_contact')).toBe(true)
  })

  it('denies roles without the requested permission', () => {
    expect(can(ROLES.DEVELOPER, 'enrich_contact')).toBe(false)
  })

  it('denies missing roles and unknown permissions', () => {
    expect(can('', 'view_pipeline')).toBe(false)
    expect(can(ROLES.ADMIN, 'unknown_permission')).toBe(false)
  })
})
