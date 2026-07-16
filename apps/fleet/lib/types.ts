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

export interface PMSchedule {
  id: string
  name: string
  interval_type: 'days' | 'miles' | 'hours'
  interval_value: number
}

export interface TruckPMAssignment {
  id: string
  truck_id: string
  pm_schedule_id: string
  last_pm_date: string | null
  last_pm_mileage: number | null
  last_pm_hours: number | null
  current_odometer: number | null
  current_hours: number | null
  logged_by: string | null
  logged_at: string | null
  pm_schedules: PMSchedule
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
  truck_pm_assignments?: TruckPMAssignment[]
  truck_notes?: TruckNote[]
  status_history?: StatusHistoryEntry[]
  vehicle_inspections?: { inspected_date: string }[]
}

export interface Location {
  id: string
  name: string
  company?: string | null   // 'netc' | 'interstate' — yards without one are NETC
}
