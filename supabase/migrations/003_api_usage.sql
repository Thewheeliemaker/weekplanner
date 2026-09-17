create table api_usage (
  id uuid default gen_random_uuid() primary key,
  endpoint text not null,
  created_at timestamptz default now()
);

alter table api_usage enable row level security;
create policy "api_usage_service_only" on api_usage for all using (false);
