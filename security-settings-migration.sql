-- ==============================================================================
-- New Apostolic Church — enforced security settings, sessions, login protection,
-- and private application backups.
--
-- This file is intentionally a one-time, additive migration.  It does not
-- remove or rewrite business/Auth data.  Run it in the Supabase SQL editor;
-- preparing or committing this file does not apply it to a live project.
-- ============================================================================

BEGIN;

-- Supabase projects normally already provide pgcrypto.  gen_random_uuid() is
-- used only for private migration-owned identifiers, never for Auth passwords.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Compatible profile fields used by the existing account/login feature.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_login timestamptz;

-- -----------------------------------------------------------------------------
-- Private policy, authentication-attempt, native-session, and backup state.
-- These tables are not a public API.  All non-service roles lose table access;
-- the RPCs below are the only supported backend interface.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.portal_security_policy (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  session_timeout_minutes integer NOT NULL DEFAULT 30 CHECK (session_timeout_minutes BETWEEN 5 AND 1440),
  failed_login_limit integer NOT NULL DEFAULT 5 CHECK (failed_login_limit BETWEEN 1 AND 20),
  lockout_minutes integer NOT NULL DEFAULT 15 CHECK (lockout_minutes BETWEEN 1 AND 1440),
  backup_retention integer NOT NULL DEFAULT 10 CHECK (backup_retention BETWEEN 1 AND 100),
  auto_backup_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.portal_login_attempts (
  email text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  locked_until timestamptz,
  last_failed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.portal_login_reservations (
  ticket uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS portal_login_reservations_email_idx
  ON public.portal_login_reservations (email, expires_at);

CREATE TABLE IF NOT EXISTS public.portal_sessions (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  last_activity timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS portal_sessions_user_idx
  ON public.portal_sessions (user_id, ended_at, last_activity);

CREATE TABLE IF NOT EXISTS public.portal_backup_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  actor_id uuid NOT NULL,
  automatic boolean NOT NULL DEFAULT false,
  record_count bigint NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS portal_backup_snapshots_created_idx
  ON public.portal_backup_snapshots (created_at DESC, id DESC);

-- Add missing columns when an earlier partial attempt created one of the private
-- tables.  These are additive repairs only.
ALTER TABLE public.portal_security_policy ADD COLUMN IF NOT EXISTS session_timeout_minutes integer;
ALTER TABLE public.portal_security_policy ADD COLUMN IF NOT EXISTS failed_login_limit integer;
ALTER TABLE public.portal_security_policy ADD COLUMN IF NOT EXISTS lockout_minutes integer;
ALTER TABLE public.portal_security_policy ADD COLUMN IF NOT EXISTS backup_retention integer;
ALTER TABLE public.portal_security_policy ADD COLUMN IF NOT EXISTS auto_backup_enabled boolean;
ALTER TABLE public.portal_security_policy ADD COLUMN IF NOT EXISTS last_automatic_backup_at timestamptz;
ALTER TABLE public.portal_security_policy ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.portal_login_attempts ADD COLUMN IF NOT EXISTS failed_count integer;
ALTER TABLE public.portal_login_attempts ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE public.portal_login_attempts ADD COLUMN IF NOT EXISTS last_failed_at timestamptz;
ALTER TABLE public.portal_login_attempts ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.portal_login_reservations ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.portal_login_reservations ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE public.portal_login_reservations ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.portal_login_reservations ADD COLUMN IF NOT EXISTS consumed_at timestamptz;
ALTER TABLE public.portal_sessions ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.portal_sessions ADD COLUMN IF NOT EXISTS last_activity timestamptz;
ALTER TABLE public.portal_sessions ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE public.portal_sessions ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE public.portal_backup_snapshots ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE public.portal_backup_snapshots ADD COLUMN IF NOT EXISTS actor_id uuid;
ALTER TABLE public.portal_backup_snapshots ADD COLUMN IF NOT EXISTS automatic boolean;
ALTER TABLE public.portal_backup_snapshots ADD COLUMN IF NOT EXISTS record_count bigint;
ALTER TABLE public.portal_backup_snapshots ADD COLUMN IF NOT EXISTS data jsonb;

-- The baseline schema includes church_settings.  Seed only when the general row
-- is absent; an existing profile/name/logo payload is never overwritten here.
INSERT INTO public.church_settings (key, value)
VALUES (
  'general',
  '{"values":{"churchName":"New Apostolic Church Kumasi Central","address":"M9PW+3FQ, Kumasi, Ashanti, Ghana","phone":"","email":"","timezone":"Africa/Accra","sessionTimeoutMinutes":"30","failedLoginLimit":"5","lockoutMinutes":"15","backupRetention":"10","autoBackupEnabled":false,"maintenanceMode":false},"logo":""}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Small SECURITY DEFINER helpers.  Their fixed search_path is deliberate:
-- callers cannot shadow a referenced object through a mutable search_path.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_seed_integer(
  p_values jsonb,
  p_key text,
  p_default integer,
  p_min integer,
  p_max integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_text text := p_values->>p_key;
  v_value integer;
BEGIN
  IF v_text IS NULL OR v_text !~ '^[0-9]{1,4}$' THEN RETURN p_default; END IF;
  v_value := v_text::integer;
  IF v_value < p_min OR v_value > p_max THEN RETURN p_default; END IF;
  RETURN v_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_settings_payload()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_general jsonb;
  v_values jsonb;
  v_policy public.portal_security_policy%ROWTYPE;
  v_defaults constant jsonb := '{"churchName":"New Apostolic Church Kumasi Central","address":"M9PW+3FQ, Kumasi, Ashanti, Ghana","phone":"","email":"","timezone":"Africa/Accra","sessionTimeoutMinutes":"30","failedLoginLimit":"5","lockoutMinutes":"15","backupRetention":"10","autoBackupEnabled":false,"maintenanceMode":false}'::jsonb;
BEGIN
  SELECT cs.value INTO v_general
  FROM public.church_settings AS cs
  WHERE cs.key = 'general';

  IF jsonb_typeof(COALESCE(v_general, '{}'::jsonb)->'values') = 'object' THEN
    v_values := COALESCE(v_general->'values', '{}'::jsonb);
  ELSE
    -- Older installations stored the values directly in general.value.
    v_values := COALESCE(v_general, '{}'::jsonb) - 'logo';
  END IF;

  v_values := v_defaults || COALESCE(v_values, '{}'::jsonb);
  v_values := jsonb_set(v_values, '{sessionTimeoutMinutes}', to_jsonb(public.portal_seed_integer(v_values, 'sessionTimeoutMinutes', 30, 5, 1440)::text), true);
  v_values := jsonb_set(v_values, '{failedLoginLimit}', to_jsonb(public.portal_seed_integer(v_values, 'failedLoginLimit', 5, 1, 20)::text), true);
  v_values := jsonb_set(v_values, '{lockoutMinutes}', to_jsonb(public.portal_seed_integer(v_values, 'lockoutMinutes', 15, 1, 1440)::text), true);
  v_values := jsonb_set(v_values, '{backupRetention}', to_jsonb(public.portal_seed_integer(v_values, 'backupRetention', 10, 1, 100)::text), true);
  IF jsonb_typeof(v_values->'autoBackupEnabled') <> 'boolean' THEN
    v_values := jsonb_set(v_values, '{autoBackupEnabled}', 'false'::jsonb, true);
  END IF;
  IF COALESCE(v_values->>'timezone', '') NOT IN ('Africa/Accra', 'Africa/Lagos', 'Africa/Nairobi', 'UTC', 'Europe/London') THEN
    v_values := jsonb_set(v_values, '{timezone}', '"Africa/Accra"'::jsonb, true);
  END IF;
  SELECT * INTO v_policy FROM public.portal_security_policy WHERE id = true;
  IF FOUND THEN
    v_values := v_values || jsonb_build_object(
      'sessionTimeoutMinutes', v_policy.session_timeout_minutes::text,
      'failedLoginLimit', v_policy.failed_login_limit::text,
      'lockoutMinutes', v_policy.lockout_minutes::text,
      'backupRetention', v_policy.backup_retention::text,
      'autoBackupEnabled', v_policy.auto_backup_enabled
    );
  END IF;

  RETURN jsonb_build_object(
    'values', v_values,
    'logo', COALESCE(v_general->'logo', '""'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_json_integer(
  p_values jsonb,
  p_key text,
  p_default integer,
  p_min integer,
  p_max integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_text text;
  v_value integer;
BEGIN
  v_text := p_values->>p_key;
  IF v_text IS NULL OR btrim(v_text) = '' THEN
    RETURN p_default;
  END IF;
  IF v_text !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Invalid %: expected an integer between % and %', p_key, p_min, p_max USING ERRCODE = '22023';
  END IF;
  v_value := v_text::integer;
  IF v_value < p_min OR v_value > p_max THEN
    RAISE EXCEPTION 'Invalid %: expected an integer between % and %', p_key, p_min, p_max USING ERRCODE = '22023';
  END IF;
  RETURN v_value;
EXCEPTION WHEN numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Invalid %: expected an integer between % and %', p_key, p_min, p_max USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_valid_timezone(p_timezone text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(p_timezone, 'Africa/Accra') IN
    ('Africa/Accra', 'Africa/Lagos', 'Africa/Nairobi', 'UTC', 'Europe/London');
$$;

CREATE OR REPLACE FUNCTION public.portal_session_record_valid(
  p_actor uuid,
  p_session uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_last_activity timestamptz;
  v_ended_at timestamptz;
  v_timeout integer;
  v_role text;
  v_status text;
BEGIN
  IF p_actor IS NULL OR p_session IS NULL THEN RETURN false; END IF;
  SELECT s.last_activity, s.ended_at
    INTO v_last_activity, v_ended_at
  FROM public.portal_sessions AS s
  WHERE s.session_id = p_session AND s.user_id = p_actor;
  IF NOT FOUND OR v_ended_at IS NOT NULL THEN RETURN false; END IF;

  SELECT p.role, p.status INTO v_role, v_status
  FROM public.profiles AS p WHERE p.id = p_actor;
  IF NOT FOUND OR lower(btrim(COALESCE(v_status, ''))) <> 'active'
     OR lower(btrim(COALESCE(v_role, ''))) NOT IN ('main-admin', 'admin', 'account') THEN
    RETURN false;
  END IF;

  SELECT sp.session_timeout_minutes INTO v_timeout
  FROM public.portal_security_policy AS sp WHERE sp.id = true;
  v_timeout := COALESCE(v_timeout, 30);
  RETURN v_last_activity + make_interval(mins => v_timeout) > clock_timestamp();
END;
$$;

-- This is the helper used by every business-collection restrictive policy.
-- It trusts neither browser storage nor metadata: Auth identity, the native
-- session_id JWT claim, server time, and the authoritative profile are checked.
CREATE OR REPLACE FUNCTION public.portal_session_is_active()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid;
  v_session uuid;
  v_last_activity timestamptz;
  v_ended_at timestamptz;
  v_timeout integer;
  v_role text;
  v_status text;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN RETURN false; END IF;
  IF NULLIF(auth.jwt()->>'session_id', '') IS NULL
     OR auth.jwt()->>'session_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    RETURN false;
  END IF;
  v_session := (auth.jwt()->>'session_id')::uuid;

  SELECT s.last_activity, s.ended_at INTO v_last_activity, v_ended_at
  FROM public.portal_sessions AS s
  WHERE s.session_id = v_session AND s.user_id = v_actor;
  IF NOT FOUND OR v_ended_at IS NOT NULL THEN RETURN false; END IF;

  SELECT p.role, p.status INTO v_role, v_status
  FROM public.profiles AS p WHERE p.id = v_actor;
  IF NOT FOUND OR lower(btrim(COALESCE(v_status, ''))) <> 'active'
     OR lower(btrim(COALESCE(v_role, ''))) NOT IN ('main-admin', 'admin', 'account') THEN
    RETURN false;
  END IF;

  SELECT sp.session_timeout_minutes INTO v_timeout
  FROM public.portal_security_policy AS sp WHERE sp.id = true;
  RETURN v_last_activity + make_interval(mins => COALESCE(v_timeout, 30)) > clock_timestamp();
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_current_active_main_session()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
BEGIN
  IF NOT public.portal_session_is_active() THEN RETURN false; END IF;
  SELECT lower(btrim(p.role)) INTO v_role FROM public.profiles AS p WHERE p.id = auth.uid();
  RETURN v_role = 'main-admin';
END;
$$;

-- Seed the singleton policy from an existing canonical {values,logo} payload,
-- while accepting the older direct general.value format as a compatibility aid.
INSERT INTO public.portal_security_policy
  (id, session_timeout_minutes, failed_login_limit, lockout_minutes, backup_retention, auto_backup_enabled)
SELECT
  true,
  public.portal_seed_integer(s->'values', 'sessionTimeoutMinutes', 30, 5, 1440),
  public.portal_seed_integer(s->'values', 'failedLoginLimit', 5, 1, 20),
  public.portal_seed_integer(s->'values', 'lockoutMinutes', 15, 1, 1440),
  public.portal_seed_integer(s->'values', 'backupRetention', 10, 1, 100),
  CASE
    WHEN jsonb_typeof(s->'values'->'autoBackupEnabled') = 'boolean' THEN (s->'values'->>'autoBackupEnabled')::boolean
    ELSE false
  END
FROM (SELECT public.portal_settings_payload() AS s) AS normalized
ON CONFLICT (id) DO NOTHING;

-- If a partial install left a singleton row with nulls, repair only those
-- migration-owned fields to valid defaults.  Existing valid values remain.
UPDATE public.portal_security_policy
SET session_timeout_minutes = COALESCE(session_timeout_minutes, 30),
    failed_login_limit = COALESCE(failed_login_limit, 5),
    lockout_minutes = COALESCE(lockout_minutes, 15),
    backup_retention = COALESCE(backup_retention, 10),
    auto_backup_enabled = COALESCE(auto_backup_enabled, false),
    updated_at = COALESCE(updated_at, timezone('utc'::text, now()))
WHERE id = true;

-- -----------------------------------------------------------------------------
-- Exact backend RPC contracts.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_security_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  p public.portal_security_policy%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.portal_security_policy WHERE id = true;
  RETURN jsonb_build_object(
    'ready', true,
    'policy', jsonb_build_object(
      'sessionTimeoutMinutes', p.session_timeout_minutes,
      'failedLoginLimit', p.failed_login_limit,
      'lockoutMinutes', p.lockout_minutes,
      'backupRetention', p.backup_retention,
      'autoBackupEnabled', p.auto_backup_enabled
    ),
    'settings', public.portal_settings_payload()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_save_settings(
  p_actor uuid,
  p_session uuid,
  p_settings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_profile_role text;
  v_policy jsonb;
  v_values jsonb;
  v_existing jsonb;
  v_merged jsonb;
  v_logo jsonb;
  v_timeout integer;
  v_failed integer;
  v_lockout integer;
  v_retention integer;
  v_auto boolean;
  v_timezone text;
  v_maintenance jsonb;
BEGIN
  IF NOT public.portal_session_record_valid(p_actor, p_session) THEN
    RAISE EXCEPTION 'An active Main Admin portal session is required' USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(role)) INTO v_profile_role FROM public.profiles WHERE id = p_actor;
  IF v_profile_role <> 'main-admin' THEN
    RAISE EXCEPTION 'Only an active Main Admin can save settings' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'Settings must be a JSON object' USING ERRCODE = '22023';
  END IF;

  v_policy := CASE WHEN jsonb_typeof(p_settings->'policy') = 'object' THEN p_settings->'policy' ELSE '{}'::jsonb END;
  v_values := CASE WHEN jsonb_typeof(p_settings->'values') = 'object' THEN p_settings->'values' ELSE '{}'::jsonb END;
  v_existing := public.portal_settings_payload()->'values';
  -- The backend contract is {policy, values, logo}.  Accepting a flat object
  -- as well keeps the RPC safe for older callers without trusting client state.
  IF v_policy = '{}'::jsonb AND v_values = '{}'::jsonb THEN
    v_policy := p_settings;
  END IF;
  v_merged := COALESCE(v_existing, '{}'::jsonb) || COALESCE(v_values, '{}'::jsonb) || COALESCE(v_policy, '{}'::jsonb);

  v_timeout := public.portal_json_integer(v_merged, 'sessionTimeoutMinutes', 30, 5, 1440);
  v_failed := public.portal_json_integer(v_merged, 'failedLoginLimit', 5, 1, 20);
  v_lockout := public.portal_json_integer(v_merged, 'lockoutMinutes', 15, 1, 1440);
  v_retention := public.portal_json_integer(v_merged, 'backupRetention', 10, 1, 100);

  IF jsonb_typeof(v_merged->'autoBackupEnabled') <> 'boolean' THEN
    RAISE EXCEPTION 'autoBackupEnabled must be a JSON boolean' USING ERRCODE = '22023';
  END IF;
  v_auto := (v_merged->>'autoBackupEnabled')::boolean;
  v_timezone := COALESCE(v_merged->>'timezone', 'Africa/Accra');
  IF NOT public.portal_valid_timezone(v_timezone) THEN
    RAISE EXCEPTION 'timezone is not in the supported whitelist' USING ERRCODE = '22023';
  END IF;
  v_maintenance := v_merged->'maintenanceMode';
  IF v_maintenance IS NOT NULL AND jsonb_typeof(v_maintenance) <> 'boolean' THEN
    RAISE EXCEPTION 'maintenanceMode must be a JSON boolean' USING ERRCODE = '22023';
  END IF;

  -- Store numeric security fields as strings in values for the existing form,
  -- while keeping the private policy strongly typed and authoritative.
  v_merged := jsonb_set(v_merged, '{sessionTimeoutMinutes}', to_jsonb(v_timeout::text), true);
  v_merged := jsonb_set(v_merged, '{failedLoginLimit}', to_jsonb(v_failed::text), true);
  v_merged := jsonb_set(v_merged, '{lockoutMinutes}', to_jsonb(v_lockout::text), true);
  v_merged := jsonb_set(v_merged, '{backupRetention}', to_jsonb(v_retention::text), true);
  v_merged := jsonb_set(v_merged, '{autoBackupEnabled}', to_jsonb(v_auto), true);
  v_logo := CASE WHEN p_settings ? 'logo' THEN p_settings->'logo' ELSE public.portal_settings_payload()->'logo' END;
  IF v_logo IS NULL THEN v_logo := '""'::jsonb; END IF;

  -- Lock the policy row so settings, retention pruning, and concurrent saves
  -- observe one authoritative policy in this transaction.
  PERFORM pg_advisory_xact_lock(hashtext('portal-backup-retention'));
  PERFORM 1 FROM public.portal_security_policy WHERE id = true FOR UPDATE;
  -- Seal sessions expired under either the old or the newly selected timeout.
  -- Increasing the timeout later must never bring an expired session back.
  UPDATE public.portal_sessions SET ended_at = clock_timestamp()
  WHERE ended_at IS NULL AND last_activity + make_interval(mins => LEAST(v_timeout,
    (SELECT session_timeout_minutes FROM public.portal_security_policy WHERE id = true))) <= clock_timestamp();
  UPDATE public.portal_security_policy
  SET session_timeout_minutes = v_timeout,
      failed_login_limit = v_failed,
      lockout_minutes = v_lockout,
      backup_retention = v_retention,
      auto_backup_enabled = v_auto,
      updated_at = clock_timestamp()
  WHERE id = true;

  INSERT INTO public.church_settings (key, value, updated_at)
  VALUES ('general', jsonb_build_object('values', v_merged, 'logo', v_logo), clock_timestamp())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

  -- Prune old backup copies in the same transaction as an authoritative save.
  DELETE FROM public.portal_backup_snapshots AS old
  WHERE old.id IN (
    SELECT candidate.id
    FROM public.portal_backup_snapshots AS candidate
    ORDER BY candidate.created_at DESC, candidate.id DESC
    OFFSET v_retention
  );

  RETURN public.portal_security_status();
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_begin_login(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_now timestamptz := clock_timestamp();
  v_limit integer;
  v_attempt public.portal_login_attempts%ROWTYPE;
  v_open_until timestamptz;
  v_ticket uuid;
  v_retry integer := 0;
BEGIN
  -- Stale reservations are housekeeping only; no password or credential is
  -- recorded.  The per-email advisory lock makes the reservation a true bound.
  DELETE FROM public.portal_login_reservations WHERE expires_at <= v_now OR consumed_at IS NOT NULL;
  IF v_email = '' THEN
    RETURN jsonb_build_object('allowed', false, 'ticket', NULL, 'retryAfterSeconds', 0, 'lockedUntil', NULL);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_email));

  INSERT INTO public.portal_login_attempts (email) VALUES (v_email)
  ON CONFLICT (email) DO NOTHING;
  SELECT * INTO v_attempt FROM public.portal_login_attempts WHERE email = v_email FOR UPDATE;
  SELECT failed_login_limit INTO v_limit FROM public.portal_security_policy WHERE id = true;
  v_limit := COALESCE(v_limit, 5);

  IF v_attempt.locked_until IS NOT NULL AND v_attempt.locked_until <= v_now THEN
    UPDATE public.portal_login_attempts
    SET failed_count = 0, locked_until = NULL, updated_at = v_now
    WHERE email = v_email;
    v_attempt.failed_count := 0;
    v_attempt.locked_until := NULL;
  END IF;

  IF v_attempt.locked_until IS NOT NULL AND v_attempt.locked_until > v_now THEN
    v_retry := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_attempt.locked_until - v_now)))::integer);
    RETURN jsonb_build_object('allowed', false, 'ticket', NULL, 'retryAfterSeconds', v_retry, 'lockedUntil', v_attempt.locked_until);
  END IF;

  SELECT r.expires_at INTO v_open_until
  FROM public.portal_login_reservations AS r
  WHERE r.email = v_email AND r.consumed_at IS NULL AND r.expires_at > v_now
  ORDER BY r.expires_at ASC
  LIMIT 1
  FOR UPDATE;
  IF v_open_until IS NOT NULL THEN
    v_retry := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_open_until - v_now)))::integer);
    RETURN jsonb_build_object('allowed', false, 'ticket', NULL, 'retryAfterSeconds', v_retry, 'lockedUntil', NULL);
  END IF;

  v_ticket := gen_random_uuid();
  INSERT INTO public.portal_login_reservations (ticket, email, created_at, expires_at)
  VALUES (v_ticket, v_email, v_now, v_now + interval '2 minutes');
  RETURN jsonb_build_object('allowed', true, 'ticket', v_ticket, 'retryAfterSeconds', 0, 'lockedUntil', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_finish_login(
  p_email text,
  p_ticket uuid,
  p_success boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_now timestamptz := clock_timestamp();
  v_reservation public.portal_login_reservations%ROWTYPE;
  v_attempt public.portal_login_attempts%ROWTYPE;
  v_limit integer;
  v_lockout integer;
  v_retry integer := 0;
  v_allowed boolean;
BEGIN
  DELETE FROM public.portal_login_reservations WHERE expires_at <= v_now OR consumed_at IS NOT NULL;
  IF v_email = '' OR p_ticket IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'retryAfterSeconds', 0, 'lockedUntil', NULL);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_email));
  SELECT * INTO v_reservation
  FROM public.portal_login_reservations
  WHERE ticket = p_ticket AND email = v_email AND consumed_at IS NULL AND expires_at > v_now
  FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_attempt FROM public.portal_login_attempts WHERE email = v_email FOR UPDATE;
    IF v_attempt.locked_until IS NOT NULL AND v_attempt.locked_until > v_now THEN
      v_retry := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_attempt.locked_until - v_now)))::integer);
    END IF;
    RETURN jsonb_build_object('allowed', false, 'retryAfterSeconds', v_retry, 'lockedUntil', v_attempt.locked_until);
  END IF;
  UPDATE public.portal_login_reservations SET consumed_at = v_now WHERE ticket = p_ticket;

  INSERT INTO public.portal_login_attempts (email) VALUES (v_email)
  ON CONFLICT (email) DO NOTHING;
  SELECT * INTO v_attempt FROM public.portal_login_attempts WHERE email = v_email FOR UPDATE;
  SELECT failed_login_limit, lockout_minutes INTO v_limit, v_lockout
  FROM public.portal_security_policy WHERE id = true;
  v_limit := COALESCE(v_limit, 5);
  v_lockout := COALESCE(v_lockout, 15);

  IF p_success IS NULL THEN
    -- A provider/network cancellation is retryable and never increments the
    -- wrong-credential counter.
    v_allowed := NOT (v_attempt.locked_until IS NOT NULL AND v_attempt.locked_until > v_now);
  ELSIF p_success IS TRUE THEN
    IF v_attempt.locked_until IS NOT NULL AND v_attempt.locked_until > v_now THEN
      v_allowed := false;
    ELSE
      UPDATE public.portal_login_attempts
      SET failed_count = 0, locked_until = NULL, last_failed_at = NULL, updated_at = v_now
      WHERE email = v_email;
      v_allowed := true;
    END IF;
  ELSE
    UPDATE public.portal_login_attempts
    SET failed_count = failed_count + 1,
        last_failed_at = v_now,
        locked_until = CASE WHEN failed_count + 1 >= v_limit THEN v_now + make_interval(mins => v_lockout) ELSE NULL END,
        updated_at = v_now
    WHERE email = v_email;
    SELECT * INTO v_attempt FROM public.portal_login_attempts WHERE email = v_email;
    v_allowed := false;
  END IF;

  IF v_attempt.locked_until IS NOT NULL AND v_attempt.locked_until > v_now THEN
    v_retry := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_attempt.locked_until - v_now)))::integer);
  END IF;
  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'retryAfterSeconds', v_retry,
    'lockedUntil', CASE WHEN v_attempt.locked_until IS NOT NULL AND v_attempt.locked_until > v_now THEN v_attempt.locked_until ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_session(
  p_actor uuid,
  p_session uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_now timestamptz := clock_timestamp();
  v_row public.portal_sessions%ROWTYPE;
  v_timeout integer;
  v_expires timestamptz;
  v_expired boolean := false;
  v_valid boolean := false;
  v_role text;
  v_status text;
  v_email text;
  v_locked_until timestamptz;
  v_has_row boolean;
BEGIN
  IF v_action NOT IN ('open', 'check', 'touch', 'close') THEN
    RAISE EXCEPTION 'p_action must be open, check, touch, or close' USING ERRCODE = '22023';
  END IF;
  IF p_actor IS NULL OR p_session IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'expired', false, 'expiresAt', NULL, 'lastActiveAt', NULL, 'sessionId', p_session, 'userId', p_actor);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_session::text));
  SELECT session_timeout_minutes INTO v_timeout FROM public.portal_security_policy WHERE id = true;
  v_timeout := COALESCE(v_timeout, 30);
  SELECT * INTO v_row FROM public.portal_sessions WHERE session_id = p_session FOR UPDATE;
  v_has_row := FOUND;

  SELECT lower(btrim(p.role)), lower(btrim(p.status)), p.email INTO v_role, v_status, v_email
  FROM public.profiles AS p WHERE p.id = p_actor;
  IF NOT FOUND OR v_status <> 'active' OR v_role NOT IN ('main-admin', 'admin', 'account') THEN
    RETURN jsonb_build_object('valid', false, 'expired', false, 'expiresAt', NULL, 'lastActiveAt', NULL, 'sessionId', p_session, 'userId', p_actor);
  END IF;

  IF v_action = 'open' AND NOT v_has_row THEN
    SELECT a.locked_until INTO v_locked_until
    FROM public.portal_login_attempts AS a WHERE a.email = lower(btrim(v_email));
    IF v_locked_until IS NOT NULL AND v_locked_until > v_now THEN
      RETURN jsonb_build_object('valid', false, 'expired', false, 'expiresAt', v_locked_until, 'lastActiveAt', NULL, 'sessionId', p_session, 'userId', p_actor);
    END IF;
    INSERT INTO public.portal_sessions (session_id, user_id, last_activity, created_at)
    VALUES (p_session, p_actor, v_now, v_now)
    RETURNING * INTO v_row;
  ELSIF NOT v_has_row THEN
    RETURN jsonb_build_object('valid', false, 'expired', false, 'expiresAt', NULL, 'lastActiveAt', NULL, 'sessionId', p_session, 'userId', p_actor);
  ELSIF v_row.user_id <> p_actor THEN
    RETURN jsonb_build_object('valid', false, 'expired', false, 'expiresAt', NULL, 'lastActiveAt', NULL, 'sessionId', p_session, 'userId', p_actor);
  END IF;

  v_expires := v_row.last_activity + make_interval(mins => v_timeout);
  v_expired := v_row.ended_at IS NULL AND v_expires <= v_now;
  IF v_expired THEN
    UPDATE public.portal_sessions SET ended_at = v_now
    WHERE session_id = p_session AND user_id = p_actor AND ended_at IS NULL;
    v_row.ended_at := v_now;
  END IF;
  IF v_action = 'close' THEN
    IF v_row.ended_at IS NULL THEN
      UPDATE public.portal_sessions
      SET ended_at = v_now
      WHERE session_id = p_session AND user_id = p_actor AND ended_at IS NULL;
      v_row.ended_at := v_now;
    END IF;
    v_valid := false;
  ELSIF v_row.ended_at IS NULL AND NOT v_expired THEN
    v_valid := true;
    IF v_action = 'touch' THEN
      UPDATE public.portal_sessions
      SET last_activity = v_now
      WHERE session_id = p_session AND user_id = p_actor AND ended_at IS NULL;
      v_row.last_activity := v_now;
      v_expires := v_now + make_interval(mins => v_timeout);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'valid', v_valid,
    'expired', v_expired,
    'expiresAt', v_expires,
    'lastActiveAt', v_row.last_activity,
    'sessionId', v_row.session_id,
    'userId', v_row.user_id
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Backups.  Source tables are an explicit application whitelist.  The private
-- policy, login, reservation, session, and snapshot tables are not in it, and
-- no auth.users/auth credential/token data is ever selected.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_backup(
  p_actor uuid,
  p_session uuid,
  p_automatic boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session jsonb;
  v_role text;
  v_auto_enabled boolean;
  v_timezone text;
  v_today date;
  v_sources constant text[] := ARRAY[
    'profiles', 'church_settings', 'departments', 'members', 'services',
    'attendance', 'church_dues', 'ministry_dues', 'offerings', 'thanksgiving',
    'ministers', 'announcements', 'activity_logs', 'guests', 'user_profiles'
  ];
  v_table text;
  v_rows jsonb;
  v_count bigint;
  v_data jsonb := '{}'::jsonb;
  v_total bigint := 0;
  v_id uuid;
  v_created timestamptz;
  v_retention integer;
  v_last_automatic timestamptz;
BEGIN
  v_session := public.portal_session(p_actor, p_session, 'check');
  IF COALESCE((v_session->>'valid')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('created', false, 'reason', 'invalid-session');
  END IF;
  SELECT lower(btrim(role)) INTO v_role FROM public.profiles WHERE id = p_actor;
  IF p_automatic IS DISTINCT FROM true AND v_role <> 'main-admin' THEN
    RETURN jsonb_build_object('created', false, 'reason', 'main-admin-required');
  END IF;
  IF p_automatic IS TRUE AND v_role NOT IN ('main-admin', 'admin') THEN
    RETURN jsonb_build_object('created', false, 'reason', 'administrator-required');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('portal-backup-retention'));
  SELECT sp.auto_backup_enabled, sp.backup_retention INTO v_auto_enabled, v_retention
  FROM public.portal_security_policy AS sp WHERE sp.id = true FOR SHARE;
  IF p_automatic IS TRUE AND NOT COALESCE(v_auto_enabled, false) THEN
    RETURN jsonb_build_object('created', false, 'reason', 'automatic-backup-disabled');
  END IF;
  IF p_automatic IS TRUE THEN
    v_timezone := COALESCE(public.portal_settings_payload()->'values'->>'timezone', 'Africa/Accra');
    IF NOT public.portal_valid_timezone(v_timezone) THEN v_timezone := 'Africa/Accra'; END IF;
    v_today := (clock_timestamp() AT TIME ZONE v_timezone)::date;
    PERFORM pg_advisory_xact_lock(hashtext('portal-auto-backup:' || v_today::text));
    SELECT last_automatic_backup_at INTO v_last_automatic FROM public.portal_security_policy WHERE id = true;
    IF v_last_automatic IS NOT NULL AND (v_last_automatic AT TIME ZONE v_timezone)::date = v_today THEN
      RETURN jsonb_build_object('created', false, 'reason', 'automatic-backup-already-created');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.portal_backup_snapshots AS b
      WHERE b.automatic AND (b.created_at AT TIME ZONE v_timezone)::date = v_today
    ) THEN
      RETURN jsonb_build_object('created', false, 'reason', 'automatic-backup-already-created');
    END IF;
  END IF;

  -- SHARE locks stop source writes while this transaction builds its
  -- single JSON document.  Missing optional application tables are skipped.
  FOREACH v_table IN ARRAY v_sources LOOP
    IF to_regclass(format('public.%I', v_table)) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE public.%I IN SHARE MODE', v_table);
    END IF;
  END LOOP;
  FOREACH v_table IN ARRAY v_sources LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x) - ARRAY[''password'',''password_hash'',''passwordHash'',''access_token'',''refresh_token'']), ''[]''::jsonb), count(*) FROM public.%I AS x', v_table)
      INTO v_rows, v_count;
    v_data := v_data || jsonb_build_object(v_table, COALESCE(v_rows, '[]'::jsonb));
    v_total := v_total + COALESCE(v_count, 0);
  END LOOP;

  INSERT INTO public.portal_backup_snapshots (actor_id, automatic, record_count, data)
  VALUES (p_actor, COALESCE(p_automatic, false), v_total, v_data)
  RETURNING id, created_at INTO v_id, v_created;
  IF p_automatic IS TRUE THEN
    UPDATE public.portal_security_policy SET last_automatic_backup_at = v_created WHERE id = true;
  END IF;

  SELECT backup_retention INTO v_retention FROM public.portal_security_policy WHERE id = true;
  DELETE FROM public.portal_backup_snapshots AS old
  WHERE old.id IN (
    SELECT candidate.id
    FROM public.portal_backup_snapshots AS candidate
    ORDER BY candidate.created_at DESC, candidate.id DESC
    OFFSET COALESCE(v_retention, 10)
  );

  RETURN jsonb_build_object(
    'created', true,
    'id', v_id,
    'createdAt', v_created,
    'recordCount', v_total,
    'automatic', COALESCE(p_automatic, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_list_backups(
  p_actor uuid,
  p_session uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_session jsonb;
  v_result jsonb;
BEGIN
  v_session := public.portal_session(p_actor, p_session, 'check');
  SELECT lower(btrim(role)) INTO v_role FROM public.profiles WHERE id = p_actor;
  IF COALESCE((v_session->>'valid')::boolean, false) IS NOT TRUE OR v_role <> 'main-admin' THEN
    RAISE EXCEPTION 'An active Main Admin portal session is required' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'createdAt', b.created_at,
    'recordCount', b.record_count,
    'automatic', b.automatic
  ) ORDER BY b.created_at DESC, b.id DESC), '[]'::jsonb)
  INTO v_result
  FROM public.portal_backup_snapshots AS b;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_download_backup(
  p_actor uuid,
  p_session uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_session jsonb;
  v_snapshot public.portal_backup_snapshots%ROWTYPE;
BEGIN
  v_session := public.portal_session(p_actor, p_session, 'check');
  SELECT lower(btrim(role)) INTO v_role FROM public.profiles WHERE id = p_actor;
  IF COALESCE((v_session->>'valid')::boolean, false) IS NOT TRUE OR v_role <> 'main-admin' THEN
    RAISE EXCEPTION 'An active Main Admin portal session is required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_snapshot FROM public.portal_backup_snapshots WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('id', p_id, 'createdAt', NULL, 'data', NULL);
  END IF;
  RETURN jsonb_build_object(
    'id', v_snapshot.id,
    'createdAt', v_snapshot.created_at,
    'data', v_snapshot.data,
    'recordCount', v_snapshot.record_count,
    'automatic', v_snapshot.automatic
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- RLS.  Existing permissive policies are intentionally preserved.  A
-- restrictive policy narrows them without granting any new access.
-- -----------------------------------------------------------------------------
ALTER TABLE public.portal_security_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_login_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_backup_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_settings ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  business_tables constant text[] := ARRAY[
    'departments', 'members', 'services', 'attendance', 'church_dues',
    'ministry_dues', 'offerings', 'thanksgiving', 'ministers', 'announcements',
    'activity_logs', 'guests', 'user_profiles'
  ];
BEGIN
  FOREACH t IN ARRAY business_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'portal_active_session_required') THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('CREATE POLICY portal_active_session_required ON public.%I AS RESTRICTIVE FOR ALL TO public USING (public.portal_session_is_active()) WITH CHECK (public.portal_session_is_active())', t);
    ELSIF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'portal_profiles_select_restriction') THEN
    CREATE POLICY portal_profiles_select_restriction ON public.profiles AS RESTRICTIVE FOR SELECT TO public
      USING (id = auth.uid() OR public.portal_current_active_main_session());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'portal_profiles_insert_restriction') THEN
    CREATE POLICY portal_profiles_insert_restriction ON public.profiles AS RESTRICTIVE FOR INSERT TO public
      WITH CHECK (public.portal_current_active_main_session());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'portal_profiles_update_restriction') THEN
    CREATE POLICY portal_profiles_update_restriction ON public.profiles AS RESTRICTIVE FOR UPDATE TO public
      USING (public.portal_current_active_main_session()) WITH CHECK (public.portal_current_active_main_session());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'portal_profiles_delete_restriction') THEN
    CREATE POLICY portal_profiles_delete_restriction ON public.profiles AS RESTRICTIVE FOR DELETE TO public
      USING (public.portal_current_active_main_session());
  END IF;
