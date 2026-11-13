'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nsccmfevvkvjhvxrtmax.supabase.co';
const SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const PUBLIC_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zY2NtZmV2dmt2amh2eHJ0bWF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5NzAyMjUsImV4cCI6MjEwOTU0NjIyNX0.74g0XDDodI8rZ9FJvcnbTwh85Jy_XHBsn44TxnwbLok';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RPC_NAME = /^[a-z][a-z0-9_]*$/;
const ACTIONS = new Set(['open', 'check', 'touch', 'close']);
const MIGRATION_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42P01']);
const ADMIN_ROLES = new Set(['main-admin', 'admin', 'account']);

class HTTPError extends Error {
  constructor(status, code, message, options = {}) {
    super(message);
    this.name = 'HTTPError';
    this.status = Number.isInteger(status) ? status : 500;
    this.code = String(code || 'SECURITY_ERROR');
    this.upstreamCode = options.upstreamCode || null;
    this.expose = options.expose !== false;
  }
}

function safeMessage(error, fallback) {
  if (error instanceof HTTPError && error.expose && error.message) return error.message;
  return fallback;
}

function errorBody(error, fallback = 'The security service could not complete the request.') {
  if (error instanceof HTTPError) {
    return { code: error.code, error: safeMessage(error, fallback) };
  }
  return { code: 'SECURITY_UPSTREAM_UNAVAILABLE', error: fallback };
}

function sendJson(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

function parseResponseBody(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}

function upstreamHeaders(key, extra = {}) {
  const headers = {
    apikey: key,
    'Content-Type': 'application/json',
    ...extra
  };
  // New sb_secret keys authenticate through apikey only. Legacy service-role
  // JWTs retain the Authorization header required by older gateways.
  if (key && !key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function requireServerKey() {
  if (!SERVICE_ROLE_KEY) {
    throw new HTTPError(503, 'SECURITY_NOT_CONFIGURED', 'Portal security is not configured on the server.');
  }
  return SERVICE_ROLE_KEY;
}

function upstreamError(response, data, fallback) {
  const code = String(data?.code || data?.error_code || data?.hint || '').trim() || null;
  const status = response && Number.isInteger(response.status) ? response.status : 502;
  const err = new HTTPError(status >= 500 ? 502 : status, code || 'SUPABASE_REQUEST_FAILED', fallback, {
    upstreamCode: code,
    expose: true
  });
  return err;
}

async function requestJson(url, options, fallback) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (_) {
    throw new HTTPError(502, 'SECURITY_UPSTREAM_UNAVAILABLE', fallback);
  }
  let data = null;
  try {
    const text = await response.text();
    data = parseResponseBody(text);
  } catch (_) {
    data = null;
  }
  return { response, data };
}

async function rpc(name, args = {}) {
  requireServerKey();
  if (!RPC_NAME.test(String(name || ''))) throw new HTTPError(500, 'INVALID_RPC_NAME', 'The security operation is invalid.');
  const result = await requestJson(
    `${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: upstreamHeaders(SERVICE_ROLE_KEY),
      body: JSON.stringify(args && typeof args === 'object' ? args : {})
    },
    'Could not reach the portal security database.'
  );
  if (!result.response.ok) throw upstreamError(result.response, result.data, 'The portal security database rejected the request.');
  return result.data;
}

function migrationNotReady(error) {
  return error instanceof HTTPError && MIGRATION_CODES.has(String(error.upstreamCode || error.code));
}

async function getStatus() {
  // Configuration failures are intentionally not converted into setup fallback:
  // a broken deployment must fail closed rather than silently disable controls.
  requireServerKey();
  try {
    const result = await rpc('portal_security_status', {});
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new HTTPError(502, 'SECURITY_STATUS_INVALID', 'The portal security status response was invalid.');
    }
    return result;
  } catch (error) {
    if (migrationNotReady(error)) return { ready: false, setupRequired: true };
    if (error instanceof HTTPError) throw error;
    throw new HTTPError(502, 'SECURITY_STATUS_UNAVAILABLE', 'Could not read portal security status.');
  }
}

function bearerFromRequest(req) {
  const value = String(req?.headers?.authorization || '');
  const match = /^Bearer\s+(\S+)$/i.exec(value);
  if (!match) throw new HTTPError(401, 'AUTH_REQUIRED', 'A valid sign-in is required.');
  return match[1];
}

async function verifyBearer(req) {
  const token = bearerFromRequest(req);
  requireServerKey();
  const result = await requestJson(
    `${SUPABASE_URL}/auth/v1/user`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` } },
    'Could not verify the sign-in with Supabase.'
  );
  if (!result.response.ok) {
    if ([401, 403].includes(result.response.status)) {
      throw new HTTPError(401, 'AUTH_REQUIRED', 'Your sign-in is missing or expired. Please sign in again.');
    }
    throw new HTTPError(502, 'AUTH_VERIFICATION_FAILED', 'The sign-in could not be verified. Please try again.');
  }
  const actor = result.data;
  if (!actor || typeof actor !== 'object' || !actor.id) {
    throw new HTTPError(401, 'AUTH_REQUIRED', 'Your sign-in is missing or expired. Please sign in again.');
  }
  return { actor, token };
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !parts[1]) throw new HTTPError(401, 'APP_SESSION_REQUIRED', 'The application session could not be verified.');
  let decoded;
  try {
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = encoded + '='.repeat((4 - (encoded.length % 4)) % 4);
    if (typeof Buffer !== 'undefined') decoded = Buffer.from(padded, 'base64').toString('utf8');
    else if (typeof atob === 'function') decoded = atob(padded);
    else throw new Error('No base64 decoder');
    return JSON.parse(decoded);
  } catch (_) {
    throw new HTTPError(401, 'APP_SESSION_REQUIRED', 'The application session could not be verified.');
  }
}

