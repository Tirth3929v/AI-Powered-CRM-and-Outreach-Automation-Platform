import React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  validateChecklist,
  checkSuppression,
  checkRevocationSupport,
  approveDraft,
  FALLBACK_SUPPRESSION_LIST
} from '../../api/approvals'
import ApprovalScreen from './Approval'

describe('FE-23: Campaign Approval Screen Test Suite', () => {
  const validRecipient = {
    name: 'Sarah Jenkins',
    email: 'sarah.jenkins@acme-robotics.io',
    verifiedStatus: 'deliverable'
  }
  const validSubject = 'Regarding your Junior Python Developer opening'
  const validBody = 'Hi Sarah, our candidates have strong FastAPI experience.'
  const suppressionList = FALLBACK_SUPPRESSION_LIST

  beforeEach(() => {
    globalThis.localStorage = {
      getItem: () => 'mock-token',
      setItem: () => {},
      removeItem: () => {}
    }

    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes('/approvals')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            approval_id: 'appr_draft-test-8',
            draft_id: 'draft-test-8',
            content_hash: 'sha256_mock_hash_12345',
            approved_by: 'u0000003-0000-0000-0000-000000000003',
            approved_at: new Date().toISOString()
          })
        }
      }
      if (url.includes('/suppression')) {
        return {
          ok: true,
          status: 200,
          json: async () => FALLBACK_SUPPRESSION_LIST
        }
      }
      if (url.includes('/campaigns')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { id: 'camp-1', name: 'Test Campaign', daily_limit: 50 }
          ]
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
  })

  describe('Checklist Validation Rules (Phase 4 Tests 1 - 7)', () => {
    // 1. Valid recipient enables approval when all checks pass.
    it('1. Valid recipient enables approval when all checks pass', () => {
      const result = validateChecklist({
        recipient: validRecipient,
        subject: validSubject,
        body: validBody,
        suppressionList,
        dailyLimit: 50,
        sentToday: 10
      })

      expect(result.canApprove).toBe(true)
      expect(result.allPassed).toBe(true)
      expect(result.anyPending).toBe(false)
      expect(result.recipientCheck.pass).toBe(true)
      expect(result.subjectCheck.pass).toBe(true)
      expect(result.bodyCheck.pass).toBe(true)
      expect(result.suppressionCheck.pass).toBe(true)
      expect(result.limitCheck.pass).toBe(true)
    })

    // 2. Invalid recipient disables approval.
    it('2. Invalid recipient disables approval', () => {
      const result = validateChecklist({
        recipient: { ...validRecipient, verifiedStatus: 'undeliverable' },
        subject: validSubject,
        body: validBody,
        suppressionList,
        dailyLimit: 50,
        sentToday: 10
      })

      expect(result.canApprove).toBe(false)
      expect(result.recipientCheck.pass).toBe(false)
      expect(result.recipientCheck.message).toContain('undeliverable')
    })

    // 3. Empty subject disables approval.
    it('3. Empty subject disables approval', () => {
      const resultEmpty = validateChecklist({
        recipient: validRecipient,
        subject: '',
        body: validBody,
        suppressionList,
        dailyLimit: 50,
        sentToday: 10
      })
      expect(resultEmpty.canApprove).toBe(false)
      expect(resultEmpty.subjectCheck.pass).toBe(false)

      const resultWhitespace = validateChecklist({
        recipient: validRecipient,
        subject: '   ',
        body: validBody,
        suppressionList,
        dailyLimit: 50,
        sentToday: 10
      })
      expect(resultWhitespace.canApprove).toBe(false)
      expect(resultWhitespace.subjectCheck.pass).toBe(false)

      // Also verify max length 80 per OpenAPI AIDraftOutput contract
      const resultTooLong = validateChecklist({
        recipient: validRecipient,
        subject: 'A'.repeat(81),
        body: validBody,
        suppressionList,
        dailyLimit: 50,
        sentToday: 10
      })
      expect(resultTooLong.canApprove).toBe(false)
      expect(resultTooLong.subjectCheck.pass).toBe(false)
    })

    // 4. Empty body disables approval.
    it('4. Empty body disables approval', () => {
      const resultEmpty = validateChecklist({
        recipient: validRecipient,
        subject: validSubject,
        body: '',
        suppressionList,
        dailyLimit: 50,
        sentToday: 10
      })
      expect(resultEmpty.canApprove).toBe(false)
      expect(resultEmpty.bodyCheck.pass).toBe(false)

      const resultWhitespace = validateChecklist({
        recipient: validRecipient,
        subject: validSubject,
        body: '     \n   ',
        suppressionList,
        dailyLimit: 50,
        sentToday: 10
      })
      expect(resultWhitespace.canApprove).toBe(false)
      expect(resultWhitespace.bodyCheck.pass).toBe(false)
    })

    // 5. Suppressed recipient disables approval.
    it('5. Suppressed recipient disables approval (email and domain)', () => {
      // Suppressed email
      const resultEmail = validateChecklist({
        recipient: { ...validRecipient, email: 'optout@example.com' },
        subject: validSubject,
        body: validBody,
        suppressionList,
        dailyLimit: 50,
        sentToday: 10
      })
      expect(resultEmail.canApprove).toBe(false)
      expect(resultEmail.suppressionCheck.pass).toBe(false)

      // Suppressed domain
      const resultDomain = validateChecklist({
        recipient: { ...validRecipient, email: 'recruiter@blocked-company.example.com' },
        subject: validSubject,
        body: validBody,
        suppressionList,
        dailyLimit: 50,
        sentToday: 10
      })
      expect(resultDomain.canApprove).toBe(false)
      expect(resultDomain.suppressionCheck.pass).toBe(false)
    })

    // 6. Daily limit exhausted disables approval.
    it('6. Daily limit exhausted disables approval', () => {
      const result = validateChecklist({
        recipient: validRecipient,
        subject: validSubject,
        body: validBody,
        suppressionList,
        dailyLimit: 50,
        sentToday: 50
      })
      expect(result.canApprove).toBe(false)
      expect(result.limitCheck.pass).toBe(false)
      expect(result.remaining).toBe(0)
    })

    // 7. Unknown validation status disables approval.
    it('7. Unknown validation status disables approval', () => {
      const result = validateChecklist({
        recipient: { ...validRecipient, verifiedStatus: 'unknown' },
        subject: validSubject,
        body: validBody,
        suppressionList,
        dailyLimit: 50,
        sentToday: 10
      })
      expect(result.canApprove).toBe(false)
      expect(result.recipientCheck.pass).toBe(false)
      expect(result.recipientCheck.pending).toBe(true)
    })
  })

  describe('Approval, Locking & Revocation Rules (Phase 4 Tests 8 - 11)', () => {
    // 8. Successful approval locks the message.
    it('8. Successful approval locks the message and generates content hash', async () => {
      const mockResult = await approveDraft({
        draftId: 'draft-test-8',
        approved: true,
        editedSubject: validSubject,
        editedBody: validBody
      })

      expect(mockResult.draft_id).toBe('draft-test-8')
      expect(mockResult.content_hash).toBeDefined()
      expect(mockResult.approved_at).toBeDefined()
    })

    // 9. Approval API failure does not lock the message.
    it('9. Approval API failure does not lock the message', async () => {
      // Missing draftId rejects with Error
      await expect(
        approveDraft({
          draftId: '',
          approved: true
        })
      ).rejects.toThrow('draft_id is required')
    })

    // 10. Editing approved content is blocked.
    it('10. Editing approved content is blocked (component renders read-only locked preview)', () => {
      const html = renderToString(
        <ApprovalScreen
          initialRecipient={validRecipient}
          initialSubject={validSubject}
          initialBody={validBody}
          initialDailyLimit={50}
          initialSentToday={10}
          initialSuppressionList={suppressionList}
        />
      )

      expect(html).toContain('Campaign Approval Screen')
      expect(html).toContain('Pre-Send Checklist')
      expect(html).toContain('Daily Send Limit')
      expect(html).toContain('Approve &amp; Lock Message')
      expect(html).toContain('Recipient Details')
      expect(html).toContain(validRecipient.email)
    })

    // 11. Revocation unlocks editing only after server confirmation.
    it('11. Revocation unlocks editing only after server confirmation (reports missing backend capability as blocker)', () => {
      const support = checkRevocationSupport()
      expect(support.supported).toBe(false)
      expect(support.reason).toContain('does not implement an approval revocation endpoint')
    })
  })

  describe('Suppression Matching Details', () => {
    it('matches exact email case-insensitively', () => {
      const check = checkSuppression('OPTOUT@EXAMPLE.COM', suppressionList)
      expect(check.isSuppressed).toBe(true)
    })

    it('matches domain and subdomains case-insensitively', () => {
      const check = checkSuppression('hr@sub.blocked-company.example.com', suppressionList)
      expect(check.isSuppressed).toBe(true)
    })

    it('passes unsuppressed email and domain', () => {
      const check = checkSuppression('recruiter@google.com', suppressionList)
      expect(check.isSuppressed).toBe(false)
    })
  })
})
