/**
 * Approvals & Campaign Pre-Send Validation API (FE-23).
 * Integrates with contracts/openapi.yaml:
 *  - POST /approvals (operationId: approveDraft)
 *  - GET /suppression (operationId: listSuppression)
 *  - GET /campaigns (operationId: listCampaigns)
 */

import { apiClient } from './client'

export const FALLBACK_SUPPRESSION_LIST = [
  {
    id: 's0000001-0000-0000-0000-000000000001',
    value: 'blocked-company.example.com',
    kind: 'domain',
    reason: 'Organization requested no cold contact',
    created_at: '2026-10-15T00:00:00Z'
  },
  {
    id: 's0000002-0000-0000-0000-000000000002',
    value: 'optout@example.com',
    kind: 'email',
    reason: 'Recipient clicked unsubscribe',
    created_at: '2026-10-15T00:00:00Z'
  }
]

export const DEFAULT_CAMPAIGN_SUMMARY = {
  id: 'd0000001-0000-0000-0000-000000000001',
  name: 'Q4 2026 Fresher Talent Outreach',
  purpose: 'Connecting verified technical freshers with tech startups and scaleups',
  status: 'active',
  daily_limit: 50
}

/**
 * Fetch the active suppression list from GET /suppression.
 * Falls back to fixture data if offline or network failure.
 */
export async function fetchSuppressionList() {
  try {
    const list = await apiClient('/suppression', { method: 'GET' })
    if (Array.isArray(list)) return list
    return FALLBACK_SUPPRESSION_LIST
  } catch (err) {
    // Offline / demo fallback per project design
    return FALLBACK_SUPPRESSION_LIST
  }
}

/**
 * Fetch campaigns to determine daily send limits from GET /campaigns.
 */
export async function fetchCampaigns() {
  try {
    const campaigns = await apiClient('/campaigns', { method: 'GET' })
    if (Array.isArray(campaigns) && campaigns.length > 0) {
      return campaigns
    }
    return [DEFAULT_CAMPAIGN_SUMMARY]
  } catch (err) {
    return [DEFAULT_CAMPAIGN_SUMMARY]
  }
}

/**
 * Submits draft human approval to POST /approvals.
 * @param {Object} params
 * @param {string} params.draftId
 * @param {boolean} params.approved
 * @param {string} [params.editedSubject]
 * @param {string} [params.editedBody]
 * @returns {Promise<{ approval_id: string, content_hash: string, approved_at: string, approved_by?: string }>}
 */
