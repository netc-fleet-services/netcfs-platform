'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import {
  calculateQuote,
  formatMoney,
  type FuelSurchargeBasis,
  type PricingConfig,
} from '@/lib/pricingEngine'
import { downloadQuotePDF, generateQuotePDFBlob } from '@/lib/quotePdf'
import { AddressField } from '@/components/AddressField'
import {
  PICKUP_DROPOFF_HOURS,
  type JobLookup,
  type JobLookupResponse,
  type QuoteInputs,
  type RouteMatch,
  type ServiceCategory,
  type ServiceRate,
  type Yard,
} from '@/lib/types'

const CATEGORY_LABELS: Record<ServiceCategory, string> = {
  road_service: 'Road Service',
  light_duty:   'Light Duty Towing',
  heavy_duty:   'Heavy Duty Towing',
  transport:    'Transport',
}

const CATEGORIES: ServiceCategory[] = ['road_service', 'light_duty', 'heavy_duty', 'transport']

type Mode = 'quote' | 'lookup'

export function Calculator() {
  const [mode, setMode] = useState<Mode>('quote')
  const [rates, setRates] = useState<ServiceRate[]>([])
  const [ratesError, setRatesError] = useState<string | null>(null)
  const [fuelSurcharge, setFuelSurcharge] = useState<FuelSurchargeBasis | null>(null)
  const [fuelOverride, setFuelOverride] = useState<string | null>(null)
  const [pricingConfig, setPricingConfig] = useState<PricingConfig | null>(null)

  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase
        .from('service_rates')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true })
      if (error) { setRatesError(error.message); return }
      setRates((data ?? []) as ServiceRate[])
    })()
  }, [])

  useEffect(() => {
    ;(async () => {
      const res = await fetch('/api/fuel-surcharge')
      if (!res.ok) return
      const body = await res.json()
      if (body.percent > 0 && body.basis) {
        setFuelSurcharge({ percent: body.percent, date: body.basis.date, location: body.basis.location, product: body.basis.product, fuelTotal: body.basis.total })
      }
    })()
  }, [])

  useEffect(() => {
    ;(async () => {
      const res = await fetch('/api/pricing-config')
      if (!res.ok) return
      setPricingConfig(await res.json())
    })()
  }, [])

  const effectiveSurcharge = useMemo<FuelSurchargeBasis | null>(() => {
    if (!fuelSurcharge) return null
    if (fuelOverride === null) return fuelSurcharge
    const n = parseFloat(fuelOverride)
    return { ...fuelSurcharge, percent: isFinite(n) && n >= 0 ? n : fuelSurcharge.percent }
  }, [fuelSurcharge, fuelOverride])

  return (
    <main className="mx-auto max-w-3xl px-4 py-5 pb-20 sm:px-6 sm:py-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-on-surface-muted sm:text-sm">NETC Fleet Services</p>
          <h1 className="font-headline text-2xl sm:text-3xl">Towing Quote Calculator</h1>
        </div>
        <Link
          href="/quotes"
          className="mt-1 min-h-[40px] rounded-md border border-outline-variant bg-surface-container px-3 py-2 text-sm transition hover:bg-surface-high"
        >
          Recent quotes →
        </Link>
      </header>

      <div role="tablist" className="mb-6 inline-flex rounded-lg border border-outline-variant bg-surface-container p-1">
        <TabButton active={mode === 'quote'}  onClick={() => setMode('quote')}>Quote a call</TabButton>
        <TabButton active={mode === 'lookup'} onClick={() => setMode('lookup')}>Look at a call</TabButton>
      </div>

      {ratesError && (
        <div className="mb-6 rounded-md bg-error-container p-4 text-error">
          Couldn&apos;t load rates: {ratesError}
        </div>
      )}

      {fuelSurcharge && (
        <div className="mb-6 rounded-md border border-outline-variant bg-surface-container p-3 text-xs text-on-surface-muted">
          {fuelOverride === null ? (
            <div className="flex items-center justify-between gap-2">
              <span>
                Fuel surcharge:{' '}
                <span className="font-medium text-on-surface">{fuelSurcharge.percent.toFixed(2)}%</span>
                {' '}· updated {fuelSurcharge.date}
              </span>
              <button
                type="button"
                onClick={() => setFuelOverride(fuelSurcharge.percent.toFixed(2))}
                className="rounded border border-outline-variant bg-surface-high px-2 py-0.5 transition hover:bg-surface-highest"
              >
                Override
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span>
                Fuel surcharge:{' '}
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={fuelOverride}
                  onChange={(e) => setFuelOverride(e.target.value)}
                  className="w-16 rounded border border-outline-variant bg-surface-high px-2 py-0.5 text-on-surface outline-none focus:border-primary"
                />
                %{' '}
                <span>(calculated: {fuelSurcharge.percent.toFixed(2)}%)</span>
              </span>
              <button
                type="button"
                onClick={() => setFuelOverride(null)}
                className="transition hover:text-on-surface"
              >
                ↺ Reset
              </button>
            </div>
          )}
        </div>
      )}

      {mode === 'quote'
        ? <QuoteCallFlow rates={rates} fuelSurcharge={effectiveSurcharge} pricingConfig={pricingConfig} />
        : <LookupCallFlow rates={rates} fuelSurcharge={effectiveSurcharge} pricingConfig={pricingConfig} />
      }
    </main>
  )
}

