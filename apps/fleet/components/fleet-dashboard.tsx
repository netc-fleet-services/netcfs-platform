'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import { STATUS } from '@/lib/constants'
import { SearchBar } from './search-bar'
import { LocationFilter } from './location-filter'
import { CategoryFilter } from './category-filter'
import { StatusTable } from './status-table'
import { NotesDrawer } from './notes-drawer'
import type { Truck, FleetProfile, Location } from '@/lib/types'

function isPMDue(truck: Truck) {
  if (!truck.maintenance?.next_pm_date) return false
  const daysUntil = (new Date(truck.maintenance.next_pm_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  return daysUntil <= 30
}

function timeAgo(iso: string | null) {
  if (!iso) return null
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs} hr${hrs !== 1 ? 's' : ''} ago`
}

const TRUCK_QUERY = `
  *,
  locations ( id, name ),
  maintenance ( last_pm_date, last_pm_mileage, next_pm_date, next_pm_mileage ),
  truck_notes ( id, note_type, body, created_by, created_at ),
  status_history ( id, old_status, new_status, changed_by, created_at, comment )
`

export function FleetDashboard({ profile }: { profile: FleetProfile }) {
  const supabase = getSupabaseBrowserClient()
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [locationFilter, setLocationFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [maintenanceFilter, setMaintenanceFilter] = useState(false)

  const [notesDrawer, setNotesDrawer] = useState<Truck | null>(null)
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [syncingNow, setSyncingNow] = useState(false)
  const [, setTick] = useState(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchTrucks = useCallback(async () => {
    const { data, error } = await supabase
      .from('trucks')
      .select(TRUCK_QUERY)
      .eq('active', true)
      .order('unit_number')
    if (error) { setError(error.message); setLoading(false); return }
    setTrucks(data || [])
    setLoading(false)
  }, [supabase])

  const fetchLastSynced = useCallback(async () => {
    const { data } = await supabase.from('settings').select('value').eq('key', 'last_synced_on_job').single()
    if (data?.value) setLastSynced(data.value)
  }, [supabase])

  useEffect(() => {
    fetchTrucks()
    supabase.from('locations').select('*').order('name').then(({ data }) => setLocations(data || []))
    fetchLastSynced()

    tickRef.current = setInterval(() => setTick(n => n + 1), 30_000)

    const channel = supabase
      .channel('trucks-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trucks' }, fetchTrucks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'truck_notes' }, fetchTrucks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'status_history' }, fetchTrucks)
      .subscribe()

    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
      supabase.removeChannel(channel)
    }
  }, [fetchTrucks, fetchLastSynced, supabase])

  function filterTrucks(list: Truck[]) {
    return list.filter(t => {
      if (locationFilter !== 'all' && t.location_id !== locationFilter) return false
      if (categoryFilter !== 'all' && t.category !== categoryFilter) return false
      if (maintenanceFilter && !isPMDue(t)) return false
      if (search) {
        const q = search.toLowerCase()
        const loc = t.locations?.name || ''
        const notes = (t.truck_notes || []).map(n => n.body).join(' ')
        if (
          !t.unit_number?.toLowerCase().includes(q) &&
          !t.vin?.toLowerCase().includes(q) &&
          !loc.toLowerCase().includes(q) &&
          !notes.toLowerCase().includes(q)
        ) return false
      }
      return true
    })
  }

  const readyTrucks  = filterTrucks(trucks.filter(t => t.current_status === STATUS.READY))
  const issuesTrucks = filterTrucks(trucks.filter(t => t.current_status === STATUS.ISSUES))
  const oosTrucks    = filterTrucks(trucks.filter(t => t.current_status === STATUS.OOS))

  async function handleStatusChange(truck: Truck, newStatus: string, comment: string, waitingOn: string | null) {
    const { error } = await supabase.rpc('change_truck_status', {
      p_truck_id:   truck.id,
      p_new_status: newStatus,
      p_comment:    comment || null,
      p_waiting_on: waitingOn !== undefined ? waitingOn : null,
      p_changed_by: profile?.email || profile?.id || 'Unknown',
    })
    if (error) alert(error.message)
    else fetchTrucks()
  }

  async function handleUpdateWaitingOn(truckId: string, waitingOn: string) {
    const { error } = await supabase.from('trucks').update({ waiting_on: waitingOn || null }).eq('id', truckId)
    if (error) alert(error.message)
    else fetchTrucks()
  }

  async function handleAddNote(truck: Truck, noteType: string, body: string) {
    const { error } = await supabase.from('truck_notes').insert({
      truck_id: truck.id, note_type: noteType, body,
      created_by: profile?.email || profile?.id || 'Unknown',
    })
    if (error) alert(error.message)
    else fetchTrucks()
  }

  async function handleSyncJobStatus() {
    setSyncingNow(true)
    try {
      const { error } = await supabase.functions.invoke('trigger-job-sync')
      if (error) throw error
      await new Promise(r => setTimeout(r, 8000))
      await fetchTrucks()
      await fetchLastSynced()
    } catch (err: any) {
      alert('Could not trigger sync: ' + (err?.message || err))
    } finally {
      setSyncingNow(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)' }}>
        <div style={{ width: 36, height: 36, border: '3px solid var(--outline)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface)' }}>
      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '1.5rem 1.25rem 4rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SearchBar value={search} onChange={setSearch} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
            <button
              className={maintenanceFilter ? 'btn-primary' : 'btn-secondary'}
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.875rem' }}
              onClick={() => setMaintenanceFilter(v => !v)}
            >
              PM Due
            </button>
            <button
              className="btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.875rem', opacity: syncingNow ? 0.6 : 1 }}
              onClick={handleSyncJobStatus}
              disabled={syncingNow}
            >
              {syncingNow ? 'Refreshing…' : '↻ Job Status'}
            </button>
            {lastSynced && (
              <span style={{ fontSize: '0.7rem', color: 'var(--on-surface-muted)', whiteSpace: 'nowrap' }}>
                {timeAgo(lastSynced)}
              </span>
            )}
          </div>
        </div>

        <LocationFilter locations={locations} value={locationFilter} onChange={setLocationFilter} />
        <CategoryFilter value={categoryFilter} onChange={setCategoryFilter} />

        {error && (
          <div style={{ marginTop: '1rem', padding: '0.875rem 1rem', background: 'var(--error-container)', border: '1px solid var(--error)', borderRadius: '0.5rem', color: 'var(--error)', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.25rem' }}>
          <StatusTable status={STATUS.OOS}    trucks={oosTrucks}    totalCount={trucks.filter(t => t.current_status === STATUS.OOS).length}    profile={profile} onStatusChange={handleStatusChange} onViewHistory={t => setNotesDrawer(t)} onUpdateWaitingOn={handleUpdateWaitingOn} />
          <StatusTable status={STATUS.ISSUES} trucks={issuesTrucks} totalCount={trucks.filter(t => t.current_status === STATUS.ISSUES).length} profile={profile} onStatusChange={handleStatusChange} onViewHistory={t => setNotesDrawer(t)} onUpdateWaitingOn={handleUpdateWaitingOn} />
          <StatusTable status={STATUS.READY}  trucks={readyTrucks}  totalCount={trucks.filter(t => t.current_status === STATUS.READY).length}  profile={profile} onStatusChange={handleStatusChange} onViewHistory={t => setNotesDrawer(t)} onUpdateWaitingOn={handleUpdateWaitingOn} />
        </div>
      </main>

      {notesDrawer && (
        <NotesDrawer
          truck={notesDrawer}
          profile={profile}
          onAddNote={handleAddNote}
          onClose={() => setNotesDrawer(null)}
        />
      )}
    </div>
  )
}
