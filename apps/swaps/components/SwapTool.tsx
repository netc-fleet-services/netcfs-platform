'use client'

import { useState, useMemo } from 'react'
import {
  DEFAULTS, FIELDS,
  money, num, parseN, fmtIn, mLabel, buildPath,
  projectFromData, validateData, buildCSVString,
  type ModelValues,
} from '@/lib/model'

// SVG chart builders — return HTML strings via dangerouslySetInnerHTML

function valueChartSVG(months: ReturnType<typeof projectFromData>['months'], crossover: ReturnType<typeof projectFromData>['crossover'], purchasePrice: number): string {
  const W=760, H=300, padL=80, padR=30, padT=20, padB=42
  const innerW = W-padL-padR, innerH = H-padT-padB
  const valueLine = months.map(m => ({ x: m.m, y: m.resaleValue }))
  const costLine  = months.map(m => ({ x: m.m, y: m.cumOpCost  }))
  const yMax   = Math.max(purchasePrice, ...costLine.map(p => p.y)) * 1.08
  const xScale = (x: number) => padL + (x / 96) * innerW
  const yScale = (y: number) => padT + innerH - (y / yMax) * innerH

  const STYLE = `<style>
    .cg{stroke:rgb(var(--outline-variant))}
    .cl{fill:rgb(var(--on-surface-muted));font-family:'Inter',sans-serif}
    .m-bg{fill:rgb(var(--primary-container))}
    .m-at{fill:rgb(var(--on-primary-container));font-family:'Inter',sans-serif;font-size:11px}
    .m-mt{fill:rgb(var(--on-surface));font-family:'Inter',sans-serif;font-size:12px;font-weight:700}
    .m-do{fill:rgb(var(--on-surface-muted));stroke:rgb(var(--primary))}
  </style>`

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;overflow:visible">${STYLE}`
  for (let i = 0; i <= 4; i++) {
    const val = yMax/4*i, y = yScale(val)
    svg += `<line class="cg" x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}"/>`
    svg += `<text class="cl" x="${padL-10}" y="${y+4}" text-anchor="end" font-size="11">${money(val)}</text>`
  }
  for (let y = 1; y <= 8; y++) {
    const x = xScale(y*12)
    svg += `<line class="cg" x1="${x}" y1="${padT+innerH}" x2="${x}" y2="${padT+innerH+4}"/>`
    svg += `<text class="cl" x="${x}" y="${padT+innerH+20}" text-anchor="middle" font-size="11">Year ${y}</text>`
  }
  const costArea = buildPath(costLine, xScale, yScale) + ` L${xScale(96)},${yScale(0)} L${xScale(0)},${yScale(0)} Z`
  svg += `<path d="${costArea}" fill="#C2410C" fill-opacity="0.08"/>`
  svg += `<path d="${buildPath(valueLine, xScale, yScale)}" fill="none" stroke="#5B89D6" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`
  svg += `<path d="${buildPath(costLine,  xScale, yScale)}" fill="none" stroke="#C2410C" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`
  if (crossover) {
    const cx = xScale(crossover.m), cy = yScale(crossover.resaleValue)
    svg += `<line class="m-do" x1="${cx}" y1="${padT}" x2="${cx}" y2="${padT+innerH}" stroke-width="1.5" stroke-dasharray="5 4"/>`
    svg += `<circle cx="${cx}" cy="${cy}" r="6" class="m-bg" stroke-width="2"/>`
    const lx = cx+10 > W-padR-140 ? cx-148 : cx+10
    svg += `<rect class="m-bg" x="${lx}" y="${padT+6}" width="140" height="38" rx="4"/>`
    svg += `<text class="m-at" x="${lx+8}" y="${padT+22}">CROSSOVER</text>`
    svg += `<text class="m-mt" x="${lx+8}" y="${padT+37}">${mLabel(crossover.m)}</text>`
  }
  return svg + '</svg>'
}

