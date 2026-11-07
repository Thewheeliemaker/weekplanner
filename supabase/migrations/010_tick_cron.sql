-- Every 5 minutes, Supabase calls /api/tick, which sends reminders and the morning digest.
-- Before running:
--   1. Set CRON_SECRET on Vercel (Production) and redeploy.
--   2. Replace VERVANG_DOOR_CRON_SECRET below with that same value.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- One row per sent reminder (entry + occurrence date) so nothing is sent twice
create table if not exists reminder_log (
  entry_id uuid not null,
  occurrence date not null,
  sent_at timestamptz not null default now(),
  primary key (entry_id, occurrence)
);
alter table reminder_log enable row level security; -- no policies: service role only

-- Atomically claim today's digest. Returns true only for the first caller of the day.
create or replace function claim_digest(p_day text) returns boolean
language plpgsql security definer set search_path = public as $$
declare got boolean;
begin
  insert into settings (id, value) values ('digest_last_sent', to_jsonb(p_day))
  on conflict (id) do update set value = excluded.value, updated_at = now()
    where settings.value is distinct from excluded.value
  returning true into got;
  return coalesce(got, false);
end $$;
revoke all on function claim_digest(text) from public, anon, authenticated;

-- Schedule (re-running this file replaces the job)
select cron.unschedule('weekplanner-tick') where exists (select 1 from cron.job where jobname = 'weekplanner-tick');
select cron.schedule(
  'weekplanner-tick',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://weekplanner-lemon.vercel.app/api/tick',
    headers := jsonb_build_object('Authorization', 'Bearer VERVANG_DOOR_CRON_SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- Check:   select * from cron.job_run_details order by start_time desc limit 5;
--          select status_code, content from net._http_response order by created desc limit 5;
-- Stop:    select cron.unschedule('weekplanner-tick');
