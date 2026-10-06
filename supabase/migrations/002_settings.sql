create table settings (
  id text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table settings enable row level security;
create policy "settings_all" on settings for all using (true) with check (true);

insert into settings (id, value) values ('location', '{"lat": 52.09, "lon": 5.12, "name": "Utrecht"}');
