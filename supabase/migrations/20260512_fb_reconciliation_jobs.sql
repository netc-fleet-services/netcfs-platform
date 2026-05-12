-- fb_reconciliation_jobs table
-- Tracks Fullbay vs QuickBooks reconciliation runs in the statement-reconciler app.

create table if not exists fb_reconciliation_jobs (
  id                 uuid primary key default gen_random_uuid(),
  status             text not null default 'pending',  -- pending | running | done | error
  fb_file_path       text,          -- storage path for uploaded Fullbay CSV
  qb_file_path       text,          -- storage path for uploaded QuickBooks Excel
  result_file_path   text,          -- storage path for the output .xlsx
  in_both_count      int,
  fullbay_only_count int,
  qb_only_count      int,
  fb_total           numeric(14, 2),
  qb_total           numeric(14, 2),
  variance           numeric(14, 2),
  result_json        jsonb,         -- summary + discrepancy rows for inline display
  error_message      text,
  created_at         timestamptz not null default now()
);

alter table fb_reconciliation_jobs enable row level security;

create policy "authenticated users can read fb reconciliation jobs"
  on fb_reconciliation_jobs for select
  using (auth.role() = 'authenticated');

-- Storage bucket for FB reconciliation files (run manually in Supabase dashboard if needed):
-- INSERT INTO storage.buckets (id, name, public) VALUES ('fb-reconciliation-files', 'fb-reconciliation-files', false)
-- ON CONFLICT DO NOTHING;
