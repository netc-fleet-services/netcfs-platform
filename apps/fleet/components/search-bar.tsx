'use client'

export function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ position: 'relative' }}>
      <svg
        width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--on-surface-muted)', pointerEvents: 'none' }}
      >
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
      </svg>
      <input
        type="search"
        className="form-input"
        placeholder="Search unit, VIN, location, notes…"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ paddingLeft: '2.25rem', paddingRight: value ? '2.25rem' : undefined }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--on-surface-muted)', padding: '0.1rem' }}
        >×</button>
      )}
    </div>
  )
}
