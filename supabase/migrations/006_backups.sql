create table if not exists backups (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  entries_json jsonb not null,
  entry_count int not null default 0
);

alter table backups enable row level security;
create policy "backups_select" on backups for select using (true);
