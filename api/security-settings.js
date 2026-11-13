'use strict';

const security = require('../server/portal-security.cjs');
const { HTTPError, errorBody, sendJson } = security;

const POLICY_RULES = {
  sessionTimeoutMinutes: [5, 1440],
  failedLoginLimit: [1, 20],
  lockoutMinutes: [1, 1440],
  backupRetention: [1, 100]
};
const SETTINGS_KEYS = new Set(['policy', 'values', 'logo', ...Object.keys(POLICY_RULES), 'autoBackupEnabled']);
const POLICY_KEYS = new Set([...Object.keys(POLICY_RULES), 'autoBackupEnabled']);

function parseBody(req) {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid');
    return body;
  } catch (_) {
    throw new HTTPError(400, 'INVALID_JSON', 'Invalid JSON request.');
  }
}

function fullRequested(req) {
  if (req.query && (req.query.full === '1' || req.query.full === 1 || req.query.full === true)) return true;
  try { return new URL(String(req.url || ''), 'http://localhost').searchParams.get('full') === '1'; } catch (_) { return false; }
}

function publicStatus(status) {
  const result = { ready: status?.ready === true };
  if (status?.setupRequired === true) result.setupRequired = true;
  if (status?.ready === true) result.policy = status.policy || null;
  return result;
}

function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HTTPError(400, 'INVALID_SETTINGS', 'Settings must be a JSON object.');
  for (const key of Object.keys(value)) {
    if (!SETTINGS_KEYS.has(key)) throw new HTTPError(400, 'INVALID_SETTINGS', `The setting ${key} is not supported.`);
  }

  // The existing settings form uses { values, logo }, where values also holds
  // church profile fields. A direct { policy } object and direct policy fields
  // remain supported for API callers.
  const policy = value.policy !== undefined ? value.policy : (value.values !== undefined ? value.values : value);
  if (policy !== undefined && (!policy || typeof policy !== 'object' || Array.isArray(policy))) {
    throw new HTTPError(400, 'INVALID_SETTINGS', 'The security policy must be a JSON object.');
  }
  if (policy) {
    for (const key of Object.keys(policy)) {
      // Canonical values may contain the church name, contact details,
      // timezone, and maintenance preference; only known policy fields need
      // security validation in that wrapper.
      if (!POLICY_KEYS.has(key)) {
        if (value.values !== undefined && value.policy === undefined) continue;
        throw new HTTPError(400, 'INVALID_SETTINGS', `The policy setting ${key} is not supported.`);
      }
      if (key === 'autoBackupEnabled') {
        if (typeof policy[key] !== 'boolean') throw new HTTPError(400, 'INVALID_SETTINGS', 'Automatic backup must be true or false.');
      } else if (policy[key] !== undefined) {
        const [min, max] = POLICY_RULES[key];
        const numeric = typeof policy[key] === 'string' && /^\d+$/.test(policy[key]) ? Number(policy[key]) : policy[key];
        if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
          throw new HTTPError(400, 'INVALID_SETTINGS', `${key} must be a whole number from ${min} to ${max}.`);
        }
      }
    }
  }
  if (value.values !== undefined && (!value.values || typeof value.values !== 'object' || Array.isArray(value.values))) {
    throw new HTTPError(400, 'INVALID_SETTINGS', 'Church profile values must be a JSON object.');
  }
  if (value.logo !== undefined && value.logo !== null && typeof value.logo !== 'string') {
    throw new HTTPError(400, 'INVALID_SETTINGS', 'The logo value must be text or null.');
  }
  return value;
}

async function statusOrError() {
  const status = await security.getStatus();
  if (status?.ready !== true && status?.setupRequired !== true) {
    throw new HTTPError(503, 'SECURITY_STATUS_UNAVAILABLE', 'Portal security is not ready.');
  }
  return status;
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed.' });

  let status;
  try { status = await statusOrError(); } catch (error) {
    return sendJson(res, error.status || 502, errorBody(error, 'Portal security could not be checked.'));
  }
  if (status?.ready !== true) return sendJson(res, 200, publicStatus(status));

  if (req.method === 'GET' && !fullRequested(req)) {
    return sendJson(res, 200, publicStatus(status));
  }

  let verified;
  try {
    verified = await security.verifyBearer(req);
    await security.getProfile(verified.actor, true);
    await security.requireSession(verified.actor, verified.token, 'check', status);
  } catch (error) {
    return sendJson(res, error.status || 502, errorBody(error, 'Only an active Main Admin with a valid application session can access these settings.'));
  }

  if (req.method === 'GET') {
    return sendJson(res, 200, { ready: true, policy: status.policy || null, settings: status.settings || null });
  }

  let input;
  try { input = parseBody(req); } catch (error) { return sendJson(res, error.status, errorBody(error)); }
  if (!Object.prototype.hasOwnProperty.call(input, 'settings')) {
    return sendJson(res, 400, { code: 'INVALID_SETTINGS', error: 'A settings object is required.' });
  }

  let settings;
  try { settings = validateSettings(input.settings); } catch (error) { return sendJson(res, error.status || 400, errorBody(error)); }

  try {
    // requireSession above has already verified Auth and the native session;
    // parsing this UUID is therefore never used as a pre-verification trust
    // decision. The RPC remains the authoritative persistence transaction.
    const sessionId = security.sessionIdFromToken(verified.token);
    const saved = await security.rpc('portal_save_settings', {
      p_actor: verified.actor.id,
      p_session: sessionId,
      p_settings: settings
    });
    if (!saved || typeof saved !== 'object') throw new HTTPError(502, 'SETTINGS_SAVE_INVALID', 'Portal security returned an invalid save result.');
    return sendJson(res, 200, { ready: true, ...saved });
  } catch (error) {
    return sendJson(res, error.status || 502, errorBody(error, 'Settings were not persisted. Please try again.'));
  }
};
