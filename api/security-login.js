'use strict';

const security = require('../server/portal-security.cjs');
const { HTTPError, errorBody, sendJson } = security;

const WEAK_PASSWORDS = new Set(['12345678', '123456789', '1234567890', '123456', '11111111', 'admin123', 'admin', 'password', 'password1', 'password123', 'qwerty123']);
const EMAIL = /^\S+@\S+\.\S+$/;

function parseBody(req) {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid');
    return body;
  } catch (_) {
    throw new HTTPError(400, 'INVALID_JSON', 'Invalid JSON request.');
  }
}

async function responseJson(response) {
  try {
    if (typeof response.text === 'function') {
      const text = await response.text();
      if (!text) return null;
      try { return JSON.parse(text); } catch (_) { return null; }
    }
    if (typeof response.json === 'function') return await response.json();
  } catch (_) {}
  return null;
}

function retrySeconds(result) {
  const n = Number(result?.retryAfterSeconds);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 86400) : 0;
}

function lockedBody(result) {
  const seconds = retrySeconds(result);
  if (!result?.lockedUntil) return { code: 'LOGIN_BUSY', error: 'Another sign-in is being checked for this account. Try again in a moment.', retryAfterSeconds: Math.min(seconds || 1, 5), lockedUntil: null };
  const wait = seconds >= 3600
    ? `${Math.ceil(seconds / 3600)} hour${Math.ceil(seconds / 3600) === 1 ? '' : 's'}`
    : `${Math.max(1, Math.ceil(seconds / 60))} minute${Math.max(1, Math.ceil(seconds / 60)) === 1 ? '' : 's'}`;
  return {
    code: 'LOGIN_LOCKED',
    error: `Sign-in is temporarily locked. Try again in ${wait}.`,
    retryAfterSeconds: seconds,
    lockedUntil: result?.lockedUntil || null
  };
}

function isCredentialFailure(response, data) {
  const code = String(data?.error_code || data?.code || '').toLowerCase();
  const message = String(data?.msg || data?.message || data?.error_description || '').toLowerCase();
  return [400, 401].includes(Number(response?.status)) && (
    ['invalid_grant', 'invalid_credentials', 'invalid_login_credentials'].includes(code)
    || /invalid login credentials|invalid credentials|email or password|user not found/.test(message)
  );
}

async function nativePasswordSignIn(email, password) {
  let response;
  try {
    response = await fetch(`${security.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: security.PUBLIC_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
  } catch (_) {
    return { kind: 'provider', data: null };
  }
  const data = await responseJson(response);
  if (!response.ok) return { kind: isCredentialFailure(response, data) ? 'credentials' : 'provider', data };
  if (!data?.access_token || !data?.refresh_token || !data?.user?.id) return { kind: 'provider', data: null };
  return { kind: 'success', data };
}

async function finish(email, ticket, success) {
  return security.rpc('portal_finish_login', {
    p_email: email,
    p_ticket: ticket,
    p_success: success
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed.' });

  let input;
  try { input = parseBody(req); } catch (error) { return sendJson(res, error.status, errorBody(error)); }
  const email = String(input.email || '').trim().toLowerCase();
  const password = typeof input.password === 'string' ? input.password : '';
  if (!EMAIL.test(email)) return sendJson(res, 400, { code: 'INVALID_EMAIL', error: 'Enter a valid email address.' });
  if (password.length < 6) return sendJson(res, 400, { code: 'INVALID_PASSWORD', error: 'Password must be at least 6 characters.' });
  if (WEAK_PASSWORDS.has(password.toLowerCase())) return sendJson(res, 400, { code: 'WEAK_PASSWORD', error: 'That password is not allowed because it is too easy to guess. Ask the Main Admin to set a new one.' });

  let status;
  try {
    status = await security.getStatus();
    if (status?.ready !== true) {
      if (status?.setupRequired === true) return sendJson(res, 503, { code: 'SETUP_REQUIRED', error: 'Portal security setup is required before secure sign-in can be used.', ready: false, setupRequired: true });
      throw new HTTPError(503, 'SECURITY_STATUS_UNAVAILABLE', 'Portal security is not ready.');
    }
  } catch (error) {
    return sendJson(res, error.status || 502, errorBody(error, 'Portal security could not be checked. Sign-in was not attempted.'));
  }

  let begun;
  try {
    begun = await security.rpc('portal_begin_login', { p_email: email });
  } catch (error) {
    return sendJson(res, error.status || 502, errorBody(error, 'Portal security could not start the sign-in attempt.'));
  }
  if (!begun || typeof begun !== 'object' || !begun.ticket) {
    if (begun?.allowed === false) return sendJson(res, 429, lockedBody(begun));
    return sendJson(res, 502, { code: 'LOGIN_GUARD_INVALID', error: 'Portal security returned an invalid sign-in decision.' });
  }
  if (begun.allowed === false) return sendJson(res, 429, lockedBody(begun));

  const auth = await nativePasswordSignIn(email, password);
  if (auth.kind === 'provider') {
    try { await finish(email, begun.ticket, null); } catch (_) { /* never convert an upstream failure into a false credential count */ }
    return sendJson(res, 502, { code: 'AUTH_PROVIDER_UNAVAILABLE', error: 'The sign-in provider could not be reached. No failed-login attempt was recorded.' });
  }
  if (auth.kind === 'credentials') {
    let completed;
    try {
      completed = await finish(email, begun.ticket, false);
    } catch (error) {
      return sendJson(res, error.status || 502, errorBody(error, 'The failed sign-in could not be recorded safely.'));
    }
    if (completed?.lockedUntil || retrySeconds(completed) > 0) return sendJson(res, 429, lockedBody(completed));
    return sendJson(res, 401, { code: 'INVALID_CREDENTIALS', error: 'Email or password is incorrect. Check the credentials supplied by the Main Admin.' });
  }

  // Auth issued the token, but the application still authorizes from its own
  // server-side profile. User metadata and request fields never grant a role.
  let profile;
  try {
    profile = await security.getProfile(auth.data.user, false);
  } catch (error) {
    try { await finish(email, begun.ticket, null); } catch (_) {}
    return sendJson(res, error.status || 502, errorBody(error, 'The account profile could not be verified. Sign-in was not completed.'));
  }

  let completed;
  try {
    completed = await finish(email, begun.ticket, true);
  } catch (error) {
    return sendJson(res, error.status || 502, errorBody(error, 'The successful sign-in could not be recorded safely.'));
  }
  if (!completed || completed.allowed !== true) {
    if (completed?.allowed === false) return sendJson(res, 429, lockedBody(completed));
    return sendJson(res, 502, { code: 'LOGIN_GUARD_INVALID', error: 'The successful sign-in was not accepted by portal security.' });
  }

  // Return the normal client-facing Auth shape: the user plus a standard
  // session object containing access/refresh fields. Passwords, keys and
  // login tickets are never returned or logged.
  const { user, ...session } = auth.data;
  const result = { user, session, securityEnabled: true, policy: status.policy || null };
  // Keep the local variable meaningful for static analysis and make it clear
  // that authorization was based on the fetched profile, not Auth metadata.
  void profile;
  return sendJson(res, 200, result);
};
