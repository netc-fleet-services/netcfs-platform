export interface ImpoundProfile {
  id: string
  email: string
  role: 'admin' | 'dispatcher' | 'impound_manager'
  full_name?: string | null
}

export interface ImpoundPhoto {
  id: string
  impound_id: string
  storage_path: string
  file_name: string
  uploaded_by: string | null
  created_at: string
}

export interface Impound {
  id: string
  call_number: string
  date_of_impound: string | null
  make_model: string | null
  year: string | null
  vin: string | null
  reason_for_impound: string | null
  notes: string | null
  location: string | null
  status: string | null
  released: boolean
  amount_paid: number | null
  internal_cost: number | null
  sell: boolean
  keys: boolean | null
  drives: boolean | null
  sales_description: string | null
  estimated_value: number | null
  needs_detail: boolean
  needs_mechanic: boolean
  estimated_repair_cost: number | null
  scrapped: boolean
  sold: boolean
  created_at: string
  updated_at: string
  impound_photos?: ImpoundPhoto[]
}
