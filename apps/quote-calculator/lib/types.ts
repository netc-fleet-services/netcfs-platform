export type ServiceCategory =
  | "road_service"
  | "light_duty"
  | "heavy_duty"
  | "transport";

export interface ServiceRate {
  id: string;
  slug: string;
  category: ServiceCategory;
  name: string;
  flat_rate: number | null;
  hourly_rate: number | null;
  minimum_hours: number | null;
  hookup_fee: number | null;
  per_mile_rate: number | null;
  travel_per_mile_rate: number | null;
  travel_hourly_rate: number | null;
  parts_applicable: boolean;
  notes: string | null;
  sort_order: number;
  active: boolean;
}

export interface QuoteInputs {
  hours?: number;
  miles?: number;
  travel_hours?: number;
  extra_hours?: number;
  extra_charge?: number;
  parts_cost?: number;
  permit_cost?: number;
  escort_cost?: number;
  yard_id?: string;
  pickup_address?: string;
  drop_address?: string;
  stops?: string[];
  equipment?: string;
  load_unload_hours?: number;
  drive_hours?: number;
  has_tolls?: boolean;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  notes?: string;
}

export interface Yard {
  id: string;
  short: string;
  addr: string;
  zip: string | null;
}

export interface QuoteLine {
  label: string;
  detail: string;
  amount: number;
}

export interface QuoteBreakdown {
  lines: QuoteLine[];
  total: number;
  totalLow: number;
  totalHigh: number;
}

export interface JobLookup {
  id: string;
  tb_call_num: string | null;
  tb_desc: string | null;
  tb_reason: string | null;
  tb_account: string | null;
  tb_scheduled: string | null;
  tb_driver: string | null;
  truck_and_equipment: string | null;
  yard_id: string | null;
  pickup_addr: string | null;
  drop_addr: string | null;
  pickup_lat: number | null;
  pickup_lon: number | null;
  drop_lat: number | null;
  drop_lon: number | null;
  status: string | null;
  day: string | null;
}

export interface RouteMatch {
  miles: number;
  hours: number;
  matched: boolean;
}

export interface JobLookupResponse {
  job: JobLookup;
  route: RouteMatch | null;
}

export const PICKUP_DROPOFF_HOURS = 1.0;
