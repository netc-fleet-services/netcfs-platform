'use client'

import type { Location } from '@/lib/types'

interface Props {
  locations: Location[]
  value: string
  onChange: (v: string) => void
}

export function LocationFilter({ locations, value, onChange }: Props) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
      <button className={`loc-tab${value === 'all' ? ' active' : ''}`} onClick={() => onChange('all')}>
        All Locations
      </button>
      {locations.map(loc => (
        <button
          key={loc.id}
          className={`loc-tab${value === loc.id ? ' active' : ''}`}
          onClick={() => onChange(loc.id)}
        >
          {loc.name}
        </button>
      ))}
    </div>
  )
}
