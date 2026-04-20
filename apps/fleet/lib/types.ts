export interface FleetProfile {
  id: string
  email: string
  role: 'admin' | 'shop_manager' | 'dispatcher' | 'mechanic' | 'driver'
  full_name?: string | null
}

export interface TruckMaintenance {
  last_pm_date: string | null
  last_pm_mileage: number | null
  next_pm_date: string | null
  next_pm_mileage: number | null
}

export interface TruckNote {
  id: string
  note_type: string
  body: string
  created_by: string
  created_at: string
}

export interface StatusHistoryEntry {
  id: string
  old_status: string | null
  new_status: string
  changed_by: string
  comment: string | null
  created_at: string
}

export interface Truck {
  id: string
  unit_number: string
  vin: string | null
  category: string | null
  location_id: string | null
  current_status: 'ready' | 'issues' | 'oos'
  waiting_on: string | null
  active: boolean
  created_at: string
  on_job?: boolean
  locations?: { id: string; name: string } | null
  maintenance?: TruckMaintenance | null
  truck_notes?: TruckNote[]
  status_history?: StatusHistoryEntry[]
}

export interface Location {
  id: string
  name: string
}
