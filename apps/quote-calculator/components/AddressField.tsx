'use client'

import { useEffect, useRef, useState } from 'react'

interface Suggestion {
  label: string
}

export function AddressField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef    = useRef<AbortController | null>(null)
  const lastAcceptedRef = useRef<string>('')

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = value.trim()
    if (trimmed === lastAcceptedRef.current) return
    if (trimmed.length < 3) { setSuggestions([]); return }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      setLoading(true)
      try {
        const res = await fetch(`/api/geocode/suggest?q=${encodeURIComponent(trimmed)}`, { signal: ac.signal })
        if (!res.ok) return
        const body = await res.json()
        setSuggestions(body.suggestions ?? [])
      } catch {
        // aborted or network — ignore
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [value])

  const accept = (lbl: string) => {
    lastAcceptedRef.current = lbl
    onChange(lbl)
    setSuggestions([])
    setOpen(false)
  }

  const showList = open && suggestions.length > 0

  return (
    <label className="relative flex flex-col gap-1">
      <span className="text-xs uppercase tracking-widest text-on-surface-muted">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setTimeout(() => setOpen(false), 150) }}
        placeholder={placeholder}
        autoComplete="off"
        className="rounded-md border border-outline-variant bg-surface-high px-3 py-2 text-on-surface outline-none focus:border-primary"
      />
      {hint && <span className="text-xs text-on-surface-muted">{hint}</span>}
      {loading && value.trim().length >= 3 && !showList && (
        <span className="text-xs text-on-surface-muted">Searching…</span>
      )}
      {showList && (
        <ul className="absolute top-full z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-outline-variant bg-surface-high shadow-lg">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); accept(s.label) }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-highest"
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  )
}