function costChartSVG(months: ReturnType<typeof projectFromData>['months'], opt: ReturnType<typeof projectFromData>['opt']): string {
  const W=760, H=260, padL=80, padR=30, padT=20, padB=42
  const innerW = W-padL-padR, innerH = H-padT-padB
  const data = months.filter(m => m.m >= 24).map(m => ({ x: m.m, y: m.costPerYear }))
  const yMin = Math.min(...data.map(d => d.y)) * 0.95
  const yMax = Math.max(...data.map(d => d.y)) * 1.05
  const xScale = (x: number) => padL + ((x-24) / (96-24)) * innerW
  const yScale = (y: number) => padT + innerH - ((y-yMin) / (yMax-yMin)) * innerH

  const STYLE = `<style>
    .cg2{stroke:rgb(var(--outline-variant))}
    .cl2{fill:rgb(var(--on-surface-muted));font-family:'Inter',sans-serif}
    .m-bg2{fill:rgb(var(--primary-container))}
    .m-at2{fill:rgb(var(--on-primary-container));font-family:'Inter',sans-serif;font-size:11px}
    .m-mt2{fill:rgb(var(--on-surface));font-family:'Inter',sans-serif;font-size:12px;font-weight:700}
    .m-do2{fill:rgb(var(--on-surface-muted));stroke:rgb(var(--primary))}
  </style>`

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;overflow:visible">${STYLE}`
  for (let i = 0; i <= 4; i++) {
    const val = yMin+(yMax-yMin)/4*i, y = yScale(val)
    svg += `<line class="cg2" x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}"/>`
    svg += `<text class="cl2" x="${padL-10}" y="${y+4}" text-anchor="end" font-size="11">${money(val)}</text>`
  }
  for (let y = 2; y <= 8; y++) {
    const x = xScale(y*12)
    svg += `<line class="cg2" x1="${x}" y1="${padT+innerH}" x2="${x}" y2="${padT+innerH+4}"/>`
    svg += `<text class="cl2" x="${x}" y="${padT+innerH+20}" text-anchor="middle" font-size="11">Year ${y}</text>`
  }
  const area = buildPath(data, xScale, yScale) + ` L${xScale(data[data.length-1].x)},${padT+innerH} L${xScale(data[0].x)},${padT+innerH} Z`
  svg += `<path d="${area}" fill="rgb(var(--primary) / 0.07)"/>`
  svg += `<path d="${buildPath(data, xScale, yScale)}" fill="none" stroke="rgb(var(--primary))" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`
  const ox = xScale(opt.m), oy = yScale(opt.costPerYear)
  svg += `<line class="m-do2" x1="${ox}" y1="${padT}" x2="${ox}" y2="${padT+innerH}" stroke-width="2" stroke-dasharray="5 4"/>`
  svg += `<circle cx="${ox}" cy="${oy}" r="7" class="m-bg2" stroke-width="2"/>`
  const lx = ox+10 > W-padR-160 ? ox-168 : ox+10
  svg += `<rect class="m-bg2" x="${lx}" y="${oy-44}" width="160" height="40" rx="4"/>`
  svg += `<text class="m-at2" x="${lx+8}" y="${oy-28}">OPTIMAL SWAP</text>`
  svg += `<text class="m-mt2" x="${lx+8}" y="${oy-12}">${mLabel(opt.m)} · ${money(opt.costPerYear)}/yr</text>`
  return svg + '</svg>'
}

function initInputs(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of FIELDS) out[f] = fmtIn(DEFAULTS[f], f)
  return out
}