END;
$$;

-- church_settings remains readable under its existing policies.  Only writes
-- gain a restrictive active-Main-plus-active-session requirement.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'church_settings' AND policyname = 'portal_settings_insert_restriction') THEN
    CREATE POLICY portal_settings_insert_restriction ON public.church_settings AS RESTRICTIVE FOR INSERT TO public
      WITH CHECK (public.portal_current_active_main_session());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'church_settings' AND policyname = 'portal_settings_update_restriction') THEN
    CREATE POLICY portal_settings_update_restriction ON public.church_settings AS RESTRICTIVE FOR UPDATE TO public
      USING (public.portal_current_active_main_session()) WITH CHECK (public.portal_current_active_main_session());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'church_settings' AND policyname = 'portal_settings_delete_restriction') THEN
    CREATE POLICY portal_settings_delete_restriction ON public.church_settings AS RESTRICTIVE FOR DELETE TO public
      USING (public.portal_current_active_main_session());
  END IF;
END;
$$;

-- Private state cannot be read or mutated directly by browser roles.  The
-- service-role backend invokes the SECURITY DEFINER RPCs above.
REVOKE ALL ON TABLE public.portal_security_policy, public.portal_login_attempts,
  public.portal_login_reservations, public.portal_sessions,
  public.portal_backup_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_security_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_save_settings(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_begin_login(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_finish_login(text, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_session(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_backup(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_list_backups(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_download_backup(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_seed_integer(jsonb, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_settings_payload() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_json_integer(jsonb, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_valid_timezone(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_session_record_valid(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_security_status() TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_save_settings(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_begin_login(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_finish_login(text, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_session(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_backup(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_list_backups(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_download_backup(uuid, uuid, uuid) TO service_role;

-- RLS policies call these two helpers under browser roles.  They return only a
-- boolean and expose no private state; execute is needed for policy evaluation.
GRANT EXECUTE ON FUNCTION public.portal_session_is_active() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_current_active_main_session() TO anon, authenticated;

COMMIT;

-- PostgREST can cache function signatures.  This is outside the transaction by
-- design and is harmless on installations where NOTIFY is unavailable.
NOTIFY pgrst, 'reload schema';
