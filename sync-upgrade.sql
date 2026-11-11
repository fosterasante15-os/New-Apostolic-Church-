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

-- make Supabase notice the new columns straight away
notify pgrst, 'reload schema';