export function SwapTool() {
  const [inputs, setInputs] = useState<Record<string, string>>(initInputs)
  const [condition, setCondition] = useState('typical')

  const values: ModelValues = useMemo(() => {
    const v = {} as ModelValues
    for (const f of FIELDS) (v as unknown as Record<string, number>)[f] = parseN(inputs[f] ?? '0')
    return v
  }, [inputs])

  const { warnings, invalidFields } = useMemo(() => validateData(values), [values])
  const result = useMemo(() => projectFromData(values, condition), [values, condition])
  const { months, opt, crossover, scenarios, winnerYearly, yearRows } = result

  function handleBlur(f: string) {
    setInputs(prev => ({ ...prev, [f]: fmtIn(parseN(prev[f] ?? '0'), f) }))
  }

  function handleReset() {
    const fresh: Record<string, string> = {}
    for (const f of FIELDS) fresh[f] = fmtIn(DEFAULTS[f], f)
    setInputs(fresh)
    setCondition('typical')
  }

  function handleExport() {
    const csv = buildCSVString(scenarios, opt)
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `fleet-swap-${new Date().toISOString().slice(0, 10)}.csv`,
    })
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div>
      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="fsm-warnings">
          <strong style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Check these assumptions</strong>
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Summary cards */}
      <div className="fsm-cards">
        <div className="fsm-card fsm-card-hl">
          <div className="fsm-card-label">Recommended Swap</div>
          <div className="fsm-card-value">{mLabel(opt.m)}</div>
        </div>
        <div className="fsm-card">
          <div className="fsm-card-label">Cost / Year at Optimum</div>
          <div className="fsm-card-value">{money(opt.costPerYear)}</div>
        </div>
        <div className="fsm-card">
          <div className="fsm-card-label">Miles at Swap</div>
          <div className="fsm-card-value">{num(opt.cumMiles)}</div>
        </div>
        <div className="fsm-card">
          <div className="fsm-card-label">Resale Recovered</div>
          <div className="fsm-card-value">{money(opt.resaleValue)}</div>
        </div>
      </div>

      {/* Main grid */}
      <div className="fsm-grid">
        {/* Left panel — inputs */}
        <div className="fsm-panel">
          <p className="fsm-panel-title">Assumptions</p>

          {([
            ['purchasePrice',   'Purchase Price ($)',              'Total out-the-door cost including tax and upfit.'],
            ['annualMiles',     'Annual Miles',                    'Expected miles driven per year. Drives downtime growth.'],
            ['baseMaintenance', 'Base Maintenance Year 1 ($)',     'Maintenance spend in the first year of service.'],
            ['maintEscalation', 'Maintenance Escalation (%/yr)',   'How much yearly maintenance grows each year.'],
            ['revenuePerDay',   'Revenue per Operating Day ($)',   'Revenue the truck generates on a normal working day.'],
          ] as [string, string, string][]).map(([f, label, tip]) => (
            <label key={f} className="fsm-label">
              {label} <span className="fsm-help" title={tip}>?</span>
              <input
                type="text"
                inputMode="decimal"
                className={`fsm-field${invalidFields.has(f) ? ' fsm-invalid' : ''}`}
                value={inputs[f] ?? ''}
                onChange={e => setInputs(prev => ({ ...prev, [f]: e.target.value }))}
                onBlur={() => handleBlur(f)}
              />
            </label>
          ))}

          <label className="fsm-label">
            Operating Conditions <span className="fsm-help" title="How hard the truck gets worked.">?</span>
            <select
              className="fsm-field"
              value={condition}
              onChange={e => setCondition(e.target.value)}
            >
              <option value="easy">Easy — highway miles, light loads</option>
              <option value="typical">Typical — mixed duty</option>
              <option value="punishing">Punishing — heavy loads, rough terrain</option>
            </select>
          </label>

          <p className="fsm-panel-title" style={{ marginTop: '1.25rem' }}>Resale Value by Year</p>
          {[2, 3, 4, 5, 6, 7, 8].map(y => {
            const f = `resaleY${y}`
            return (
              <label key={f} className="fsm-label">
                Year {y} (%)
                <input
                  type="text"
                  inputMode="decimal"
                  className={`fsm-field${invalidFields.has(f) ? ' fsm-invalid' : ''}`}
                  value={inputs[f] ?? ''}
                  onChange={e => setInputs(prev => ({ ...prev, [f]: e.target.value }))}
                  onBlur={() => handleBlur(f)}
                />
              </label>
            )
          })}

          <div className="fsm-actions">
            <button className="btn-secondary" style={{ fontSize: '0.8rem' }} onClick={handleReset}>Reset Defaults</button>
          </div>
        </div>

        {/* Right — charts + results */}
        <div>
          <div className="fsm-panel">
            <p className="fsm-chart-title">Truck Value vs. Money Spent Keeping It</p>
            <div dangerouslySetInnerHTML={{ __html: valueChartSVG(months, crossover, values.purchasePrice) }} />
            <div className="fsm-legend">
              <span><span className="fsm-swatch" style={{ background: '#5B89D6' }} />Resale Value</span>
              <span><span className="fsm-swatch" style={{ background: '#C2410C' }} />Cumulative Cost to Operate</span>
              <span><span className="fsm-swatch" style={{ background: 'rgb(var(--primary))' }} />Crossover Point</span>
            </div>
          </div>

          <div className="fsm-panel">
            <p className="fsm-chart-title">Annual Cost of Ownership</p>
            <div dangerouslySetInnerHTML={{ __html: costChartSVG(months, opt) }} />
            <div className="fsm-legend">
              <span><span className="fsm-swatch" style={{ background: 'rgb(var(--primary))' }} />Cost Per Year</span>
              <span><span className="fsm-swatch" style={{ background: 'rgb(var(--primary-container))' }} />Optimal Replacement Month</span>
            </div>
          </div>

          <div className="fsm-panel">
            <p className="fsm-panel-title">Swap Scenario Comparison</p>
            <div style={{ overflowX: 'auto' }}>
              <table className="fsm-table">
                <thead>
                  <tr>
                    <th>Swap After</th><th>Miles</th><th>Resale</th>
                    <th>Depreciation</th><th>Maintenance</th><th>Lost Rev.</th>
                    <th>Total Cost</th><th>Cost / Year</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map(s => (
                    <tr key={s.year} className={s.year === winnerYearly.year ? 'fsm-winner' : ''}>
                      <td>Year {s.year}</td>
                      <td>{num(s.cumMiles)}</td>
                      <td>{money(s.resaleValue)}</td>
                      <td>{money(s.depreciation)}</td>
                      <td>{money(s.cumMaint)}</td>
                      <td>{money(s.cumLost)}</td>
                      <td>{money(s.tco)}</td>
                      <td>{money(s.tcoPerYear)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="fsm-recommendation">
              Lowest annual cost of ownership occurs at:{' '}
              <span className="fsm-rec-big">{mLabel(opt.m)} &mdash; {money(opt.costPerYear)}/year</span>
              {crossover
                ? <>Your operating costs cross resale value at <strong>{mLabel(crossover.m)}</strong> — that&apos;s when you&apos;ve spent as much keeping the truck as it&apos;s worth on the market.</>
                : <>Operating costs never exceed resale value in the 8-year window.</>}
            </div>

            <div className="fsm-actions">
              <button className="btn-secondary" style={{ fontSize: '0.8rem' }} onClick={handleExport}>Export CSV</button>
              <button className="btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => window.print()}>Print / PDF</button>
            </div>
          </div>

          <details className="fsm-details">
            <summary>Year-by-Year Schedule</summary>
            <div className="fsm-sched-content">
              <table className="fsm-table">
                <thead>
                  <tr>
                    <th>Year</th><th>Cum. Miles</th><th>Maintenance</th>
                    <th>Downtime Days</th><th>Lost Revenue</th><th>Cum. Maint.</th><th>Cum. Lost Rev.</th>
                  </tr>
                </thead>
                <tbody>
                  {yearRows.map(y => (
                    <tr key={y.year}>
                      <td>Year {y.year}</td>
                      <td>{num(y.cumMiles)}</td>
                      <td>{money(y.maintenance)}</td>
                      <td>{y.downtimeDays.toFixed(1)}</td>
                      <td>{money(y.lostRevenue)}</td>
                      <td>{money(y.cumMaint)}</td>
                      <td>{money(y.cumLost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
