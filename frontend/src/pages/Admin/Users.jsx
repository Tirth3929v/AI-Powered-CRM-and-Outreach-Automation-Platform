import React, { useState, useCallback } from 'react'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Badge, Table } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { ROLES, can } from '../../utils/roles'

/**
 * Admin Users and Roles Management (FE-30).
 *
 * - Admin-only: any other role sees a 403 No Access page.
 * - Table of team members with role dropdown and active/inactive switch.
 * - Create user form (modal) with validation.
 * - An admin cannot deactivate their own account.
 *
 * NOTE: contracts/openapi.yaml has no /users endpoints yet, so data lives in
 * local state seeded from MOCK_USERS. Swap the handlers for apiClient calls
 * once the backend contract exists.
 */

const ROLE_OPTIONS = [
  { value: ROLES.ADMIN, label: 'Admin' },
  { value: ROLES.RESEARCHER, label: 'Researcher' },
  { value: ROLES.CAMPAIGN_MANAGER, label: 'Campaign Manager' },
  { value: ROLES.DEVELOPER, label: 'Developer' },
]

const MOCK_USERS = [
  { id: 'u-1', name: 'Admin User', email: 'admin@example.com', role: ROLES.ADMIN, is_active: true },
  { id: 'u-2', name: 'Riya Researcher', email: 'researcher@example.com', role: ROLES.RESEARCHER, is_active: true },
  { id: 'u-3', name: 'Carl Campaign', email: 'campaign@example.com', role: ROLES.CAMPAIGN_MANAGER, is_active: true },
  { id: 'u-4', name: 'Dev Developer', email: 'developer@example.com', role: ROLES.DEVELOPER, is_active: false },
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('auth_user'))
  } catch {
    return null
  }
}

function NoAccess() {
  return (
    <div role="alert" style={{ padding: '48px', textAlign: 'center' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 600 }}>403 - No Access</h2>
      <p style={{ color: 'var(--color-text-muted)', marginTop: '8px' }}>
        Only administrators can manage users and roles.
      </p>
    </div>
  )
}

function ActiveSwitch({ checked, disabled, label, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      title={disabled ? 'You cannot deactivate your own account' : undefined}
      onClick={onChange}
      style={{
        width: '40px',
        height: '22px',
        borderRadius: '999px',
        border: 'none',
        padding: '2px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: checked ? 'flex-end' : 'flex-start',
        backgroundColor: checked ? 'var(--color-primary)' : 'var(--color-border)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{ width: '18px', height: '18px', borderRadius: '50%', backgroundColor: '#ffffff' }}
      />
    </button>
  )
}

const EMPTY_FORM = { name: '', email: '', role: ROLES.RESEARCHER }

export default function UsersPage({ currentUser }) {
  const me = currentUser || getStoredUser()
  const [users, setUsers] = useState(MOCK_USERS)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState(null)

  const closeCreate = useCallback(() => setIsCreateOpen(false), [])

  if (!can(me?.role, 'manage_users')) {
    return <NoAccess />
  }

  function isSelf(user) {
    return Boolean(me) && (user.id === me.id || user.email === me.email)
  }

  function openCreate() {
    setForm(EMPTY_FORM)
    setErrors({})
    setIsCreateOpen(true)
  }

  function validate() {
    const next = {}
    if (!form.name.trim()) next.name = 'Name is required'
    if (!form.email.trim()) next.email = 'Email is required'
    else if (!EMAIL_RE.test(form.email.trim())) next.email = 'Enter a valid email address'
    else if (users.some((u) => u.email.toLowerCase() === form.email.trim().toLowerCase())) {
      next.email = 'A user with this email already exists'
    }
    return next
  }

  function handleCreate(e) {
    e.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return

    const newUser = {
      id: `u-${Date.now()}`,
      name: form.name.trim(),
      email: form.email.trim(),
      role: form.role,
      is_active: true,
    }
    setUsers((prev) => [...prev, newUser])
    setNotice(`Created ${newUser.name}.`)
    setIsCreateOpen(false)
  }

  function handleRoleChange(userId, role) {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)))
    setNotice('Role updated.')
  }

  function handleToggleActive(user) {
    if (isSelf(user) && user.is_active) {
      setNotice('You cannot deactivate your own account.')
      return
    }
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, is_active: !u.is_active } : u)))
    setNotice(`${user.name} ${user.is_active ? 'deactivated' : 'activated'}.`)
  }

  return (
    <div style={{ padding: '32px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600 }}>Users &amp; Roles</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginTop: '4px' }}>
            Manage team members, role assignments and account status.
          </p>
        </div>
        <Button onClick={openCreate}>+ Create User</Button>
      </div>

      {notice && (
        <div
          role="status"
          style={{
            marginBottom: '12px',
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-primary-light)',
            color: 'var(--color-primary)',
            fontSize: '13px',
          }}
        >
          {notice}
        </div>
      )}

      <Table headers={['Name', 'Email', 'Role', 'Status', 'Active']}>
        {users.map((user) => {
          const self = isSelf(user)
          return (
            <tr key={user.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td style={{ padding: '12px 16px', fontWeight: 500 }}>
                {user.name}
                {self && (
                  <span style={{ marginLeft: '8px' }}>
                    <Badge variant="info">You</Badge>
                  </span>
                )}
              </td>
              <td style={{ padding: '12px 16px' }}>{user.email}</td>
              <td style={{ padding: '12px 16px', minWidth: '180px' }}>
                <Select
                  aria-label={`Role for ${user.name}`}
                  value={user.role}
                  options={ROLE_OPTIONS}
                  onChange={(e) => handleRoleChange(user.id, e.target.value)}
                />
              </td>
              <td style={{ padding: '12px 16px' }}>
                <Badge variant={user.is_active ? 'success' : 'danger'}>
                  {user.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </td>
              <td style={{ padding: '12px 16px' }}>
                <ActiveSwitch
                  checked={user.is_active}
                  disabled={self && user.is_active}
                  label={`${user.is_active ? 'Deactivate' : 'Activate'} ${user.name}`}
                  onChange={() => handleToggleActive(user)}
                />
              </td>
            </tr>
          )
        })}
      </Table>

      <Modal isOpen={isCreateOpen} onClose={closeCreate} title="Create User">
        <form onSubmit={handleCreate} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Input
            label="Full name"
            value={form.name}
            error={errors.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            error={errors.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Select
            label="Role"
            value={form.role}
            options={ROLE_OPTIONS}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <Button variant="secondary" onClick={closeCreate}>
              Cancel
            </Button>
            <Button type="submit">Create</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}