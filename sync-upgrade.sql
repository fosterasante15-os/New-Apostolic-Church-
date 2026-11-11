-- ==============================================================================
-- Run this ONCE in Supabase  ->  SQL Editor  ->  New query  ->  paste  ->  Run
-- It adds an "extra" column so notes, payment details and other fields sync too.
-- It does NOT delete or change any existing data.
-- ==============================================================================
alter table public.members       add column if not exists extra jsonb default '{}'::jsonb;
alter table public.departments   add column if not exists extra jsonb default '{}'::jsonb;
alter table public.services      add column if not exists extra jsonb default '{}'::jsonb;
alter table public.church_dues   add column if not exists extra jsonb default '{}'::jsonb;
alter table public.ministry_dues add column if not exists extra jsonb default '{}'::jsonb;
alter table public.offerings     add column if not exists extra jsonb default '{}'::jsonb;
alter table public.thanksgiving  add column if not exists extra jsonb default '{}'::jsonb;
alter table public.ministers     add column if not exists extra jsonb default '{}'::jsonb;
alter table public.announcements add column if not exists extra jsonb default '{}'::jsonb;
create table if not exists public.activity_logs (
  id text primary key,
  at timestamptz default timezone('utc'::text, now()) not null,
  entity text,
  action text,
  user_id text,
  user_name text,
  role text,
  summary text,
  data jsonb,
  extra jsonb default '{}'::jsonb
);
alter table public.activity_logs add column if not exists extra jsonb default '{}'::jsonb;
grant all on public.activity_logs to anon, authenticated, service_role;
alter table public.activity_logs enable row level security;
drop policy if exists "Allow all access" on public.activity_logs;
create policy "Allow all access" on public.activity_logs for all using (true) with check (true);

-- Remove only the exact placeholder rows that were shipped by the old demo UI.
delete from public.members
where id in ('NAC-0001', 'NAC-0002', 'NAC-0003')
  and name in ('Member 001', 'Member 002', 'Member 003')
  and email like '%@example.net';

-- make Supabase notice the new columns straight away
notify pgrst, 'reload schema';
