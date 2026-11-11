-- ==============================================================================
-- Register / Update "Foster Admin" in Supabase Auth & Profiles
-- Run this in your Supabase SQL Editor (supabase.com -> SQL Editor -> New Query)
-- IMPORTANT: type your password into the editor only. Never save a real password in GitHub.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_email TEXT := 'fosterasante15@gmail.com';
  v_password TEXT := 'TYPE-YOUR-NEW-PASSWORD-HERE'; -- replace the text between the quotes with your real password (min. 8 characters)
  v_name TEXT := 'Foster Asante';
  v_role TEXT := 'main-admin';
  v_user_id UUID;
BEGIN
  IF v_password = 'TYPE-YOUR-NEW-PASSWORD-HERE' OR length(v_password) < 8 THEN
    RAISE EXCEPTION 'Put your real password (at least 8 characters) in v_password before running this script.';
  END IF;

  -- 1. Check if user already exists in auth.users
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    
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
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      crypt(v_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', v_name, 'role', v_role),
      now(),
      now()
    );
  ELSE
    -- If already exists, update password and metadata
    UPDATE auth.users
    SET 
      encrypted_password = crypt(v_password, gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      raw_user_meta_data = jsonb_build_object('name', v_name, 'role', v_role),
      updated_at = now()
    WHERE id = v_user_id;
  END IF;

  -- 2. Ensure record exists in public.profiles with main-admin privileges
  INSERT INTO public.profiles (id, email, name, role, status)
  VALUES (v_user_id, v_email, v_name, v_role, 'Active')
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    status = 'Active';

  RAISE NOTICE 'Admin user % successfully registered with role %', v_email, v_role;
END $$;
