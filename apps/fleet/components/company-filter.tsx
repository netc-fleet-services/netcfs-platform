'use client'

import { COMPANY_LABELS } from '@/lib/constants'

export function CompanyFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
      <button className={`loc-tab${value === 'all' ? ' active' : ''}`} onClick={() => onChange('all')}>
        All Companies
      </button>
      {Object.entries(COMPANY_LABELS).map(([key, label]) => (
        <button
          key={key}
          className={`loc-tab${value === key ? ' active' : ''}`}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
