-- Fleet status-change digest — the "waiting list" schema.
-- Batches status / waiting-on / note changes into a 5-minute global digest
-- instead of one email per change. Purely additive: touches no existing table.
-- Applied to the fleet project (ulzschwnejxghxgluuif) on 2026-06-01.

-- 1) The waiting list: one row per change (status / waiting-on / note).
create table if not exists public.fleet_notification_queue (
  id          uuid primary key default gen_random_uuid(),
  truck_id    uuid not null references public.trucks(id) on delete cascade,
  change_type text not null check (change_type in
                ('status','waiting_on','driver_note','mechanic_note','work_done')),
  old_status  text,        -- status changes: where it came from
  new_status  text,        -- status changes: where it went
  new_value   text,        -- waiting-on / note text
  changed_by  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz, -- set once fully delivered to all recipients (or none match)
  attempts    integer not null default 0  -- retry guard so a bad address can't loop forever
);

create index if not exists fleet_notification_queue_unsent
  on public.fleet_notification_queue (created_at)
  where sent_at is null;

-- 2) Per-recipient delivery log: who already received which change, so a retry
--    only re-sends to the people who actually missed it.
create table if not exists public.fleet_notification_delivery (
  queue_id     uuid not null references public.fleet_notification_queue(id) on delete cascade,
  recipient    text not null,
  delivered_at timestamptz not null default now(),
  primary key (queue_id, recipient)
);

-- Lock both down: only the service role (the API routes) touches them.
alter table public.fleet_notification_queue    enable row level security;
alter table public.fleet_notification_delivery enable row level security;
-- (no policies => anon/authenticated have no access; service role bypasses RLS)
