-- Planbord Sync — initial schema
-- Tables: entries, boodschappen, favorieten, photos

create table entries (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  who text not null check (who in ('Siem', 'Mare', 'Merel', 'Rick', 'Algemeen')),
  type text not null check (type in ('wekelijks', 'jaarlijks', 'eenmalig', 'periode')),
  weekday text check (weekday in ('maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag')),
  date date,
  end_date date,
  time text default '',
  note text default '',
  category text check (category in ('eten', 'bijzonder') or category is null),
  skip_dates jsonb default '[]'::jsonb,
  source text not null default 'handmatig' check (source in ('handmatig', 'foto', 'beschrijving')),
  op_fysiek_bord boolean not null default false,
  photo_id uuid,
  reminder_minutes integer default null,
  created_at timestamptz not null default now()
);

create table boodschappen (
  id uuid primary key default gen_random_uuid(),
  naam text not null,
  afgevinkt boolean not null default false,
  created_at timestamptz not null default now()
);

create table favorieten (
  id uuid primary key default gen_random_uuid(),
  naam text not null,
  created_at timestamptz not null default now()
);

create table photos (
  id uuid primary key default gen_random_uuid(),
  asset_url text,
  uploaded_at timestamptz not null default now(),
  status text not null default 'nieuw' check (status in ('nieuw', 'verwerkt')),
  ai_summary text default ''
);

-- RLS: for now allow all authenticated + anon access (family app, no per-user isolation)
alter table entries enable row level security;
alter table boodschappen enable row level security;
alter table favorieten enable row level security;
alter table photos enable row level security;

create policy "entries_all" on entries for all using (true) with check (true);
create policy "boodschappen_all" on boodschappen for all using (true) with check (true);
create policy "favorieten_all" on favorieten for all using (true) with check (true);
create policy "photos_all" on photos for all using (true) with check (true);

-- Indexes for common queries
create index entries_who_idx on entries (who);
create index entries_type_idx on entries (type);
create index entries_date_idx on entries (date);
create index boodschappen_afgevinkt_idx on boodschappen (afgevinkt);
