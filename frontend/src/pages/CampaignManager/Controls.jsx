import { useState } from 'react'
import { Send, CalendarClock, PauseCircle, PlayCircle, AlertTriangle } from 'lucide-react'
import { isFutureSchedule } from './dispatchValidation'

const box = { background: 'var(--color-bg-surface, #fff)', border: '1px solid var(--color-border, #e5e7eb)', borderRadius: 12, padding: 22 }
const button = { padding: '11px 16px', borderRadius: 8, border: '1px solid #cbd5e1', cursor: 'pointer', fontWeight: 600 }

/**
 * FE-24 dispatch controls. No real delivery is attempted unless a parent provides
 * verified approval state and action handlers after the FE-23/backend integration.
 */
export default function Controls({
  campaignName = 'Campaign',
  approved = false,
  isPaused: controlledPaused,
  onSend,
  onSchedule,
  onPause,
  onResume,
  demoMode = false,
}) {
  const [demoPaused, setDemoPaused] = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')
  const [pending, setPending] = useState(null)
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState('')
  const paused = demoMode ? demoPaused : Boolean(controlledPaused)
  const authorized = demoMode || approved === true
  const handlers = { send: onSend, schedule: onSchedule, pause: onPause, resume: onResume }
  const labels = { send: 'send this campaign now', schedule: 'schedule this campaign', pause: 'pause this campaign', resume: 'resume this campaign' }

  function request(action) {
    setNotice('')
    if (working) return
    if (!authorized) { setNotice('This campaign must be approved before dispatch controls are enabled.'); return }
    if (paused && (action === 'send' || action === 'schedule')) { setNotice('This campaign is paused.'); return }
    if (action === 'schedule' && !isFutureSchedule(scheduledAt)) { setNotice('Select a valid future date and time.'); return }
    if (!demoMode && typeof handlers[action] !== 'function') { setNotice('Backend integration is not available for this action.'); return }
    setPending(action)
  }

  async function confirm() {
    const action = pending
    if (!action || working) return
    setWorking(true)
    setNotice('')
    try {
      if (!authorized || (paused && ['send', 'schedule'].includes(action)) || (action === 'schedule' && !isFutureSchedule(scheduledAt))) {
        throw new Error('Campaign state or schedule is no longer valid.')
      }
      if (demoMode) {
        if (action === 'pause') setDemoPaused(true)
        if (action === 'resume') setDemoPaused(false)
        setNotice(`Demo only: ${action === 'schedule' ? `Scheduled for ${new Date(scheduledAt).toLocaleString()}` : action + ' confirmed'}. No backend request was made.`)
      } else {
        if (typeof handlers[action] !== 'function') throw new Error('Required backend action is not connected.')
        await handlers[action](action === 'schedule' ? new Date(scheduledAt).toISOString() : undefined)
        setNotice(`${action === 'schedule' ? 'Schedule request' : 'Action'} completed successfully.`)
      }
      setPending(null)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The request failed. Please retry.')
      setPending(null)
    } finally {
      setWorking(false)
    }
  }

  return (
    <main style={{ padding: 28, maxWidth: 800, margin: '0 auto', color: 'var(--color-text-primary, #172033)' }}>
      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Campaign Dispatch Controls</h1>
      <p style={{ marginTop: 0, color: 'var(--color-text-muted, #64748b)' }}>{campaignName} · Send, schedule, or safely pause a campaign.</p>
      {demoMode && <p role="status" style={{ padding: 12, background: '#dbeafe', color: '#1e40af', borderRadius: 8 }}>Development preview only. No emails are sent and changes are not saved.</p>}
      {paused && <div role="alert" style={{ background: '#b91c1c', color: '#fff', padding: 18, borderRadius: 10, fontSize: 22, fontWeight: 800, marginBottom: 20 }}><AlertTriangle size={24} style={{ verticalAlign: 'middle', marginRight: 10 }} />PAUSED <span style={{ fontSize: 13, fontWeight: 500 }}>Campaign dispatch is disabled.</span></div>}
      {!authorized && <p role="alert" style={{ padding: 12, background: '#fef3c7', color: '#92400e', borderRadius: 8 }}>Awaiting FE-23 approval: sending and scheduling are disabled.</p>}
      <div style={{ display: 'grid', gap: 16 }}>
        <section style={box} aria-labelledby="send-heading">
          <h2 id="send-heading" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 19 }}><Send size={21} /> Send Now</h2>
          <p>Request immediate dispatch of an approved campaign. Confirmation is always required.</p>
          <button style={{ ...button, background: '#2563eb', color: '#fff' }} type="button" disabled={!authorized || paused || working || (!demoMode && !onSend)} onClick={() => request('send')}>Send Now</button>
        </section>
        <section style={box} aria-labelledby="schedule-heading">
          <h2 id="schedule-heading" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 19 }}><CalendarClock size={21} /> Schedule Dispatch</h2>
          <label htmlFor="dispatch-time" style={{ display: 'block', marginBottom: 8 }}>Dispatch date and time (your local time)</label>
          <input id="dispatch-time" type="datetime-local" value={scheduledAt} disabled={!authorized || paused || working} onChange={e => { setScheduledAt(e.target.value); setNotice('') }} style={{ display: 'block', padding: 10, borderRadius: 8, border: '1px solid #94a3b8', marginBottom: 12, maxWidth: '100%' }} />
          <button style={{ ...button, background: '#2563eb', color: '#fff' }} type="button" disabled={!authorized || paused || working || !isFutureSchedule(scheduledAt) || (!demoMode && !onSchedule)} onClick={() => request('schedule')}>Confirm Schedule</button>
        </section>
        <section style={box} aria-labelledby="pause-heading">
          <h2 id="pause-heading" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 19 }}><PauseCircle size={21} /> Emergency Pause</h2>
          <p>Pause dispatch with an explicit confirmation. The backend must enforce this state when integrated.</p>
          <button style={{ ...button, background: paused ? '#e2e8f0' : '#b91c1c', color: paused ? '#172033' : '#fff', display: 'flex', gap: 8, alignItems: 'center' }} type="button" disabled={!authorized || working || (!demoMode && !(paused ? onResume : onPause))} onClick={() => request(paused ? 'resume' : 'pause')}>
            {paused ? <PlayCircle size={18} /> : <PauseCircle size={18} />}{paused ? 'Resume Campaign' : 'Pause Campaign'}
          </button>
        </section>
      </div>
      {notice && <p role="status" style={{ background: '#f1f5f9', padding: 12, borderRadius: 8 }}>{notice}</p>}
      {pending && <div role="presentation" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.64)', display: 'grid', placeItems: 'center', padding: 16 }}>
        <section role="dialog" aria-modal="true" aria-labelledby="confirmation-title" style={{ ...box, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px #0003' }}>
          <h2 id="confirmation-title" style={{ fontSize: 21 }}>Confirm campaign action</h2>
          <p>Are you sure you want to <strong>{labels[pending]}</strong>?</p>
          {pending === 'schedule' && <p>Selected time: {new Date(scheduledAt).toLocaleString()}</p>}
          <p style={{ color: '#64748b' }}>This action requires your explicit confirmation.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" style={button} disabled={working} onClick={() => setPending(null)}>Cancel</button>
            <button type="button" style={{ ...button, background: pending === 'pause' ? '#b91c1c' : '#2563eb', color: '#fff' }} disabled={working} onClick={confirm}>{working ? 'Working…' : 'Yes, confirm'}</button>
          </div>
        </section>
      </div>}
    </main>
  )
}
