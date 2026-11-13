'use strict';

const security = require('../server/portal-security.cjs');
const { HTTPError, errorBody, sendJson } = security;

function parseBody(req) {
  try {
    const body = req.body === undefined ? {} : (typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid');
    return body;
  } catch (_) {
    throw new HTTPError(400, 'INVALID_JSON', 'Invalid JSON request.');
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed.' });

  let input;
  try { input = parseBody(req); } catch (error) { return sendJson(res, error.status, errorBody(error)); }
  const action = String(input.action || 'check').trim().toLowerCase();
  if (!new Set(['open', 'check', 'touch', 'close']).has(action)) {
    return sendJson(res, 400, { code: 'INVALID_SESSION_ACTION', error: 'The application session action is invalid.' });
  }

  let status;
  try {
    status = await security.getStatus();
    // During the one-time migration, the old profile/role checks remain the
    // source of access control; this endpoint exposes only setup state.
    if (status?.ready !== true) {
      if (status?.setupRequired === true) return sendJson(res, 200, { ready: false, setupRequired: true });
      throw new HTTPError(503, 'SECURITY_STATUS_UNAVAILABLE', 'Portal security is not ready.');
    }
  } catch (error) {
    return sendJson(res, error.status || 502, errorBody(error, 'Portal security could not be checked.'));
  }

  let verified;
  try {
    verified = await security.verifyBearer(req);
    await security.getProfile(verified.actor, false);
  } catch (error) {
    return sendJson(res, error.status || 502, errorBody(error, 'The signed-in account could not be authorized.'));
  }

  try {
    const session = await security.requireSession(verified.actor, verified.token, action, status);
    return sendJson(res, 200, { ready: true, ...session });
  } catch (error) {
    return sendJson(res, error.status || 502, errorBody(error, 'The application session could not be checked.'));
  }
};
