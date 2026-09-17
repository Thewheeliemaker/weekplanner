-- Drop the old wide-open policies
drop policy if exists "entries_all" on entries;
drop policy if exists "boodschappen_all" on boodschappen;
drop policy if exists "favorieten_all" on favorieten;
drop policy if exists "photos_all" on photos;

-- Allow anon key only to SELECT (reads). All writes go through /api/data with service_role key.
create policy "entries_select" on entries for select using (true);
create policy "boodschappen_select" on boodschappen for select using (true);
create policy "favorieten_select" on favorieten for select using (true);
create policy "photos_select" on photos for select using (true);
