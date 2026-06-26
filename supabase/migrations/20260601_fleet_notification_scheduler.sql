-- Fleet status-change digest — the every-minute heartbeat.
--
-- ⚠️ APPLY THIS ONLY AFTER the email-noti-fix branch is deployed to PRODUCTION,
-- because the cron job pings the production /api/notify-flush endpoint.
--
-- Prerequisite (run ONCE, with the real value — keep it out of git):
--   select vault.create_secret('<the CRON_SECRET value from Vercel>', 'fleet_cron_secret');
--
-- The flush endpoint itself decides whether to actually send (5 quiet minutes,
-- or the 30-minute cap), so pinging every minute is cheap: most pings return
-- {"flushed": false} immediately.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'fleet-status-digest',
  '* * * * *',
  $$
    select net.http_get(
      url := 'https://netcfs-platform-fleet.vercel.app/api/notify-flush',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'fleet_cron_secret')
      )
    );
  $$
);

-- To stop it later:  select cron.unschedule('fleet-status-digest');
