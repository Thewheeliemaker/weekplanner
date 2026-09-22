create table push_subscriptions (
  id uuid default gen_random_uuid() primary key,
  endpoint text unique not null,
  subscription text not null,
  user_name text not null,
  created_at timestamptz default now()
);

alter table push_subscriptions enable row level security;
create policy "push_subscriptions_service_only" on push_subscriptions for all using (false);
