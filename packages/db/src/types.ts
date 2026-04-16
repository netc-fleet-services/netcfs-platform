import type { UserRole } from '@netcfs/auth/types'

// ─── Profiles ────────────────────────────────────────────────────────────────

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  avatar_url: string | null
  created_at: string
  updated_at: string
}

// ─── Trucks / Fleet ───────────────────────────────────────────────────────────

export type TruckStatus = 'Ready' | 'Known Issues' | 'Out of Service'

export interface Truck {
  id: string
  unit_number: string
  location: string
  status: TruckStatus
  year: number | null
  make: string | null
  model: string | null
  vin: string | null
  last_pm_date: string | null
  next_pm_due: string | null
  notes: string | null
  updated_at: string
  created_at: string
}

export interface TruckNote {
  id: string
  truck_id: string
  type: 'driver' | 'mechanic' | 'work_done'
  body: string
  created_by: string
  created_at: string
}

export interface StatusHistory {
  id: string
  truck_id: string
  from_status: TruckStatus | null
  to_status: TruckStatus
  changed_by: string
  reason: string | null
  created_at: string
}

// ─── Jobs / Transport ─────────────────────────────────────────────────────────

export type JobStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled'

export interface Job {
  id: string
  reference_number: string | null
  pickup_location: string
  dropoff_location: string
  pickup_time: string | null
  status: JobStatus
  driver_id: string | null
  truck_id: string | null
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface Driver {
  id: string
  name: string
  phone: string | null
  home_yard: string | null
  is_active: boolean
  current_job_id: string | null
  created_at: string
}

// ─── Inspections ──────────────────────────────────────────────────────────────

export interface InspectionRecord {
  id: string
  driver_name: string
  truck_unit: string
  inspection_date: string
  passed: boolean
  defects: string | null
  created_at: string
}

// ─── Database shape (for typed Supabase client) ───────────────────────────────

export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Omit<Profile, 'created_at' | 'updated_at'>; Update: Partial<Profile> }
      trucks: { Row: Truck; Insert: Omit<Truck, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Truck> }
      truck_notes: { Row: TruckNote; Insert: Omit<TruckNote, 'id' | 'created_at'>; Update: Partial<TruckNote> }
      status_history: { Row: StatusHistory; Insert: Omit<StatusHistory, 'id' | 'created_at'>; Update: never }
      jobs: { Row: Job; Insert: Omit<Job, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Job> }
      drivers: { Row: Driver; Insert: Omit<Driver, 'id' | 'created_at'>; Update: Partial<Driver> }
      inspection_records: { Row: InspectionRecord; Insert: Omit<InspectionRecord, 'id' | 'created_at'>; Update: Partial<InspectionRecord> }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}
