'use client'

import { CATEGORY_LABELS } from '@/lib/constants'

export function CategoryFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
      <button className={`loc-tab${value === 'all' ? ' active' : ''}`} onClick={() => onChange('all')}>
        All Categories
      </button>
      {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
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