export async function approveDraft({ draftId, approved = true, editedSubject, editedBody }) {
  if (!draftId) {
    throw new Error('draft_id is required for approval')
  }

  const payload = {
    draft_id: draftId,
    approved: Boolean(approved),
    ...(editedSubject !== undefined ? { edited_subject: editedSubject } : {}),
    ...(editedBody !== undefined ? { edited_body: editedBody } : {})
  }

  try {
    const response = await apiClient('/approvals', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
    return {
      ...response,
      is_mock: false
    }
  } catch (err) {
    // If backend is running in mock/demo mode or returns simulated response
    if (import.meta.env.VITE_USE_MOCKS === 'true' || err.status === 0) {
      // Offline fallback approval response adhering strictly to openapi ApprovalResponse schema
      const raw = `${editedSubject || ''}:${editedBody || ''}`
      let hash = 0
      for (let i = 0; i < raw.length; i++) {
        hash = (hash << 5) - hash + raw.charCodeAt(i)
        hash |= 0
      }
      const hex = Math.abs(hash).toString(16).padStart(8, '0')
      return {
        approval_id: `appr_mock_${draftId}`,
        draft_id: draftId,
        content_hash: `sha256_mock_${hex}`,
        approved_by: 'mock_local_reviewer',
        approved_at: new Date().toISOString(),
        is_mock: true
      }
    }
    throw err
  }
}

/**
 * Checks whether backend supports approval revocation.
 * Per OpenAPI specification (contracts/openapi.yaml) and backend implementation (backend/app/api/v1/approvals.py),
 * no revocation endpoint (such as DELETE /approvals/{id} or POST /approvals/{id}/revoke) is provided.
 */
export function checkRevocationSupport() {
  return {
    supported: false,
    endpoint: null,
    reason:
      'Backend API contract (openapi.yaml & approvals.py) does not implement an approval revocation endpoint. Revocation is blocked.'
  }
}

/**
 * Checks if a given email or domain is present in the suppression list.
 * @param {string} email
 * @param {Array<{ value: string, kind: 'email' | 'domain' }>} suppressionList
 * @returns {{ isSuppressed: boolean, reason?: string, matchedEntry?: object }}
 */
export function checkSuppression(email, suppressionList = []) {
  if (!email || typeof email !== 'string') {
    return { isSuppressed: false }
  }

  const cleanEmail = email.trim().toLowerCase()
  const domain = cleanEmail.includes('@') ? cleanEmail.split('@')[1] : ''

  for (const entry of suppressionList) {
    const entryVal = (entry.value || '').trim().toLowerCase()
    if (entry.kind === 'email' && entryVal === cleanEmail) {
      return {
        isSuppressed: true,
        reason: entry.reason || 'Recipient email is on suppression list',
        matchedEntry: entry
      }
    }
    if (entry.kind === 'domain' && domain && (entryVal === domain || domain.endsWith(`.${entryVal}`))) {
      return {
        isSuppressed: true,
        reason: entry.reason || `Domain @${domain} is suppressed from outreach`,
        matchedEntry: entry
      }
    }
  }

  return { isSuppressed: false }
}

/**
 * Validates the 5 pre-send checklist rules for FE-23.
 *
 * Rules:
 *  1. Recipient email verified and deliverable (must equal 'deliverable')
 *  2. Subject is valid (non-empty string, length 1..80 per openapi AIDraftOutput)
 *  3. Body is valid (non-empty string)
 *  4. Recipient is not suppressed (email and domain check)
 *  5. Remaining daily send limit is > 0
 *
 * @param {Object} input
 * @returns {Object} detailed checklist evaluation
 */
export function validateChecklist({
  recipient,
  subject,
  body,
  suppressionList,
  dailyLimit = 50,
  sentToday = 0
}) {
  const email = (recipient?.email || '').trim()
  const deliverabilityStatus = (recipient?.verifiedStatus || recipient?.deliverability_status || '').toLowerCase().trim()

  // 1. Deliverability Check
  let recipientCheck = {
    id: 'recipient_deliverable',
    label: 'Recipient email verified & deliverable',
    pass: false,
    pending: false,
    message: ''
  }

  if (!email) {
    recipientCheck.message = 'No recipient email provided'
  } else if (!deliverabilityStatus || deliverabilityStatus === 'unknown') {
    recipientCheck.pending = true
    recipientCheck.message = 'Verification status is unknown or pending'
  } else if (deliverabilityStatus === 'deliverable') {
    recipientCheck.pass = true
    recipientCheck.message = `Verified deliverable: ${email}`
  } else {
    recipientCheck.message = `Email deliverability failed (${deliverabilityStatus})`
  }

  // 2. Subject Validity Check (OpenAPI max 80 chars)
  const cleanSubject = typeof subject === 'string' ? subject.trim() : ''
  let subjectCheck = {
    id: 'subject_valid',
    label: 'Subject line is valid',
    pass: false,
    message: ''
  }
  if (!cleanSubject) {
    subjectCheck.message = 'Subject line is empty'
  } else if (cleanSubject.length > 80) {
    subjectCheck.message = `Subject exceeds maximum 80 characters (${cleanSubject.length}/80)`
  } else {
    subjectCheck.pass = true
    subjectCheck.message = `Valid subject (${cleanSubject.length}/80 characters)`
  }

  // 3. Body Validity Check
  const cleanBody = typeof body === 'string' ? body.trim() : ''
  let bodyCheck = {
    id: 'body_valid',
    label: 'Email body is valid',
    pass: false,
    message: ''
  }
  if (!cleanBody) {
    bodyCheck.message = 'Email message body is empty'
  } else {
    bodyCheck.pass = true
    bodyCheck.message = `Valid message body (${cleanBody.length} characters)`
  }

  // 4. Suppression List Check
  let suppressionCheck = {
    id: 'not_suppressed',
    label: 'Recipient not on suppression list',
    pass: false,
    pending: false,
    message: ''
  }

  if (!suppressionList) {
    suppressionCheck.pending = true
    suppressionCheck.message = 'Suppression list check pending'
  } else {
    const { isSuppressed, reason } = checkSuppression(email, suppressionList)
    if (isSuppressed) {
      suppressionCheck.pass = false
      suppressionCheck.message = reason || 'Recipient or domain is suppressed'
    } else {
      suppressionCheck.pass = true
      suppressionCheck.message = 'Email and domain clear of suppression lists'
    }
  }

  // 5. Daily Send Limit Check
  const remaining = Math.max(0, Number(dailyLimit || 50) - Number(sentToday || 0))
  let limitCheck = {
    id: 'daily_limit',
    label: 'Remaining daily send limit > 0',
    pass: false,
    message: '',
    allowance: dailyLimit,
    sentToday,
    remaining
  }

  if (remaining > 0) {
    limitCheck.pass = true
    limitCheck.message = `${remaining} send(s) remaining today (${sentToday}/${dailyLimit} used)`
  } else {
    limitCheck.pass = false
    limitCheck.message = `Daily send limit exhausted (${sentToday}/${dailyLimit} used today)`
  }

  const items = [recipientCheck, subjectCheck, bodyCheck, suppressionCheck, limitCheck]
  const allPassed = items.every((item) => item.pass)
  const anyPending = items.some((item) => item.pending)
  const canApprove = allPassed && !anyPending

  return {
    items,
    canApprove,
    allPassed,
    anyPending,
    remaining,
    recipientCheck,
    subjectCheck,
    bodyCheck,
    suppressionCheck,
    limitCheck
  }
}
