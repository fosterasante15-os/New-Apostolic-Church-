-- ==============================================================================
-- New Apostolic Church Kumasi Central — Supabase Schema & Database Setup
-- Run this complete script in your Supabase SQL Editor (supabase.com -> SQL Editor -> New Query)
-- ==============================================================================

-- Clean up any preexisting tables with mismatched types (e.g. if members had uuid id)
DROP TABLE IF EXISTS public.attendance CASCADE;
DROP TABLE IF EXISTS public.church_dues CASCADE;
DROP TABLE IF EXISTS public.ministry_dues CASCADE;
DROP TABLE IF EXISTS public.offerings CASCADE;
DROP TABLE IF EXISTS public.thanksgiving CASCADE;
DROP TABLE IF EXISTS public.members CASCADE;
DROP TABLE IF EXISTS public.services CASCADE;
DROP TABLE IF EXISTS public.departments CASCADE;
DROP TABLE IF EXISTS public.ministers CASCADE;
DROP TABLE IF EXISTS public.announcements CASCADE;
DROP TABLE IF EXISTS public.activity_logs CASCADE;
DROP TABLE IF EXISTS public.church_settings CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- 1. Profiles (Linked to Supabase Auth users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'admin' CHECK (role IN ('main-admin', 'admin', 'account', 'member')),
  status TEXT DEFAULT 'Active',
  photo_url TEXT,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Departments
CREATE TABLE public.departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Members (IDs are custom text codes like 'NAC-0001')
CREATE TABLE public.members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  dob TEXT,
  place TEXT,
  department TEXT,
  departments JSONB DEFAULT '[]'::jsonb,
  joined TEXT,
  status TEXT DEFAULT 'Active',
  photo TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Sunday Services
CREATE TABLE public.services (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  time TEXT DEFAULT '09:00',
  venue TEXT DEFAULT 'Main Auditorium',
  description TEXT DEFAULT 'Weekly worship service.',
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Attendance Records
CREATE TABLE public.attendance (
  id TEXT PRIMARY KEY,
  service_id TEXT,
  service_date TEXT,
  records JSONB DEFAULT '[]'::jsonb,
  recorded_by JSONB,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Church General Dues
CREATE TABLE public.church_dues (
  id TEXT PRIMARY KEY,
  member_id TEXT, -- References members.id (TEXT)
  member_name TEXT,
  department TEXT,
  amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  month TEXT,
  paid_on TEXT,
  method TEXT DEFAULT 'Cash',
  txn_id TEXT,
  recorded_by JSONB,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Ministry Dues
CREATE TABLE public.ministry_dues (
  id TEXT PRIMARY KEY,
  member_id TEXT, -- References members.id (TEXT)
  member_name TEXT,
  department TEXT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  month TEXT,
  paid_on TEXT,
  method TEXT DEFAULT 'Cash',
  txn_id TEXT,
  recorded_by JSONB,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. Sunday Offerings
CREATE TABLE public.offerings (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  service_id TEXT,
  notes TEXT,
  recorded_by JSONB,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 9. Thanksgiving
CREATE TABLE public.thanksgiving (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  member_id TEXT,
  member_name TEXT,
  giver TEXT,
  location TEXT,
  notes TEXT,
  note TEXT,
  recorded_by JSONB,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 10. Ministers
CREATE TABLE public.ministers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT,
  role TEXT,
  bio TEXT,
  note TEXT,
  photo TEXT,
  display_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 11. Announcements
CREATE TABLE public.announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  status TEXT DEFAULT 'draft',
  category TEXT,
  date TEXT,
  sms_status TEXT DEFAULT 'not-sent',
  sms_count INT DEFAULT 0,
  sms_at TIMESTAMPTZ,
  audience TEXT,
  pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 12. Activity Logs
CREATE TABLE public.activity_logs (
  id TEXT PRIMARY KEY,
  at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  entity TEXT,
  action TEXT,
  user_id TEXT,
  user_name TEXT,
  role TEXT,
  summary TEXT,
  data JSONB
);

-- 13. System Settings
CREATE TABLE public.church_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- PERMISSIONS & ROW LEVEL SECURITY (RLS)
-- ==============================================================================

-- Grant table permissions to public / anon / authenticated roles
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'profiles', 'departments', 'members', 'services', 'attendance',
    'church_dues', 'ministry_dues', 'offerings', 'thanksgiving',
    'ministers', 'announcements', 'activity_logs', 'church_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow all access" ON public.%I;', t);
    EXECUTE format('CREATE POLICY "Allow all access" ON public.%I FOR ALL USING (true) WITH CHECK (true);', t);
  END LOOP;
END $$;

-- ==============================================================================
-- INITIAL SEED DATA
-- ==============================================================================

-- Seed Default Departments
INSERT INTO public.departments (id, name, description)
VALUES
  ('dept-seed-1', 'Choir', 'Choir ministry'),
  ('dept-seed-2', 'Lactating Mothers', 'Pregnant Woman ministry'),
  ('dept-seed-3', 'Left Back Seat', 'Left Back Seat ministry'),
  ('dept-seed-4', 'Men''s Fellowship', 'Men''s Fellowship ministry'),
  ('dept-seed-5', 'Middle Seat', 'Middle Seat ministry'),
  ('dept-seed-6', 'Right Back Seat', 'Right Back Seat ministry'),
  ('dept-seed-7', 'Sunday School', 'Sunday School ministry'),
  ('dept-seed-8', 'The Minister''s Wife', 'The Minister''s Wife ministry'),
  ('dept-seed-9', 'Women''s Fellowship', 'Women''s Fellowship ministry'),
  ('dept-seed-10', 'Children''s Fellowship', 'Children''s ministry'),
  ('dept-seed-11', 'Youth Fellowship', 'Youth ministry'),
  ('dept-seed-12', 'Evangelism', 'Evangelism ministry'),
  ('dept-seed-13', 'Welfare', 'Welfare ministry')
ON CONFLICT (id) DO NOTHING;

-- Seed Default Settings
INSERT INTO public.church_settings (key, value)
VALUES
  ('general', '{"churchName": "New Apostolic Church Kumasi Central", "churchAddress": "M9PW+3FQ, Kumasi, Ashanti, Ghana", "churchContact": "", "maintenanceMode": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Seed Sample Members
INSERT INTO public.members (id, name, email, phone, dob, place, department, departments, joined, status)
VALUES
  ('NAC-0001', 'Member 001', 'member001@example.net', '', '', '', 'Choir', '["Choir"]'::jsonb, '2024-01-15', 'Active'),
  ('NAC-0002', 'Member 002', 'member002@example.net', '', '', '', 'Sunday School', '["Sunday School"]'::jsonb, '2023-08-04', 'Active'),
  ('NAC-0003', 'Member 003', 'member003@example.net', '', '', '', 'Men''s Fellowship', '["Men''s Fellowship"]'::jsonb, '2022-11-21', 'Active')
ON CONFLICT (id) DO NOTHING;

-- ==============================================================================
-- AUTOMATIC ADMIN USER IN AUTH.USERS (Password: admin123)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  new_admin_id UUID := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'fosterasante15@gmail.com') THEN
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      new_admin_id,
      'authenticated',
      'authenticated',
      'fosterasante15@gmail.com',
      crypt('admin123', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"name":"Main Admin","role":"main-admin"}'::jsonb,
      now(),
      now()
    );

    INSERT INTO public.profiles (id, email, name, role, status)
    VALUES (new_admin_id, 'fosterasante15@gmail.com', 'Main Admin', 'main-admin', 'Active')
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