function sessionIdFromToken(token) {
  const sessionId = decodeJwtPayload(token)?.session_id;
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) {
    throw new HTTPError(401, 'APP_SESSION_REQUIRED', 'The application session could not be verified.');
  }
  return sessionId;
}

function activeAdmin(profile) {
  return Boolean(profile)
    && String(profile.status || '').trim().toLowerCase() === 'active'
    && ADMIN_ROLES.has(String(profile.role || '').trim().toLowerCase());
}

function activeMainAdmin(profile) {
  return Boolean(profile)
    && String(profile.status || '').trim().toLowerCase() === 'active'
    && String(profile.role || '').trim().toLowerCase() === 'main-admin';
}

async function getProfile(actor, mainCheck = false) {
  requireServerKey();
  if (!actor?.id) throw new HTTPError(401, 'AUTH_REQUIRED', 'Your sign-in is missing or expired. Please sign in again.');
  const query = `profiles?id=eq.${encodeURIComponent(String(actor.id))}&select=id,email,name,display_name,role,status&limit=1`;
  const result = await requestJson(
    `${SUPABASE_URL}/rest/v1/${query}`,
    { headers: upstreamHeaders(SERVICE_ROLE_KEY) },
    'Could not verify the account profile.'
  );
  if (!result.response.ok) throw new HTTPError(502, 'PROFILE_LOOKUP_FAILED', 'The account profile could not be verified.');
  const profile = Array.isArray(result.data) ? result.data[0] || null : null;
  if (!profile || String(profile.id) !== String(actor.id)) {
    throw new HTTPError(403, 'PROFILE_REQUIRED', 'This account does not have an active administration profile.');
  }
  if (mainCheck ? !activeMainAdmin(profile) : !activeAdmin(profile)) {
    throw new HTTPError(403, mainCheck ? 'MAIN_ADMIN_REQUIRED' : 'ADMIN_ACCESS_REQUIRED', mainCheck ? 'Only an active Main Admin can change portal security settings.' : 'This account does not have active administration access.');
  }
  return profile;
}

async function requireSession(actor, token, action = 'check', statusResult) {
  if (!ACTIONS.has(action)) throw new HTTPError(400, 'INVALID_SESSION_ACTION', 'The application session action is invalid.');
  const status = statusResult || await getStatus();
  if (status?.ready !== true) {
    if (status?.setupRequired === true) return status;
    throw new HTTPError(503, 'SECURITY_STATUS_UNAVAILABLE', 'Portal security is not ready.');
  }
  const sessionId = sessionIdFromToken(token);
  const result = await rpc('portal_session', {
    p_actor: actor?.id,
    p_session: sessionId,
    p_action: action
  });
  if (!result || typeof result !== 'object') throw new HTTPError(502, 'SECURITY_SESSION_INVALID', 'The application session response was invalid.');
  // Closing is an authorized revocation operation. It must not require a
  // currently-valid row, otherwise an expired session could never be closed.
  if (action !== 'close' && result.valid !== true) {
    throw new HTTPError(403, 'APP_SESSION_EXPIRED', 'Your application session has expired. Please sign in again.');
  }
  return result;
}

module.exports = {
  SUPABASE_URL,
  PUBLIC_ANON_KEY,
  UUID,
  ADMIN_ROLES,
  HTTPError,
  errorBody,
  sendJson,
  rpc,
  getStatus,
  verifyBearer,
  sessionIdFromToken,
  getProfile,
  requireSession,
  activeAdmin,
  activeMainAdmin
};
