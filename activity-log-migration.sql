-- New Apostolic Church: Activity Log backend migration
-- Run once in Supabase Dashboard -> SQL Editor -> New query -> Run.

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

grant all on public.activity_logs to anon, authenticated, service_role;
alter table public.activity_logs enable row level security;
drop policy if exists "Allow all access" on public.activity_logs;
create policy "Allow all access" on public.activity_logs
  for all using (true) with check (true);

notify pgrst, 'reload schema';