// ─── Quote a Call ────────────────────────────────────────────────────────────

const LOAD_UNLOAD_OPTIONS = Array.from({ length: 9 }, (_, i) => i * 0.25)

function QuoteCallFlow({ rates, fuelSurcharge, pricingConfig }: { rates: ServiceRate[]; fuelSurcharge: FuelSurchargeBasis | null; pricingConfig: PricingConfig | null }) {
  const [yards, setYards]               = useState<Yard[]>([])
  const [yardId, setYardId]             = useState('')
  const [pickupAddress, setPickupAddress] = useState('')
  const [dropAddress, setDropAddress]   = useState('')
  const [extraStops, setExtraStops]     = useState<string[]>([])
  const [serviceSlug, setServiceSlug]   = useState('')
  const [loadUnload, setLoadUnload]     = useState(0.5)
  const [equipment, setEquipment]       = useState('')
  const [extraHours, setExtraHours]     = useState('')
  const [extraCharge, setExtraCharge]   = useState('')
  const [idleHours, setIdleHours]       = useState('')
  const [creditCardFee, setCreditCardFee] = useState(false)
  const [permitCost, setPermitCost]     = useState('')
  const [escortEnabled, setEscortEnabled] = useState(false)
  const [escortCost, setEscortCost]     = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [operatorNotes, setOperatorNotes] = useState('')
  const [estimateState, setEstimateState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [estimateError, setEstimateError] = useState<string | null>(null)
  const [route, setRoute] = useState<{ miles: number; hours: number; hasTolls: boolean } | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  useEffect(() => {
    ;(async () => {
      const res = await fetch('/api/yards')
      if (!res.ok) return
      const body = await res.json()
      setYards(body.yards ?? [])
      if (body.yards?.[0]) setYardId(body.yards[0].id)
    })()
  }, [])

  const selectedService = useMemo(() => rates.find((r) => r.slug === serviceSlug) ?? null, [rates, serviceSlug])

  const extraStopsKey = extraStops.join('|')
  useEffect(() => { setRoute(null); setSaveState('idle') }, [yardId, pickupAddress, dropAddress, extraStopsKey])

  const isIdleService = selectedService?.travel_hourly_rate != null
  const isTransport   = selectedService?.category === 'transport'

  const inputs = useMemo<QuoteInputs>(() => {
    if (!selectedService) return {}
    const driveHours = route?.hours ?? 0
    const extraH  = Number(extraHours) || 0
    const extraC  = Number(extraCharge) || 0
    const idle    = Number(idleHours) || 0
    const permit  = isTransport ? Number(permitCost) || 0 : 0
    const escort  = isTransport && escortEnabled ? Number(escortCost) || 0 : 0
    const cleanExtraStops = extraStops.map((s) => s.trim()).filter(Boolean)

    const base: QuoteInputs = {
      miles: route?.miles,
      extra_charge: extraC > 0 ? extraC : undefined,
      permit_cost: permit > 0 ? permit : undefined,
      escort_cost: escort > 0 ? escort : undefined,
      yard_id: yardId || undefined,
      pickup_address: pickupAddress || undefined,
      drop_address: dropAddress || undefined,
      stops: cleanExtraStops.length > 0 ? cleanExtraStops : undefined,
      equipment: equipment || undefined,
      drive_hours: route?.hours,
      has_tolls: route?.hasTolls,
      customer_name: customerName.trim() || undefined,
      customer_phone: customerPhone.trim() || undefined,
      customer_email: customerEmail.trim() || undefined,
      notes: operatorNotes.trim() || undefined,
    }

    if (isIdleService) {
      base.hours = idle
      base.travel_hours = driveHours
    } else if (selectedService.hourly_rate !== null) {
      base.hours = driveHours + loadUnload + extraH
      base.load_unload_hours = loadUnload
    } else {
      base.load_unload_hours = loadUnload
    }
    return base
  }, [selectedService, isIdleService, route, loadUnload, extraHours, extraCharge, idleHours, yardId, pickupAddress, dropAddress, extraStopsKey, extraStops, equipment, customerName, customerPhone, customerEmail, operatorNotes, isTransport, permitCost, escortEnabled, escortCost])

  const quote = useMemo(
    () => selectedService && route && pricingConfig ? calculateQuote(selectedService, inputs, pricingConfig, fuelSurcharge, creditCardFee) : null,
    [selectedService, route, pricingConfig, inputs, fuelSurcharge, creditCardFee],
  )

  const canEstimate = yardId && pickupAddress.trim() && dropAddress.trim() && serviceSlug && !!selectedService

  const handleEstimate = async () => {
    setEstimateState('loading')
    setEstimateError(null)
    const stopsPayload = [dropAddress.trim(), ...extraStops.map((s) => s.trim())].filter(Boolean)
    const res = await fetch('/api/route/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yardId, pickupAddress: pickupAddress.trim(), stops: stopsPayload }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setEstimateError(body.error ?? `Failed (${res.status})`)
      setEstimateState('error')
      return
    }
    const { route: r } = await res.json()
    setRoute(r)
    setEstimateState('idle')
  }

  const yardName = yards.find((y) => y.id === yardId)?.short

  const saveQuote = async () => {
    if (!selectedService || !quote) return
    setSaveState('saving')
    const { error } = await supabase.from('quotes').insert({
      job_id: null, tb_call_num: null,
      service_rate_id: selectedService.id,
      service_slug: selectedService.slug,
      service_name: selectedService.name,
      inputs, breakdown: quote, total: quote.total,
    })
    if (error) { setSaveState('error'); return }
    await downloadQuotePDF({ service: selectedService, inputs, quote, yardName })
    setSaveState('saved')
  }

  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const copySummary = async () => {
    if (!selectedService || !quote || !route) return
    const totalStr =
      quote.totalLow !== quote.total || quote.totalHigh !== quote.total
        ? `${formatMoney(quote.totalLow)}–${formatMoney(quote.totalHigh)}`
        : formatMoney(quote.total)
    const parts = [selectedService.name, totalStr, `${route.miles.toFixed(0)} mi`, `${route.hours.toFixed(2)} hr`]
    if (route.hasTolls) parts.push('tolls')
    await navigator.clipboard.writeText(parts.join(' · '))
    setCopyState('copied')
    setTimeout(() => setCopyState('idle'), 1500)
  }

  const shareQuote = async () => {
    if (!selectedService || !quote) return
    const { blob, filename } = await generateQuotePDFBlob({ service: selectedService, inputs, quote, yardName })
    const file = new File([blob], filename, { type: 'application/pdf' })
    const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean }
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: 'NETC Towing Quote', text: `${selectedService.name} — ${formatMoney(quote.total)}` })
        return
      } catch { /* fall through */ }
    }
    await downloadQuotePDF({ service: selectedService, inputs, quote, yardName })
    const subject = encodeURIComponent(`NETC Towing Quote — ${selectedService.name}`)
    const body = encodeURIComponent(`Please find attached your towing quote.\n\nService: ${selectedService.name}\nEstimate: ${formatMoney(quote.totalLow)} – ${formatMoney(quote.totalHigh)}\n\n— NETC Fleet Services`)
    window.location.href = `mailto:${customerEmail || ''}?subject=${subject}&body=${body}`
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-surface-container p-5">
        <h2 className="mb-4 font-headline text-xl">Route</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-on-surface-muted">Yard</span>
            <select
              value={yardId}
              onChange={(e) => setYardId(e.target.value)}
              className="rounded-md border border-outline-variant bg-surface-high px-3 py-2 outline-none focus:border-primary"
            >
              {yards.length === 0 && <option value="">Loading…</option>}
              {yards.map((y) => <option key={y.id} value={y.id}>{y.short}</option>)}
            </select>
          </label>
          <AddressField label="Pickup address" value={pickupAddress} onChange={setPickupAddress} placeholder="123 Main St, Saco, ME" />
          <AddressField label="Drop address"   value={dropAddress}   onChange={setDropAddress}   placeholder="456 Oak Ave, Portsmouth, NH" />
          {extraStops.map((s, i) => (
            <div key={i} className="flex items-end gap-2 sm:col-span-2">
              <div className="flex-1">
                <AddressField
                  label={`Stop ${i + 2}`}
                  value={s}
                  onChange={(v) => setExtraStops((prev) => { const next = [...prev]; next[i] = v; return next })}
                  placeholder="Additional stop address"
                />
              </div>
              <button
                type="button"
                onClick={() => setExtraStops((prev) => prev.filter((_, j) => j !== i))}
                className="min-h-[44px] rounded-md border border-outline-variant bg-surface-high px-3 text-sm transition hover:bg-surface-highest"
                aria-label={`Remove stop ${i + 2}`}
              >×</button>
            </div>
          ))}
          <div className="sm:col-span-2">
            <button
              type="button"
              onClick={() => setExtraStops((prev) => [...prev, ''])}
              className="rounded-md border border-dashed border-outline-variant px-3 py-2 text-sm text-on-surface-muted transition hover:bg-surface-high hover:text-on-surface"
            >
              + Add stop
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-lg bg-surface-container p-5">
        <h2 className="mb-4 font-headline text-xl">Service</h2>
        <ServicePicker rates={rates} selectedSlug={serviceSlug} onSelect={setServiceSlug} />
      </section>

      {selectedService && (
        <section className="rounded-lg bg-surface-container p-5">
          <h2 className="mb-4 font-headline text-xl">Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {isIdleService ? (
              <>
                <TextField label="Idle hours (on-scene)" value={idleHours} onChange={setIdleHours} placeholder="0" type="number" step="0.25" hint={`billed at ${formatMoney(selectedService.hourly_rate ?? 0)}/hr. Travel is auto-calculated.`} />
                <TextField label="Equipment" value={equipment} onChange={setEquipment} placeholder="e.g. CAT 285 Skidsteer" />
                <TextField label="Extra charge ($)" value={extraCharge} onChange={setExtraCharge} placeholder="0" type="number" step="0.01" />
              </>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-widest text-on-surface-muted">Load / unload time</span>
                  <select
                    value={loadUnload}
                    onChange={(e) => setLoadUnload(Number(e.target.value))}
                    className="rounded-md border border-outline-variant bg-surface-high px-3 py-2 outline-none focus:border-primary"
                  >
                    {LOAD_UNLOAD_OPTIONS.map((v) => <option key={v} value={v}>{formatHours(v)}</option>)}
                  </select>
                  <span className="text-xs text-on-surface-muted">15-min intervals, 0 – 2 hr</span>
                </label>
                <TextField label="Equipment" value={equipment} onChange={setEquipment} placeholder="e.g. CAT 285 Skidsteer" />
                {selectedService.hourly_rate !== null && (
                  <TextField label="Extra hours" value={extraHours} onChange={setExtraHours} placeholder="0" type="number" step="0.25" hint={`billed at ${formatMoney(selectedService.hourly_rate)}/hr`} />
                )}
                <TextField label="Extra charge ($)" value={extraCharge} onChange={setExtraCharge} placeholder="0" type="number" step="0.01" />
              </>
            )}
          </div>

          {isTransport && (
            <div className="mt-5 border-t border-outline-variant pt-5">
              <h3 className="mb-3 text-xs uppercase tracking-widest text-on-surface-muted">Transport extras</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField label="Permit estimate ($)" value={permitCost} onChange={setPermitCost} placeholder="0" type="number" step="0.01" hint="Pass-through; discretionary" />
                <div className="flex flex-col gap-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" checked={escortEnabled} onChange={(e) => setEscortEnabled(e.target.checked)} className="h-4 w-4 accent-primary" />
                    <span>Escort required</span>
                  </label>
                  {escortEnabled && (
                    <TextField label="Escort cost ($)" value={escortCost} onChange={setEscortCost} placeholder="0" type="number" step="0.01" hint="Billed at cost + 25%" />
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {selectedService && (
        <section className="rounded-lg bg-surface-container p-5">
          <details>
            <summary className="cursor-pointer text-sm font-medium text-on-surface-muted hover:text-on-surface">
              Customer info (optional)
            </summary>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <TextField label="Name"  value={customerName}  onChange={setCustomerName}  placeholder="Jane Smith" />
              <TextField label="Phone" value={customerPhone} onChange={setCustomerPhone} placeholder="(555) 555-0123" type="tel" />
              <TextField label="Email" value={customerEmail} onChange={setCustomerEmail} placeholder="jane@example.com" type="email" />
            </div>
          </details>
        </section>
      )}

      {selectedService && (
        <section className="rounded-lg bg-surface-container p-5">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-on-surface-muted">Operator notes (optional)</span>
            <textarea
              value={operatorNotes}
              onChange={(e) => setOperatorNotes(e.target.value)}
              rows={3}
              placeholder="Internal context — who booked this, special requests, etc."
              className="rounded-md border border-outline-variant bg-surface-high px-3 py-2 text-on-surface outline-none focus:border-primary"
            />
          </label>
        </section>
      )}

      <section>
        <button
          type="button"
          onClick={handleEstimate}
          disabled={!canEstimate || estimateState === 'loading'}
          className="min-h-[44px] w-full rounded-md bg-primary px-5 py-3 font-medium text-on-primary transition hover:brightness-110 disabled:opacity-50"
        >
          {estimateState === 'loading' ? 'Fetching route from GraphHopper…' : route ? 'Re-fetch route' : 'Get quote'}
        </button>
        {estimateError && <p className="mt-3 text-sm text-error">{estimateError}</p>}
      </section>

      {route && selectedService && quote && (
        <section className="rounded-lg bg-surface-container p-5">
          <h2 className="mb-2 font-headline text-xl">Quote</h2>
          <div className="mb-4 grid grid-cols-2 gap-3 rounded-md bg-surface-high p-3 text-sm sm:grid-cols-4">
            <Metric label="Drive" value={`${route.hours.toFixed(2)} hr`} />
            <Metric label="Miles" value={route.miles.toFixed(1)} />
            <Metric label="Tolls" value={route.hasTolls ? 'YES' : 'No'} emphasis={route.hasTolls} />
            <Metric label="Source" value="GraphHopper" />
          </div>
          {route.hasTolls && (
            <div className="mb-4 rounded-md border border-error bg-error-container/20 p-3 text-sm">
              <span className="font-medium text-error">Route has tolls.</span>{' '}
              Estimate the toll amount and add it to the <span className="font-medium">Extra charge ($)</span> field above.
            </div>
          )}
          <QuoteBreakdownDisplay quote={quote} />
          <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={creditCardFee} onChange={(e) => setCreditCardFee(e.target.checked)} className="h-4 w-4 accent-primary" />
            <span>Paying by credit card (+{pricingConfig?.credit_card_fee_percent.toFixed(1) ?? '…'}% processing fee)</span>
          </label>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button type="button" onClick={saveQuote} disabled={saveState === 'saving'} className="min-h-[44px] rounded-md bg-primary px-4 py-2 font-medium text-on-primary transition hover:brightness-110 disabled:opacity-50">
              {saveState === 'saving' ? 'Saving…' : 'Save + PDF'}
            </button>
            <button type="button" onClick={copySummary} className="min-h-[44px] rounded-md border border-outline-variant bg-surface-high px-4 py-2 font-medium transition hover:bg-surface-highest">
              {copyState === 'copied' ? 'Copied ✓' : 'Copy summary'}
            </button>
            <button type="button" onClick={shareQuote} className="min-h-[44px] rounded-md border border-outline-variant bg-surface-high px-4 py-2 font-medium transition hover:bg-surface-highest">
              Share / email
            </button>
            {saveState === 'saved'  && <span className="text-sm text-on-surface-muted">Saved.</span>}
            {saveState === 'error'  && <span className="text-sm text-error">Save failed.</span>}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Look at a Call ───────────────────────────────────────────────────────────

function LookupCallFlow({ rates, fuelSurcharge, pricingConfig }: { rates: ServiceRate[]; fuelSurcharge: FuelSurchargeBasis | null; pricingConfig: PricingConfig | null }) {
  const [callInput, setCallInput] = useState('')
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [job, setJob] = useState<JobLookup | null>(null)
  const [route, setRoute] = useState<RouteMatch | null>(null)
  const [selectedSlug, setSelectedSlug] = useState('')
  const [inputs, setInputs] = useState<QuoteInputs>({})
  const [creditCardFee, setCreditCardFee] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const selected = useMemo(() => rates.find((r) => r.slug === selectedSlug) ?? null, [rates, selectedSlug])
  const quote = useMemo(() => selected && pricingConfig ? calculateQuote(selected, inputs, pricingConfig, fuelSurcharge, creditCardFee) : null, [selected, pricingConfig, inputs, fuelSurcharge, creditCardFee])

  const lookupJob = async () => {
    const value = callInput.trim()
    if (!value) return
    setLookupState('loading')
    setLookupError(null)
    setSaveState('idle')
    const res = await fetch(`/api/jobs/${encodeURIComponent(value)}`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setLookupError(body.error ?? `Lookup failed (${res.status})`)
      setLookupState('error')
      setJob(null)
      setRoute(null)
      return
    }
    const { job: j, route: r } = (await res.json()) as JobLookupResponse
    setJob(j)
    setRoute(r)
    setLookupState('idle')
    setSelectedSlug('')
    setInputs(r ? { miles: round2(r.miles) } : {})
  }

  useEffect(() => {
    if (!selected || !route) return
    setInputs((prev) => {
      const next: QuoteInputs = { ...prev }
      if (selected.travel_hourly_rate !== null) {
        if (next.travel_hours === undefined) next.travel_hours = round2(route.hours)
      } else if (selected.hourly_rate !== null) {
        if (next.hours === undefined) next.hours = round2(route.hours + PICKUP_DROPOFF_HOURS)
      }
      return next
    })
  }, [selected, route])

  const setField = (key: keyof QuoteInputs, value: string) => {
    const n = value === '' ? undefined : Number(value)
    setInputs((prev) => ({ ...prev, [key]: Number.isFinite(n) ? n : undefined }))
    setSaveState('idle')
  }

  const saveQuote = async () => {
    if (!selected || !quote) return
    setSaveState('saving')
    const { error } = await supabase.from('quotes').insert({
      job_id: job?.id ?? null,
      tb_call_num: job?.tb_call_num ?? null,
      service_rate_id: selected.id,
      service_slug: selected.slug,
      service_name: selected.name,
      inputs, breakdown: quote, total: quote.total,
    })
    if (error) { setSaveState('error'); return }
    await downloadQuotePDF({ service: selected, inputs, quote, callNum: job?.tb_call_num, yardName: job?.yard_id ?? undefined })
    setSaveState('saved')
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-surface-container p-5">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-on-surface-muted">Call number</h2>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); lookupJob() }}>
          <input
            value={callInput}
            onChange={(e) => setCallInput(e.target.value)}
            placeholder="#308207"
            className="flex-1 rounded-md border border-outline-variant bg-surface-high px-3 py-2 outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={lookupState === 'loading' || !callInput.trim()}
            className="rounded-md bg-primary px-4 py-2 font-medium text-on-primary transition hover:brightness-110 disabled:opacity-50"
          >
            {lookupState === 'loading' ? 'Looking up…' : 'Look up'}
          </button>
        </form>
        {lookupError && <p className="mt-3 text-sm text-error">{lookupError}</p>}
      </section>

      {job && (
        <section className="rounded-lg bg-surface-container p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-headline text-xl">{job.tb_call_num ?? '(no call #)'}</h2>
            <span className="text-xs uppercase tracking-widest text-on-surface-muted">{job.status}</span>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Detail label="Description" value={job.tb_desc} />
            <Detail label="Reason"      value={job.tb_reason} />
            <Detail label="Account"     value={job.tb_account} />
            <Detail label="Scheduled"   value={job.tb_scheduled ?? job.day} />
            <Detail label="Driver"      value={job.tb_driver} />
            <Detail label="Yard"        value={job.yard_id} />
            <Detail label="Pickup"      value={job.pickup_addr} full />
            <Detail label="Drop"        value={job.drop_addr}   full />
          </dl>
          <div className="mt-4 rounded-md bg-surface-high p-3 text-sm">
            {route ? (
              <>
                <span className="font-medium">Cached route:</span>{' '}
                {route.miles.toFixed(1)} mi · {route.hours.toFixed(2)} hr drive{' '}
                <span className="text-on-surface-muted">→ {(route.hours + PICKUP_DROPOFF_HOURS).toFixed(2)} hr billable (+1 hr pickup/dropoff)</span>
              </>
            ) : (
              <span className="text-on-surface-muted">No cached route for this job. Enter miles and hours manually, or switch to &quot;Quote a call&quot; to estimate via GraphHopper.</span>
            )}
          </div>
        </section>
      )}

      {job && (
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-on-surface-muted">Service</h2>
          <ServicePicker
            rates={rates}
            selectedSlug={selectedSlug}
            onSelect={(slug) => { setSelectedSlug(slug); setInputs((prev) => ({ miles: prev.miles })); setSaveState('idle') }}
          />
        </section>
      )}

      {selected && (
        <section className="rounded-lg bg-surface-container p-5">
          <h2 className="mb-4 font-headline text-xl">{selected.name}</h2>
          {selected.notes && <p className="mb-4 text-sm text-on-surface-muted">{selected.notes}</p>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {selected.hourly_rate !== null && (
              <NumberField label="Hours" hint={[selected.minimum_hours ? `${selected.minimum_hours} hr min` : null, route && selected.travel_hourly_rate === null ? 'auto: drive + 1 hr' : null].filter(Boolean).join(' · ')} value={inputs.hours} onChange={(v) => setField('hours', v)} step="0.25" />
            )}
            {(selected.per_mile_rate !== null || selected.travel_per_mile_rate !== null) && (
              <NumberField label="Miles" hint={route ? 'auto from cached route' : undefined} value={inputs.miles} onChange={(v) => setField('miles', v)} step="1" />
            )}
            {selected.travel_hourly_rate !== null && (
              <NumberField label="Travel hours" hint={route ? 'auto: drive time only' : undefined} value={inputs.travel_hours} onChange={(v) => setField('travel_hours', v)} step="0.25" />
            )}
            {selected.parts_applicable && (
              <NumberField label="Parts cost ($)" value={inputs.parts_cost} onChange={(v) => setField('parts_cost', v)} step="0.01" />
            )}
          </div>
        </section>
      )}

      {selected && quote && quote.lines.length > 0 && (
        <section className="rounded-lg bg-surface-container p-5">
          <h2 className="mb-4 font-headline text-xl">Quote</h2>
          <QuoteBreakdownDisplay quote={quote} />
          <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={creditCardFee} onChange={(e) => setCreditCardFee(e.target.checked)} className="h-4 w-4 accent-primary" />
            <span>Paying by credit card (+{pricingConfig?.credit_card_fee_percent.toFixed(1) ?? '…'}% processing fee)</span>
          </label>
          <div className="mt-5 flex items-center gap-3">
            <button type="button" onClick={saveQuote} disabled={saveState === 'saving'} className="rounded-md bg-primary px-4 py-2 font-medium text-on-primary transition hover:brightness-110 disabled:opacity-50">
              {saveState === 'saving' ? 'Saving…' : 'Save quote'}
            </button>
            {saveState === 'saved' && <span className="text-sm text-on-surface-muted">Saved.</span>}
            {saveState === 'error' && <span className="text-sm text-error">Save failed.</span>}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Shared components ────────────────────────────────────────────────────────

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={['rounded-md px-4 py-2 text-sm font-medium transition', active ? 'bg-primary text-on-primary' : 'text-on-surface-muted hover:text-on-surface'].join(' ')}
    >
      {children}
    </button>
  )
}

function ServicePicker({ rates, selectedSlug, onSelect }: { rates: ServiceRate[]; selectedSlug: string; onSelect: (slug: string) => void }) {
  const defaultCategory: ServiceCategory = useMemo(() => {
    const selectedCat = rates.find((r) => r.slug === selectedSlug)?.category
    if (selectedCat) return selectedCat
    return CATEGORIES.find((c) => rates.some((r) => r.category === c)) ?? 'heavy_duty'
  }, [rates, selectedSlug])
  const [category, setCategory] = useState<ServiceCategory>(defaultCategory)

  useEffect(() => {
    if (!selectedSlug) return
    const selectedCat = rates.find((r) => r.slug === selectedSlug)?.category
    if (selectedCat && selectedCat !== category) setCategory(selectedCat)
  }, [selectedSlug, rates, category])

  const services = useMemo(() => rates.filter((r) => r.category === category), [rates, category])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={['rounded-md border px-3 py-3 text-sm font-medium transition', category === cat ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant bg-surface-container hover:bg-surface-high'].join(' ')}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>
      {services.length === 0 ? (
        <div className="rounded-md border border-dashed border-outline-variant bg-surface-container p-4 text-sm text-on-surface-muted">
          No services configured for {CATEGORY_LABELS[category]} yet. Ask an admin to add rates in Supabase.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {services.map((r) => (
            <button
              key={r.slug}
              type="button"
              onClick={() => onSelect(r.slug)}
              className={['rounded-md border px-4 py-3 text-left transition', r.slug === selectedSlug ? 'border-primary bg-surface-high' : 'border-outline-variant bg-surface-container hover:bg-surface-high'].join(' ')}
            >
              <div className="font-medium">{r.name}</div>
              <div className="mt-1 text-xs text-on-surface-muted">{summarizeRate(r)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function QuoteBreakdownDisplay({ quote }: { quote: { lines: Array<{ label: string; detail: string; amount: number }>; total: number; totalLow: number; totalHigh: number } }) {
  const showRange = quote.totalLow !== quote.total || quote.totalHigh !== quote.total
  return (
    <>
      <ul className="divide-y divide-outline-variant">
        {quote.lines.map((line, i) => (
          <li key={i} className="flex justify-between py-2">
            <div>
              <div className="font-medium">{line.label}</div>
              <div className="text-xs text-on-surface-muted">{line.detail}</div>
            </div>
            <div className="font-medium tabular-nums">{formatMoney(line.amount)}</div>
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-outline pt-4">
        <div className="flex items-center justify-between">
          <span className="font-headline text-lg">Estimate</span>
          {showRange ? (
            <span className="font-headline text-2xl tabular-nums">{formatMoney(quote.totalLow)} – {formatMoney(quote.totalHigh)}</span>
          ) : (
            <span className="font-headline text-2xl tabular-nums">{formatMoney(quote.total)}</span>
          )}
        </div>
        {showRange && <p className="mt-1 text-right text-xs text-on-surface-muted">Range reflects ±20 min drive-time and ±15 mi variance</p>}
      </div>
    </>
  )
}

function Metric({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-on-surface-muted">{label}</div>
      <div className={['mt-0.5 font-medium tabular-nums', emphasis ? 'text-error' : ''].join(' ')}>{value}</div>
    </div>
  )
}

function TextField({ label, value, onChange, placeholder, type = 'text', step, hint, disabled }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; step?: string; hint?: string; disabled?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-widest text-on-surface-muted">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} step={step} disabled={disabled} className="rounded-md border border-outline-variant bg-surface-high px-3 py-2 text-on-surface outline-none focus:border-primary disabled:opacity-50" />
      {hint && <span className="text-xs text-on-surface-muted">{hint}</span>}
    </label>
  )
}

function NumberField({ label, hint, value, onChange, step }: { label: string; hint?: string; value: number | undefined; onChange: (v: string) => void; step?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-widest text-on-surface-muted">{label}</span>
      <input type="number" inputMode="decimal" min="0" step={step} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-outline-variant bg-surface-high px-3 py-2 text-on-surface outline-none focus:border-primary" />
      {hint && <span className="text-xs text-on-surface-muted">{hint}</span>}
    </label>
  )
}

function Detail({ label, value, full }: { label: string; value: string | null | undefined; full?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs uppercase tracking-widest text-on-surface-muted">{label}</dt>
      <dd className="mt-0.5">{value?.trim() ? value : '—'}</dd>
    </div>
  )
}

function summarizeRate(r: ServiceRate): string {
  const parts: string[] = []
  if (r.flat_rate !== null) parts.push(`${formatMoney(r.flat_rate)} flat`)
  if (r.hourly_rate !== null) {
    const m = r.minimum_hours ? ` (${r.minimum_hours} hr min)` : ''
    parts.push(`${formatMoney(r.hourly_rate)}/hr${m}`)
  }
  if (r.hookup_fee !== null) parts.push(`${formatMoney(r.hookup_fee)} hookup`)
  if (r.per_mile_rate !== null) parts.push(`${formatMoney(r.per_mile_rate)}/mi`)
  if (r.travel_per_mile_rate !== null) parts.push(`${formatMoney(r.travel_per_mile_rate)}/mi travel`)
  if (r.travel_hourly_rate !== null) parts.push(`${formatMoney(r.travel_hourly_rate)}/hr travel`)
  return parts.join(' · ')
}

function formatHours(h: number): string {
  if (h === 0) return '0 min'
  const hrs  = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  if (hrs === 0) return `${mins} min`
  if (mins === 0) return `${hrs} hr`
  return `${hrs} hr ${mins} min`
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
