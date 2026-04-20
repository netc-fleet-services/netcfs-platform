export const STATUS = {
  READY:  'ready',
  ISSUES: 'issues',
  OOS:    'oos',
} as const

export const STATUS_LABELS: Record<string, string> = {
  ready:  'Ready for Use',
  issues: 'Known Issues',
  oos:    'Out of Service',
}

export const NOTE_TYPE = {
  DRIVER:   'driver',
  MECHANIC: 'mechanic',
  WORK:     'work_done',
} as const

export const NOTE_TYPE_LABELS: Record<string, string> = {
  driver:   'Driver Note',
  mechanic: 'Mechanic Note',
  work_done: 'Work Done',
}

export const CATEGORY = {
  HD_TOW:    'hd_tow',
  LD_TOW:    'ld_tow',
  ROADSIDE:  'roadside',
  TRANSPORT: 'transport',
} as const

export const CATEGORY_LABELS: Record<string, string> = {
  hd_tow:    'HD Tow',
  ld_tow:    'LD Tow',
  roadside:  'Roadside',
  transport: 'Transport',
}

export const ROLE = {
  ADMIN:      'admin',
  DISPATCHER: 'dispatcher',
  MECHANIC:   'mechanic',
  DRIVER:     'driver',
} as const

export const CAN_CHANGE_STATUS  = [ROLE.ADMIN, ROLE.DISPATCHER, ROLE.MECHANIC]
export const CAN_ADD_MECHANIC_NOTE = [ROLE.ADMIN, ROLE.DISPATCHER, ROLE.MECHANIC]
export const CAN_MANAGE_TRUCKS  = [ROLE.ADMIN]
export const CAN_MANAGE_NOTIFICATIONS = [ROLE.ADMIN]

export const PM_SOON_DAYS = 60
