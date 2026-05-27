export const IMPOUND_STATUSES = ['Owned', 'Police Hold', 'Current Impound'] as const
export type ImpoundStatus = typeof IMPOUND_STATUSES[number]

export const IMPOUND_LOCATIONS = ['Exeter', 'Pembroke', 'Bow', 'Saco', 'Lee', 'Off-Site'] as const
export type ImpoundLocation = typeof IMPOUND_LOCATIONS[number]

export const VEHICLE_TYPES = ['car', 'suv', 'truck', 'motorcycle', 'trailer', 'bus', 'other'] as const
export type VehicleType = typeof VEHICLE_TYPES[number]

export const SCRAP_VALUE = 500
export const SCRAP_VALUE_MOTORCYCLE = 250

// Honda intentionally excluded — they sell cars and motorcycles, so brand alone is ambiguous.
// Ambiguous rows are classified by sync_impounds.py via NHTSA vPIC, or by manual drawer override.
const MOTORCYCLE_KEYWORDS = [
  'harley', 'davidson', 'yamaha', 'kawasaki', 'suzuki', 'triumph',
  'ducati', 'ktm', 'indian', 'aprilia', 'vespa', 'piaggio',
  'husqvarna', 'moto guzzi', 'cfmoto', 'scooter',
]

export function isMotorcycle(imp: { vehicle_type?: string | null; make_model?: string | null }): boolean {
  if (imp.vehicle_type) return imp.vehicle_type === 'motorcycle'
  const mm = (imp.make_model ?? '').toLowerCase()
  return MOTORCYCLE_KEYWORDS.some(kw => mm.includes(kw))
}

export function scrapValueFor(imp: { vehicle_type?: string | null; make_model?: string | null }): number {
  return isMotorcycle(imp) ? SCRAP_VALUE_MOTORCYCLE : SCRAP_VALUE
}

export function equipmentTotal(imp: { impound_equipment?: { resale_value?: number | null }[] | null }): number {
  return (imp.impound_equipment ?? []).reduce((sum, e) => sum + (e.resale_value ?? 0), 0)
}

export const CAN_EDIT_IMPOUND = ['admin', 'dispatcher', 'impound_manager'] as const
