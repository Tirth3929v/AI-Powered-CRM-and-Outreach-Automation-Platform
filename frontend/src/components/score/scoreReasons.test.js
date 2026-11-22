import { describe, expect, it } from 'vitest'
import { REASON_CODE_MAP, translateReasonCode } from './scoreReasons'

describe('translateReasonCode', () => {
  it('returns the explanation for a known reason code', () => {
    expect(translateReasonCode('OFFICIAL_COMPANY_SOURCE')).toBe(
      REASON_CODE_MAP.OFFICIAL_COMPANY_SOURCE
    )
  })

  it('returns an unknown reason code unchanged', () => {
    expect(translateReasonCode('CUSTOM_REASON')).toBe('CUSTOM_REASON')
  })
})
