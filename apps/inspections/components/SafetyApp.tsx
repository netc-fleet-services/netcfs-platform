'use client'

import { useState } from 'react'
import { BackfillTrigger } from './BackfillTrigger'
import { PreTripAuditTool } from './PreTripAuditTool'
import { SafetyDashboard } from './SafetyDashboard'

type Tab = 'dashboard' | 'pretrip' | 'admin'

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Safety Dashboard' },
  { id: 'pretrip',   label: 'Pre-Trip Audit'   },
  { id: 'admin',     label: 'Admin'             },
]

export function SafetyApp() {
  const [tab, setTab] = useState<Tab>('dashboard')

  return (
    <div style={{ minHeight: '100vh', background: 'rgb(var(--surface))' }}>
      {/* Tab bar */}
      <div style={{
        borderBottom: '1px solid rgb(var(--outline))',
        background: 'rgb(var(--surface-container))',
        position: 'sticky', top: '3.5rem', zIndex: 20,
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 1.5rem', display: 'flex', gap: '0.25rem' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '0.75rem 1rem',
                fontSize: '0.875rem',
                fontWeight: tab === t.id ? 700 : 500,
                color: tab === t.id ? 'rgb(var(--primary))' : 'rgb(var(--on-surface-muted))',
                background: 'none',
                border: 'none',
                borderBottom: tab === t.id ? '2px solid rgb(var(--primary))' : '2px solid transparent',
                cursor: 'pointer',
                transition: 'color 0.15s',
                marginBottom: -1,
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === 'dashboard' && <SafetyDashboard />}
      {tab === 'pretrip'   && <PreTripTab />}
      {tab === 'admin'     && <AdminTab />}
    </div>
  )
}


function AdminTab() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '2.5rem 1.5rem 5rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'rgb(var(--primary))', marginBottom: '0.5rem' }}>
          NETCFS · Data Management
        </div>
        <h2 style={{ fontSize: 'clamp(1.25rem, 3vw, 1.75rem)', fontWeight: 800, color: 'rgb(var(--on-surface))', margin: '0 0 0.5rem', letterSpacing: '-0.02em' }}>
          Admin Tools
        </h2>
        <p style={{ color: 'rgb(var(--on-surface-muted))', fontSize: '0.9rem', margin: 0, maxWidth: 560, lineHeight: 1.6 }}>
          Trigger data pipelines and maintenance workflows.
        </p>
      </div>

      <div style={{ background: 'rgb(var(--surface-container))', border: '1px solid rgb(var(--outline-variant))', borderRadius: '0.875rem', padding: '1.75rem 2rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'rgb(var(--on-surface))', margin: '0 0 0.375rem', letterSpacing: '-0.01em' }}>
          Backfill Samsara Data
        </h3>
        <BackfillTrigger />
      </div>
    </div>
  )
}

function PreTripTab() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '2.5rem 1.5rem 5rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'rgb(var(--primary))', marginBottom: '0.5rem' }}>
          NETCFS · Compliance Tools
        </div>
        <h2 style={{ fontSize: 'clamp(1.25rem, 3vw, 1.75rem)', fontWeight: 800, color: 'rgb(var(--on-surface))', margin: '0 0 0.5rem', letterSpacing: '-0.02em' }}>
          Pre-Trip Compliance Audit
        </h2>
        <p style={{ color: 'rgb(var(--on-surface-muted))', fontSize: '0.9rem', margin: 0, maxWidth: 560, lineHeight: 1.6 }}>
          Upload your TowBook Driver Activity and PreTrip Inspections exports to calculate
          each driver&apos;s required, completed, and missed inspections — with search, sort,
          and Excel export.
        </p>
      </div>
      <div style={{ background: 'rgb(var(--surface-container))', border: '1px solid rgb(var(--outline-variant))', borderRadius: '0.875rem', padding: '1.75rem 2rem' }}>
        <PreTripAuditTool />
      </div>
    </div>
  )
}
