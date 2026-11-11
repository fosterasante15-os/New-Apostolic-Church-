-- ==============================================================================
-- Run this ONCE in Supabase -> SQL Editor -> New query -> paste -> Run
-- (If Supabase shows a "Potential issue detected" box, it is expected: the script
--  replaces access rules. It never deletes your members, dues or other records.)
--
--  PART A  Guests / visitors on the Attendance page
--  PART B  Registration approval requests (new sign-ups reach the Main Admin on any device)
-- ==============================================================================

-- ---------- PART A: guests ----------
create table if not exists public.guests (
  id text primary key,
  service_key text,
  date text,
  name text not null default '',
  phone text,
  place text,
  invited_by text,
  note text,
  extra jsonb default '{}'::jsonb,
  created_at timestamptz default timezone('utc'::text, now()) not null
);
alter table public.guests enable row level security;
drop policy if exists "Allow all access" on public.guests;
create policy "Allow all access" on public.guests for all using (true) with check (true);


-- ---------- PART B: registration approvals ----------
-- Who is the Main Admin? (checked on the server, so it cannot be faked from the browser)
create or replace function public.is_main_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((auth.jwt() ->> 'email') = 'fosterasante15@gmail.com', false)
      or exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'main-admin' and p.status = 'Active');
$$;
grant execute on function public.is_main_admin() to anon, authenticated;

create table if not exists public.registration_requests (
  id text primary key,                         -- 'req-' + the new account's id
  user_id uuid,
  email text not null,
  name text not null default '',
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Declined')),
  role text,                                   -- role given on approval
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz default timezone('utc'::text, now()) not null
);
alter table public.registration_requests enable row level security;
drop policy if exists "Allow all access"            on public.registration_requests;
drop policy if exists "Anyone can request access"   on public.registration_requests;
drop policy if exists "Main admin reads requests"   on public.registration_requests;
drop policy if exists "Main admin decides requests" on public.registration_requests;
drop policy if exists "Main admin deletes requests" on public.registration_requests;
create policy "Anyone can request access"   on public.registration_requests for insert to anon, authenticated with check (status = 'Pending');
create policy "Main admin reads requests"   on public.registration_requests for select to authenticated using (public.is_main_admin());
create policy "Main admin decides requests" on public.registration_requests for update to authenticated using (public.is_main_admin()) with check (public.is_main_admin());
create policy "Main admin deletes requests" on public.registration_requests for delete to authenticated using (public.is_main_admin());

-- Account records: a new sign-up can only create a PENDING MEMBER; only the Main Admin can approve/change roles.
alter table public.profiles enable row level security;
drop policy if exists "Allow all access"                          on public.profiles;
drop policy if exists "New accounts start as pending members"     on public.profiles;
drop policy if exists "Read own profile, main admin reads all"    on public.profiles;
drop policy if exists "Main admin updates profiles"               on public.profiles;
drop policy if exists "Main admin deletes profiles"               on public.profiles;
create policy "New accounts start as pending members"  on public.profiles for insert to anon, authenticated with check (role = 'member' and status = 'Pending');
create policy "Read own profile, main admin reads all" on public.profiles for select to authenticated using (id = auth.uid() or public.is_main_admin());
create policy "Main admin updates profiles"            on public.profiles for update to authenticated using (public.is_main_admin()) with check (public.is_main_admin());
create policy "Main admin deletes profiles"            on public.profiles for delete to authenticated using (public.is_main_admin());

-- Deliver new requests to the Main Admin instantly (live updates)
do $$
begin
  alter publication supabase_realtime add table public.registration_requests;
exception when duplicate_object then null;
          when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
