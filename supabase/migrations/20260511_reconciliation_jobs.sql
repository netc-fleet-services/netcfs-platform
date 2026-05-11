-- reconciliation_jobs table
-- Created and updated by the statement-reconciler app + GitHub Actions runner.

create table if not exists reconciliation_jobs (
  id               uuid primary key default gen_random_uuid(),
  status           text not null default 'pending',   -- pending | running | done | error
  vendor_key       text not null,
  qb_file_count    int  not null default 1,
  stmt_file_count  int  not null default 1,
  result_file_path text,          -- storage path for the result .xlsx
  result_json_path text,          -- storage path for the result .json
  matched_count    int,
  mismatch_count   int,
  fuzzy_match_count int,
  stmt_only_count  int,
  qb_only_count    int,
  stmt_total       numeric(12, 2),
  qb_total         numeric(12, 2),
  error_message    text,
  created_at       timestamptz not null default now()
);

-- RLS: only service role (GitHub Actions) writes; admins can read via service role
alter table reconciliation_jobs enable row level security;

-- Allow service role full access (policy not needed — service role bypasses RLS)
-- Allow authenticated admin reads via anon key if desired (optional)
create policy "admins can read reconciliation jobs"
  on reconciliation_jobs for select
  using (auth.role() = 'authenticated');

-- Storage bucket for reconciliation files
-- Run this manually in the Supabase dashboard if the bucket doesn't exist:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('reconciliation-files', 'reconciliation-files', false)
-- ON CONFLICT DO NOTHING;
