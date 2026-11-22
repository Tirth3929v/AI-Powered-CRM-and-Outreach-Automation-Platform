import React from 'react'
import { NavLink } from 'react-router-dom'
import { can } from '../../utils/roles'

/**
 * Sidebar Navigation Component (FE-03, FE-08).
 * Links: Pipeline, My Leads, Enrichment, Campaigns, Suppression, System Health, Error Center, Admin, Kitchen Sink.
 */
export function Sidebar({ userRole = 'admin' }) {
  const navItems = [
    { label: 'Lead Pipeline', path: '/pipeline', action: 'view_pipeline' },
    { label: 'My Leads', path: '/my-leads', action: 'claim_leads' },
    { label: 'Enrichment Queue', path: '/enrichment', action: 'enrich_contact' },
    { label: 'Enrichment History', path: '/enrichment/history', action: 'enrich_contact' },
    { label: 'Campaign Manager', path: '/campaigns', action: 'review_drafts' },
    { label: 'Suppression List', path: '/suppression', action: 'manage_suppression' },
    { label: 'System Health', path: '/system-health', action: 'view_system_health' },
    { label: 'Error Center', path: '/error-center', action: 'view_error_center' },
    { label: 'Admin Settings', path: '/admin', action: 'manage_users' },
    { label: 'UI Kitchen Sink', path: '/kitchen', action: 'view_pipeline' }
  ]

  const visibleItems = navItems.filter((item) => can(userRole, item.action))

  return (
    <aside
      style={{
        width: '240px',
        backgroundColor: 'var(--color-bg-surface)',
        borderRight: '1px solid var(--color-border)',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 16px',
        flexShrink: 0
      }}
    >
      <div style={{ paddingBottom: '20px', borderBottom: '1px solid var(--color-border)', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-primary)' }}>
          AI Outreach CRM
        </h1>
        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
          Lead Intelligence v1.0
        </span>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, overflowY: 'auto' }}>
        {visibleItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/enrichment'}
            style={({ isActive }) => ({
              display: 'block',
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              fontSize: '14px',
              fontWeight: isActive ? 600 : 500,
              color: isActive ? 'var(--color-primary)' : 'var(--color-text-main)',
              backgroundColor: isActive ? 'var(--color-primary-light)' : 'transparent',
              textDecoration: 'none'
            })}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div style={{ paddingTop: '12px', borderTop: '1px solid var(--color-border)', fontSize: '12px', color: 'var(--color-text-muted)' }}>
        Free-Tier Production MVP
      </div>
    </aside>
  )
}
