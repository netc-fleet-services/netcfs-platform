export interface Driver {
  id: number
  name: string
  function: string | null
  yard: string | null
  truck: string | null
  Company: string | null
  active: boolean
  inactive_reason: string | null
  inactive_since: string | null
  irh_driver_number: string | null
  irh_yard_number: string | null
}

export type EntryType = 'shift' | 'off'

export interface ScheduleEntry {
  id: string
  driver_id: number
  schedule_date: string
  entry_type: EntryType
  start_time: string | null
  end_time: string | null
  off_reason: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ScheduleEntryDraft =
  & Partial<Pick<ScheduleEntry, 'id' | 'notes' | 'created_by'>>
  & {
    driver_id: number
    schedule_date: string
    entry_type: EntryType
    start_time: string | null
    end_time: string | null
    off_reason: string | null
  }
