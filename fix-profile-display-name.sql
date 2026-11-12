-- Run this file in the church project's Supabase SQL Editor.
-- Confirmed Auth log error: SQLSTATE 42703, profiles.display_name does not exist.
-- This adds one nullable column. It does not delete or update existing records,
-- change passwords, modify roles, or change row-level-security policies.
-- Do NOT rerun supabase-schema.sql on the live project: that file drops tables.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name TEXT;

COMMIT;

-- Verification: the result should show display_name with data_type = text.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND column_name = 'display_name';
