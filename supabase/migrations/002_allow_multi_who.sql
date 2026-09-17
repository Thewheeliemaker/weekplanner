-- Allow comma-separated names in the who column (multi-person entries)
alter table entries drop constraint entries_who_check;
