-- Reads require login with the shared family account (Supabase Auth).
-- Before running: (1) create user gezin@weekplanner.app with the family password,
-- (2) turn OFF "Allow new users to sign up", (3) deploy the app version that signs in.
-- All writes keep going through /api/* with the service_role key.

drop policy if exists "entries_select" on entries;
drop policy if exists "boodschappen_select" on boodschappen;
drop policy if exists "favorieten_select" on favorieten;
drop policy if exists "photos_select" on photos;
drop policy if exists "settings_all" on settings;
drop policy if exists "backups_select" on backups;

create policy "entries_read_family" on entries for select to authenticated using (true);
create policy "boodschappen_read_family" on boodschappen for select to authenticated using (true);
create policy "favorieten_read_family" on favorieten for select to authenticated using (true);
create policy "photos_read_family" on photos for select to authenticated using (true);
create policy "settings_read_family" on settings for select to authenticated using (true);
-- backups: no client policy at all; only the service role (api/backup.js) can read them.

-- Undo (rollback):
-- drop policy "entries_read_family" on entries;          create policy "entries_select" on entries for select using (true);
-- drop policy "boodschappen_read_family" on boodschappen; create policy "boodschappen_select" on boodschappen for select using (true);
-- drop policy "favorieten_read_family" on favorieten;    create policy "favorieten_select" on favorieten for select using (true);
-- drop policy "photos_read_family" on photos;            create policy "photos_select" on photos for select using (true);
-- drop policy "settings_read_family" on settings;        create policy "settings_all" on settings for all using (true) with check (true);
