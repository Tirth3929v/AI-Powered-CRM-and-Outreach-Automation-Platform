import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Lock,
  ArrowLeft,
  Mail,
  User,
  ShieldAlert,
  Gauge,
  Clock,
  AlertCircle
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Spinner } from '../../components/feedback/Spinner'
import {
  approveDraft,
  fetchSuppressionList,
  fetchCampaigns,
  checkRevocationSupport,
  validateChecklist,
  FALLBACK_SUPPRESSION_LIST
} from '../../api/approvals'
import { DEMO_PRESETS } from './presets'

/**
 * Campaign Approval Screen (FE-23).
 *
 * Implements:
 * 1. Recipient Details (Name, Email, Deliverability status chip)
 * 2. Email Preview (Exact subject & body, read-only after approval)
 * 3. Pre-Send Checklist (5 items with strict validation rules)
 * 4. Daily Send Limit (Allowance, Sent today, Remaining counter & meter)
 * 5. Approval Actions:
 *    - "Approve & Lock Message" (disabled if any checklist item fails or is pending)
 *    - "Revoke Approval" (reports missing backend capability as blocker)
 *    - "Back to Draft Editor"
 */
export default function ApprovalScreen({
  draftId = 'draft_001_mock',
  campaignId = 'd0000001-0000-0000-0000-000000000001',
  initialRecipient,
  initialSubject,
  initialBody,
  initialDailyLimit,
  initialSentToday,
  initialSuppressionList,
  onApproveSuccess,
  onBackToEditor
}) {
  const [activeScenario, setActiveScenario] = useState('valid')

  // Core editable fields prior to approval
  const [recipient, setRecipient] = useState(
    initialRecipient || DEMO_PRESETS.valid.recipient
  )
  const [subject, setSubject] = useState(
    initialSubject !== undefined ? initialSubject : DEMO_PRESETS.valid.subject
  )
  const [body, setBody] = useState(
    initialBody !== undefined ? initialBody : DEMO_PRESETS.valid.body
  )
  const [dailyLimit, setDailyLimit] = useState(
    initialDailyLimit !== undefined ? initialDailyLimit : DEMO_PRESETS.valid.dailyLimit
  )
  const [sentToday, setSentToday] = useState(
    initialSentToday !== undefined ? initialSentToday : DEMO_PRESETS.valid.sentToday
  )

  // Remote data & approval state
  const [suppressionList, setSuppressionList] = useState(
    initialSuppressionList || FALLBACK_SUPPRESSION_LIST
  )
  const [campaign, setCampaign] = useState(null)
  const [isLoadingInitial, setIsLoadingInitial] = useState(false)

  // Approval status
  const [isApproved, setIsApproved] = useState(false)
  const [approvalData, setApprovalData] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [revocationBlocker, setRevocationBlocker] = useState(null)

  // Load live suppression and campaign data on mount
  useEffect(() => {
    let isMounted = true
    async function loadData() {
      try {
        const [suppressions, campaigns] = await Promise.all([
          fetchSuppressionList(),
          fetchCampaigns()
        ])
        if (isMounted) {
          if (suppressions) setSuppressionList(suppressions)
          if (campaigns && campaigns.length > 0) {
            setCampaign(campaigns[0])
            if (initialDailyLimit === undefined) {
              setDailyLimit(campaigns[0].daily_limit || 50)
            }
          }
        }
      } catch {
        if (isMounted) {
          setActionError('Failed to load suppression or campaign limits.')
        }
      } finally {
        if (isMounted) setIsLoadingInitial(false)
      }
    }
    loadData()
    return () => {
      isMounted = false
    }
  }, [initialDailyLimit])

  // Switch scenarios for testing
  const handleSelectScenario = useCallback((key) => {
    if (isApproved) {
      alert('Content is locked under approval. Switch scenario is only available in unlocked state.')
      return
    }
    const preset = DEMO_PRESETS[key]
    if (preset) {
      setActiveScenario(key)
      setRecipient({ ...preset.recipient })
      setSubject(preset.subject)
      setBody(preset.body)
      setDailyLimit(preset.dailyLimit)
      setSentToday(preset.sentToday)
      setActionError(null)
      setRevocationBlocker(null)
    }
  }, [isApproved])

  // Initialize from query parameters if present (e.g. ?scenario=invalid_recipient&approved=true)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      const params = new URLSearchParams(window.location.search)
      const urlScenario = params.get('scenario')
      if (urlScenario && DEMO_PRESETS[urlScenario]) {
        handleSelectScenario(urlScenario)
      }
      if (import.meta.env.DEV && params.get('approved') === 'true') {
        setIsApproved(true)
        setApprovalData({
          approval_id: 'appr_demo_locked_001',
          content_hash: 'sha256_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          approved_at: new Date().toISOString(),
          is_mock: true
        })
      }
    }
  }, [handleSelectScenario])

  // Pre-send checklist evaluation
  const checklist = useMemo(() => {
    return validateChecklist({
      recipient,
      subject,
      body,
      suppressionList,
      dailyLimit,
      sentToday
    })
  }, [recipient, subject, body, suppressionList, dailyLimit, sentToday])

  // Handle Approve Action
  async function handleApprove() {
    if (!checklist.canApprove || isApproved || isSubmitting) {
      return
    }

    setIsSubmitting(true)
    setActionError(null)
    setRevocationBlocker(null)

    try {
      const result = await approveDraft({
        draftId,
        approved: true,
        editedSubject: subject,
        editedBody: body
      })

      // Lock message content on successful server confirmation
      setIsApproved(true)
      setApprovalData(result)
      if (onApproveSuccess) {
        onApproveSuccess(result)
      }
    } catch (err) {
      // Approval failure does NOT lock message
      setIsApproved(false)
      setActionError(err.message || 'Approval request failed. Message was not approved.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle Revoke Action
  function handleRevoke() {
    // Check if backend supports approval revocation per project rules
    const support = checkRevocationSupport()
    if (!support.supported) {
      // Do not invent fake persistent revocation; report backend capability as blocker
      setRevocationBlocker({
        code: 'REVOCATION_UNSUPPORTED',
        title: 'Backend Revocation Endpoint Not Implemented (FE-23 Blocker)',
        message: support.reason,
        timestamp: new Date().toISOString()
      })
      return
    }
  }

  function handleBack() {
    if (onBackToEditor) {
      onBackToEditor()
    } else if (typeof window !== 'undefined' && window.history && window.history.length > 1) {
      window.history.back()
    }
  }

  // Deliverability Badge styling
  const deliverabilityBadge = useMemo(() => {
    const status = (recipient?.verifiedStatus || 'unknown').toLowerCase()
    if (status === 'deliverable') {
      return { variant: 'success', label: 'Verified Deliverable', icon: CheckCircle2 }
    }
    if (status === 'risky' || status === 'catch_all') {
      return { variant: 'warning', label: `Risky (${status})`, icon: AlertTriangle }
    }
    if (status === 'undeliverable') {
      return { variant: 'danger', label: 'Undeliverable / Bounced', icon: XCircle }
    }
    return { variant: 'neutral', label: 'Verification Unknown', icon: Clock }
  }, [recipient?.verifiedStatus])

  const DeliverabilityIcon = deliverabilityBadge.icon

  if (isLoadingInitial) {
    return (
      <div style={{ padding: '64px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
        <Spinner size={32} />
        <span style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>Loading campaign verification requirements...</span>
      </div>
    )
  }

  return (
    <div
      style={{
        padding: '24px 32px',
        maxWidth: '1280px',
        margin: '0 auto',
        minHeight: '100%',
        backgroundColor: 'var(--color-bg-app)'
      }}
    >
      {/* Top Navigation & Status Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          gap: '16px',
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Button variant="secondary" onClick={handleBack} style={{ padding: '6px 12px' }}>
            <ArrowLeft size={16} style={{ marginRight: '6px' }} />
            Back to Draft Editor
          </Button>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--color-text-main)' }}>
              Campaign Approval Screen
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
              Task FE-23 &bull; Final pre-send audit, checklist verification, and content locking
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {isApproved ? (
            <Badge variant="success">
              <Lock size={12} style={{ marginRight: '4px' }} />
              Approved &amp; Locked
            </Badge>
          ) : (
            <Badge variant="warning">
              <Clock size={12} style={{ marginRight: '4px' }} />
              Pending Human Approval
            </Badge>
          )}

          {/* Test Scenario Selector for Verification */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label
              htmlFor="scenario-selector"
              style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)' }}
            >
              Test Scenario:
            </label>
            <select
              id="scenario-selector"
              value={activeScenario}
              disabled={isApproved}
              onChange={(e) => handleSelectScenario(e.target.value)}
              style={{
                fontSize: '12px',
                padding: '4px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-bg-surface)',
                color: 'var(--color-text-main)'
              }}
            >
              {Object.entries(DEMO_PRESETS).map(([key, val]) => (
                <option key={key} value={key}>
                  {val.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Revocation Blocker Alert */}
      {revocationBlocker && (
        <div
          role="alert"
          style={{
            marginBottom: '20px',
            padding: '16px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-score-low-bg)',
            border: '1px solid var(--color-score-low)',
            color: 'var(--color-score-low)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <ShieldAlert size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>
                {revocationBlocker.title}
              </div>
              <div style={{ fontSize: '13px', lineHeight: 1.5 }}>
                {revocationBlocker.message}
              </div>
              <div
                style={{
                  marginTop: '8px',
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-text-muted)'
                }}
              >
                Contract Specification: contracts/openapi.yaml does not expose DELETE /approvals/:id. Content remains securely locked.
              </div>
            </div>
            <button
              onClick={() => setRevocationBlocker(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Action Error Alert */}
      {actionError && (
        <div
          role="alert"
          style={{
            marginBottom: '20px',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-score-low-bg)',
            border: '1px solid var(--color-score-low)',
            color: 'var(--color-score-low)',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <AlertCircle size={18} />
          <span>{actionError}</span>
        </div>
      )}

      {/* Main Grid: Left = Preview & Details, Right = Checklist & Actions */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(340px, 1fr)',
          gap: '24px',
          alignItems: 'start'
        }}
      >
        {/* LEFT COLUMN: Recipient Details & Email Preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* 1. Recipient Details Card */}
          <div
            style={{
              backgroundColor: 'var(--color-bg-surface)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              padding: '20px',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                borderBottom: '1px solid var(--color-border)',
                paddingBottom: '12px'
              }}
            >
              <h2
                style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'var(--color-text-main)'
                }}
              >
                <User size={18} color="var(--color-primary)" />
                Recipient Details
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                Campaign: {campaign?.name || campaignId}
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px'
              }}
            >
              <div>
                <label style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>
                  Recipient Name
                </label>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-main)' }}>
                  {recipient?.name || 'Unspecified Contact'}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>
                  Email Address
                </label>
                <div
                  style={{
                    fontSize: '14px',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--color-text-main)',
                    wordBreak: 'break-all'
                  }}
                >
                  {recipient?.email || 'No email provided'}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>
                  Deliverability Status
                </label>
                <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <Badge variant={deliverabilityBadge.variant}>
                    <DeliverabilityIcon size={12} style={{ marginRight: '4px' }} />
                    {deliverabilityBadge.label}
                  </Badge>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Email Preview Card */}
          <div
            style={{
              backgroundColor: 'var(--color-bg-surface)',
              borderRadius: 'var(--radius-md)',
              border: isApproved ? '2px solid var(--color-success)' : '1px solid var(--color-border)',
              padding: '20px',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                borderBottom: '1px solid var(--color-border)',
                paddingBottom: '12px'
              }}
            >
              <h2
                style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'var(--color-text-main)'
                }}
              >
                <Mail size={18} color="var(--color-primary)" />
                Outreach Message Preview
              </h2>
              {isApproved && (
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--color-success)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Lock size={12} /> Read-Only Locked Content
                </span>
              )}
            </div>

            {/* Approved & Locked Banner */}
            {isApproved && (
              <div
                style={{
                  marginBottom: '16px',
                  padding: '12px 16px',
                  backgroundColor: 'var(--color-score-high-bg)',
                  border: '1px solid var(--color-score-high)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '13px',
                  color: 'var(--color-score-high)'
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>Message Approved &amp; Locked for Dispatch</span>
                  {approvalData?.is_mock ? (
                    <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                      (Simulated Offline Mode)
                    </span>
                  ) : (
                    <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#bbf7d0', color: '#166534', fontWeight: 600 }}>
                      (Verified Backend API Lock)
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
                  Approval ID: {approvalData?.approval_id} &bull; Hash: {approvalData?.content_hash?.slice(0, 24)}...
                </div>
                <div style={{ fontSize: '11px', marginTop: '4px', color: 'var(--color-text-muted)' }}>
                  Approved at {approvalData?.approved_at ? new Date(approvalData.approved_at).toLocaleString() : 'Just now'}
                </div>
              </div>
            )}

            {/* Subject Line Field */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label
                  htmlFor="subject-input"
                  style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)' }}
                >
                  Exact Subject Line
                </label>
                <span style={{ fontSize: '12px', color: subject?.length > 80 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                  {subject ? subject.length : 0} / 80 characters
                </span>
              </div>

              {isApproved ? (
                <div
                  id="subject-input"
                  style={{
                    padding: '10px 12px',
                    backgroundColor: 'var(--color-bg-subtle)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    fontSize: '14px',
                    fontWeight: 600,
                    color: 'var(--color-text-main)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <span>{subject || '(Empty subject)'}</span>
                  <Lock size={14} color="var(--color-text-light)" />
                </div>
              ) : (
                <input
                  id="subject-input"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Enter email subject line..."
                  maxLength={80}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: subject.trim().length === 0 ? '1px solid var(--color-danger)' : '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-bg-surface)',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: 'var(--color-text-main)',
                    outline: 'none'
                  }}
                />
              )}
            </div>

            {/* Email Body Field */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label
                  htmlFor="body-input"
                  style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)' }}
                >
                  Exact Email Body
                </label>
                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  {body ? body.split(/\s+/).filter(Boolean).length : 0} words
                </span>
              </div>

              {isApproved ? (
                <div
                  id="body-input"
                  style={{
                    padding: '14px',
                    backgroundColor: 'var(--color-bg-subtle)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    fontSize: '14px',
                    lineHeight: 1.6,
                    color: 'var(--color-text-main)',
                    whiteSpace: 'pre-wrap',
                    minHeight: '160px',
                    position: 'relative'
                  }}
                >
                  {body || '(Empty email body)'}
                  <div style={{ position: 'absolute', top: '10px', right: '10px' }}>
                    <Lock size={14} color="var(--color-text-light)" />
                  </div>
                </div>
              ) : (
                <textarea
                  id="body-input"
                  value={body}
                  rows={8}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Enter email body message..."
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    border: body.trim().length === 0 ? '1px solid var(--color-danger)' : '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-bg-surface)',
                    fontSize: '14px',
                    lineHeight: 1.6,
                    color: 'var(--color-text-main)',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    outline: 'none'
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Pre-Send Checklist, Limits & Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* 3. Pre-Send Checklist Card */}
          <div
            style={{
              backgroundColor: 'var(--color-bg-surface)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              padding: '20px',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                borderBottom: '1px solid var(--color-border)',
                paddingBottom: '12px'
              }}
            >
              <h2
                style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'var(--color-text-main)'
                }}
              >
                Pre-Send Checklist
              </h2>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: checklist.canApprove ? 'var(--color-success)' : 'var(--color-danger)'
                }}
              >
                {checklist.items.filter((i) => i.pass).length} / {checklist.items.length} Passed
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {checklist.items.map((item) => {
                const isPass = item.pass
                const isPending = item.pending

                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: isPass
                        ? 'var(--color-score-high-bg)'
                        : isPending
                        ? 'var(--color-bg-subtle)'
                        : 'var(--color-score-low-bg)',
                      border: `1px solid ${
                        isPass
                          ? 'var(--color-score-high)'
                          : isPending
                          ? 'var(--color-border)'
                          : 'var(--color-score-low)'
                      }`
                    }}
                  >
                    <div style={{ marginTop: '2px', flexShrink: 0 }}>
                      {isPass ? (
                        <CheckCircle2 size={16} color="var(--color-score-high)" />
                      ) : isPending ? (
                        <Clock size={16} color="var(--color-text-muted)" />
                      ) : (
                        <XCircle size={16} color="var(--color-score-low)" />
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          color: isPass
                            ? 'var(--color-score-high)'
                            : isPending
                            ? 'var(--color-text-main)'
                            : 'var(--color-score-low)'
                        }}
                      >
                        {item.label}
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: isPass
                            ? 'var(--color-score-high)'
                            : isPending
                            ? 'var(--color-text-muted)'
                            : 'var(--color-score-low)',
                          marginTop: '2px',
                          wordBreak: 'break-word'
                        }}
                      >
                        {item.message}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 4. Daily Send Limit Card */}
          <div
            style={{
              backgroundColor: 'var(--color-bg-surface)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              padding: '20px',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                borderBottom: '1px solid var(--color-border)',
                paddingBottom: '12px'
              }}
            >
              <h2
                style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'var(--color-text-main)'
                }}
              >
                <Gauge size={18} color="var(--color-primary)" />
                Daily Send Limit
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                {campaign?.name || `Campaign: ${campaignId}`}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', textAlign: 'center', marginBottom: '14px' }}>
              <div style={{ padding: '8px', backgroundColor: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Daily Allowance</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text-main)' }}>{dailyLimit}</div>
              </div>
              <div style={{ padding: '8px', backgroundColor: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Sent Today</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text-main)' }}>{sentToday}</div>
              </div>
              <div
                style={{
                  padding: '8px',
                  backgroundColor: checklist.remaining > 0 ? 'var(--color-score-high-bg)' : 'var(--color-score-low-bg)',
                  borderRadius: 'var(--radius-sm)'
                }}
              >
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Remaining</div>
                <div
                  style={{
                    fontSize: '16px',
                    fontWeight: 700,
                    color: checklist.remaining > 0 ? 'var(--color-score-high)' : 'var(--color-score-low)'
                  }}
                >
                  {checklist.remaining}
                </div>
              </div>
            </div>

            {/* Progress Meter Bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                <span>Usage Progress</span>
                <span>{Math.round((sentToday / Math.max(dailyLimit, 1)) * 100)}%</span>
              </div>
              <div
                style={{
                  height: '8px',
                  width: '100%',
                  backgroundColor: 'var(--color-bg-subtle)',
                  borderRadius: 'var(--radius-full)',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, Math.round((sentToday / Math.max(dailyLimit, 1)) * 100))}%`,
                    backgroundColor:
                      sentToday >= dailyLimit
                        ? 'var(--color-danger)'
                        : sentToday / dailyLimit > 0.8
                        ? 'var(--color-warning)'
                        : 'var(--color-primary)',
                    transition: 'width 0.3s ease'
                  }}
                />
              </div>
            </div>
          </div>

          {/* 5. Approval Actions Card */}
          <div
            style={{
              backgroundColor: 'var(--color-bg-surface)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              padding: '20px',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            <h2
              style={{
                fontSize: '15px',
                fontWeight: 600,
                marginBottom: '12px',
                color: 'var(--color-text-main)'
              }}
            >
              Approval Actions
            </h2>

            {!isApproved ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <Button
                  variant="primary"
                  disabled={!checklist.canApprove || isSubmitting}
                  isLoading={isSubmitting}
                  onClick={handleApprove}
                  style={{ width: '100%', padding: '12px' }}
                >
                  <Lock size={16} style={{ marginRight: '8px' }} />
                  Approve &amp; Lock Message
                </Button>

                {!checklist.canApprove && (
                  <div style={{ fontSize: '12px', color: 'var(--color-danger)', textAlign: 'center' }}>
                    Approval disabled: resolve failing checklist items before locking.
                  </div>
                )}

                <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', textAlign: 'center' }}>
                  Calling POST /approvals will lock this recipient and content with an immutable sha256 hash. Email will NOT be dispatched automatically.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--color-bg-subtle)',
                    fontSize: '12px',
                    color: 'var(--color-text-muted)'
                  }}
                >
                  Content is locked. To modify recipient or copy, approval must be officially revoked on the server.
                </div>

                <Button
                  variant="danger"
                  onClick={handleRevoke}
                  style={{ width: '100%', padding: '10px' }}
                >
                  Revoke Approval
                </Button>

                <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', textAlign: 'center' }}>
                  Revocation requires server-side contract verification.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
