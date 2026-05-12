-- wip_runs table
-- Tracks Fullbay WIP report runs triggered manually or via cron.

create table if not exists wip_runs (
  id                  uuid primary key default gen_random_uuid(),
  status              text not null default 'pending',  -- pending | running | done | error
  week_label          text,          -- e.g. "2026-05-04 to 2026-05-10"
  summary_file_path   text,          -- storage path for WIP_Summary CSV
  detail_file_path    text,          -- storage path for WIP_Detail CSV
  result_json         jsonb,         -- array of {shop, total_parts_cost} rows for inline display
  error_message       text,
  created_at          timestamptz not null default now()
);

alter table wip_runs enable row level security;

create policy "authenticated users can read wip runs"
  on wip_runs for select
  using (auth.role() = 'authenticated');

-- Storage bucket for WIP report files (run manually in Supabase dashboard if needed):
-- INSERT INTO storage.buckets (id, name, public) VALUES ('wip-reports', 'wip-reports', false)
-- ON CONFLICT DO NOTHING;
