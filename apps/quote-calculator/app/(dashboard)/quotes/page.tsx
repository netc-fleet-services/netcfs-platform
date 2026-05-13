'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { downloadQuotePDF } from '@/lib/quotePdf'
import type { QuoteBreakdown, QuoteInputs, ServiceRate } from '@/lib/types'

interface QuoteRow {
  id: string
  job_id: string | null
  tb_call_num: string | null
  service_rate_id: string | null
  service_slug: string
  service_name: string
  inputs: QuoteInputs
  breakdown: QuoteBreakdown
  total: number
  created_at: string
}

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [rates, setRates]   = useState<ServiceRate[]>([])
  const [error, setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const [quotesRes, ratesRes] = await Promise.all([
        supabase.from('quotes').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('service_rates').select('*'),
      ])
      if (quotesRes.error) setError(quotesRes.error.message)
      else setQuotes((quotesRes.data ?? []) as QuoteRow[])
      setRates((ratesRes.data ?? []) as ServiceRate[])
      setLoading(false)
    })()
  }, [])

  const reDownload = (row: QuoteRow) => {
    const rate = rates.find((r) => r.id === row.service_rate_id)
    if (!rate) { alert('Original service rate not found (may have been deleted).'); return }
    downloadQuotePDF({ service: rate, inputs: row.inputs, quote: row.breakdown, callNum: row.tb_call_num, yardName: row.inputs.yard_id })
  }

  return (
    <main className="mx-auto max-w-4xl p-6 pb-16">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-widest text-on-surface-muted">NETC Fleet Services</p>
          <h1 className="font-headline text-3xl">Recent quotes</h1>
        </div>
        <Link
          href="/"
          className="mt-2 rounded-md border border-outline-variant bg-surface-container px-3 py-2 text-sm transition hover:bg-surface-high"
        >
          ← Back to calculator
        </Link>
      </header>

      {loading && <p className="text-on-surface-muted">Loading quotes…</p>}
      {error && <div className="rounded-md bg-error-container p-4 text-error">{error}</div>}
      {!loading && !error && quotes.length === 0 && <p className="text-on-surface-muted">No quotes saved yet.</p>}

      {quotes.length > 0 && (
        <ul className="space-y-2">
          {quotes.map((q) => (
            <li key={q.id} className="rounded-lg border border-outline-variant bg-surface-container p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{q.service_name}</span>
                    {q.tb_call_num && (
                      <span className="rounded bg-surface-high px-2 py-0.5 font-mono text-xs">{q.tb_call_num}</span>
                    )}
                    {q.inputs.customer_name && (
                      <span className="text-sm text-on-surface-muted">· {q.inputs.customer_name}</span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-on-surface-muted">
                    {formatDate(q.created_at)}
                    {q.inputs.pickup_address && q.inputs.drop_address && (
                      <> · {shortAddr(q.inputs.pickup_address)} → {shortAddr(q.inputs.drop_address)}</>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium tabular-nums">{formatMoney(q.total)}</span>
                  <button
                    type="button"
                    onClick={() => reDownload(q)}
                    className="rounded-md border border-outline-variant bg-surface-high px-3 py-1.5 text-sm transition hover:bg-surface-highest"
                  >
                    PDF
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function shortAddr(addr: string): string {
  const first = addr.split(',')[0]?.trim() ?? addr
  return first.length > 30 ? first.slice(0, 30) + '…' : first
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
