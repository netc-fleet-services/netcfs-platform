export interface Stop {
  addr: string
  zip: string
  name?: string
}

export interface Job {
  id: string
  yardId: string | null
  driverId: number | null
  driverId2: number | null
  pickupZip: string | null
  dropZip: string | null
  pickupAddr: string
  dropAddr: string
  pickupLat: number | null
  pickupLon: number | null
  dropLat: number | null
  dropLon: number | null
  tbCallNum: string | null
  tbDesc: string
  tbAccount: string
  tbScheduled: string | null
  tbReason: string
  jobType: string | null
  jobTypeOverride: boolean
  tbDriver: string
  tbDriver2: string
  tbTruck: string
  priority: 'urgent' | 'normal' | 'flexible'
  status: 'scheduled' | 'active' | 'complete' | 'cancelled'
  day: string
  notes: string
  stops: Stop[]
  startedAt: string | null
  completedAt: string | null
  hasTolls: boolean
  addedAt: string | null
  // Live-board fields (written by sync_calls.py only)
  actionStatus: string | null   // raw TowBook action text ("On Scene", "Towing at time", …)
  activeSince: string | null    // first observed transition into status=active
}

export interface Driver {
  id: number
  name: string
  truck: string
  yard: string
  func: string
  company: string | null   // drivers."Company" — 'Interstate' vs NETC-side entities
  active: boolean
}

// Row from scheduler_driver_schedule (the scheduler app owns writes).
export interface ScheduleEntry {
  driverId: number
  scheduleDate: string           // ISO date
  entryType: 'shift' | 'off'
  startTime: string | null       // 'HH:MM:SS'; end < start ⇒ overnight
  endTime: string | null
  offReason: 'PTO' | 'sick' | 'unavailable' | 'other' | null
}

export interface Yard {
  id: string
  short: string
  addr: string
  zip: string
}

export interface Coords {
  lat: number
  lon: number
  name?: string
}

export interface RouteResult {
  miles: number
  hours: number
  hasTolls: boolean
  tollSegments: unknown[]
}

export interface LegDetail {
  from: string
  to: string
  mi: number
  hr: number
  fromAddr: string
  toAddr: string
}

export interface LegCalc {
  h1: number; h2: number; h3: number
  m1: number; m2: number; m3: number
  total: number
  totalMi: number
  legs: LegDetail[] | null
  luH: number
  fromGH: boolean
  multiLeg?: boolean
}

export interface DriverMatchItem {
  tbName: string
  slot: 'driverId' | 'driverId2'
  callNums: string[]
  suggested: Driver | null
}

export interface GeoCache {
  [addr: string]: Coords
}

export interface RouteCache {
  [key: string]: RouteResult
}
