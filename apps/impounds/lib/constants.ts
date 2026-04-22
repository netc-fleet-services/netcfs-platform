export const IMPOUND_STATUSES = ['Owned', 'Police Hold', 'Current Impound'] as const
export type ImpoundStatus = typeof IMPOUND_STATUSES[number]

export const IMPOUND_LOCATIONS = ['Exeter', 'Pembroke', 'Bow', 'Saco', 'Lee'] as const
export type ImpoundLocation = typeof IMPOUND_LOCATIONS[number]

export const SCRAP_VALUE = 600

export const CAN_EDIT_IMPOUND = ['admin', 'dispatcher', 'impound_manager'] as const
