-- ==============================================================================
-- Run this ONCE in Supabase -> SQL Editor -> New query -> paste -> Run
-- Makes each user's profile (display name + photo) appear on every device.
-- Safe to run again; it never deletes data.
-- ==============================================================================
create table if not exists public.user_profiles (
  id text primary key,                       -- the user's e-mail (lower case)
  name text,
  photo text,
  extra jsonb default '{}'::jsonb,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.user_profiles enable row level security;
drop policy if exists "Allow all access" on public.user_profiles;
create policy "Allow all access" on public.user_profiles for all using (true) with check (true);

notify pgrst, 'reload schema';
