'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVICE_KEY = 'sb_secret_synthetic_server_key';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zY2NtZmV2dmt2amh2eHJ0bWF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5NzAyMjUsImV4cCI6MjEwOTU0NjIyNX0.74g0XDDodI8rZ9FJvcnbTwh85Jy_XHBsn44TxnwbLok';
const ACTOR = { id: 'actor-id', email: 'admin@example.com' };
const MAIN_PROFILE = { id: ACTOR.id, email: ACTOR.email, role: 'main-admin', status: 'Active' };
const ADMIN_PROFILE = { id: ACTOR.id, email: ACTOR.email, role: 'admin', status: 'Active' };
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const jwt = payload => `header.${Buffer.from(JSON.stringify({ sub: ACTOR.id, ...payload })).toString('base64url')}.signature`;

function reply(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body === undefined ? '' : JSON.stringify(body),
    json: async () => body
  };
}
function response(res, status = 200) {
  return {
    headers: {},
    status(value) { this.code = value; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    end(value) { this.body = JSON.parse(value); return this; },
    code: status
  };
}
function loadSecurity() {
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  const file = require.resolve('../server/portal-security.cjs');
  delete require.cache[file];
  return require(file);
}
async function call(handler, changes = {}) {
  const req = { method: 'POST', headers: { authorization: `Bearer ${jwt({ session_id: SESSION_ID })}` }, body: {}, ...changes };
  const res = response();
  await handler(req, res);
  return res;
}
function loadApi(file) {
  const target = require.resolve(path.join(ROOT, file));
  delete require.cache[target];
  return require(target);
}

let oldFetch;
test.beforeEach(() => {
  oldFetch = global.fetch;
  loadSecurity();
});
test.afterEach(() => { global.fetch = oldFetch; });

test('status converts only known missing migration errors into setupRequired', async () => {
  const security = loadSecurity();
  global.fetch = async () => reply(404, { code: 'PGRST202', message: 'function does not exist' });
  assert.deepEqual(await security.getStatus(), { ready: false, setupRequired: true });

  global.fetch = async () => { throw new Error('network down'); };
  await assert.rejects(security.getStatus(), error => error.code === 'SECURITY_UPSTREAM_UNAVAILABLE');
});

test('secret server key is apikey-only while caller JWT remains bearer', async () => {
  const security = loadSecurity();
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return reply(200, ACTOR);
    return reply(200, { ready: true, policy: {} });
  };
  const verified = await security.verifyBearer({ headers: { authorization: 'Bearer caller.jwt' } });
  assert.equal(verified.actor.id, ACTOR.id);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer caller.jwt');
  assert.equal(calls[0].options.headers.apikey, SERVICE_KEY);
  assert.equal(calls[0].options.headers['content-type'], undefined);
});

test('login exposes setup fallback without calling Auth or counters', async () => {
  const security = loadSecurity();
  const login = loadApi('api/security-login.js');
  let calls = 0;
  global.fetch = async () => { calls++; return reply(404, { code: 'PGRST205' }); };
  const res = await call(login, { body: { email: 'admin@example.com', password: 'correct-password' } });
  assert.equal(res.code, 503);
  assert.equal(res.body.code, 'SETUP_REQUIRED');
  assert.equal(calls, 1);
  void security;
});

test('login counts incorrect credentials but never counts provider failures', async () => {
  const login = loadApi('api/security-login.js');
  const finishCalls = [];
  let mode = 'credentials';
  global.fetch = async (url, options) => {
    if (url.includes('/rpc/portal_security_status')) return reply(200, { ready: true, policy: {} });
    if (url.includes('/rpc/portal_begin_login')) return reply(200, { allowed: true, ticket: 'ticket-1' });
    if (url.includes('/auth/v1/token')) {
      if (mode === 'credentials') return reply(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      throw new Error('provider unavailable');
    }
    if (url.includes('/rpc/portal_finish_login')) {
      const body = JSON.parse(options.body); finishCalls.push(body);
      return reply(200, { allowed: true });
    }
    throw new Error(`unexpected ${url}`);
  };
  const bad = await call(login, { body: { email: 'admin@example.com', password: 'correct-password' } });
  assert.equal(bad.code, 401);
  assert.equal(finishCalls[0].p_success, false);
  mode = 'provider';
  const unavailable = await call(login, { body: { email: 'admin@example.com', password: 'correct-password' } });
  assert.equal(unavailable.code, 502);
  assert.equal(finishCalls[1].p_success, null);
});

test('locked begin and successful login use atomic results across requests', async () => {
  const login = loadApi('api/security-login.js');
  let beginCount = 0;
  let finishCount = 0;
  global.fetch = async (url, options) => {
    if (url.includes('/rpc/portal_security_status')) return reply(200, { ready: true, policy: { failedLoginLimit: 5 } });
    if (url.includes('/rpc/portal_begin_login')) {
      beginCount++;
      return beginCount === 1 ? reply(200, { allowed: false, retryAfterSeconds: 61, lockedUntil: 'later' }) : reply(200, { allowed: true, ticket: 'ticket-2' });
    }
    if (url.includes('/auth/v1/token')) return reply(200, { access_token: 'access', refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600, user: ACTOR });
    if (url.includes('/rest/v1/profiles')) return reply(200, [ADMIN_PROFILE]);
    if (url.includes('/rpc/portal_finish_login')) { finishCount++; return reply(200, { allowed: true }); }
    throw new Error(`unexpected ${url}`);
  };
  const locked = await call(login, { body: { email: 'admin@example.com', password: 'correct-password' } });
  assert.equal(locked.code, 429);
  assert.equal(locked.body.code, 'LOGIN_LOCKED');
  assert.match(locked.body.error, /Try again in/);
  const ok = await call(login, { body: { email: 'admin@example.com', password: 'correct-password' } });
  assert.equal(ok.code, 200);
  assert.equal(ok.body.session.access_token, 'access');
  assert.equal(ok.body.session.refresh_token, 'refresh');
  assert.equal(ok.body.securityEnabled, true);
  assert.equal(finishCount, 1);
});

test('session verifies Auth before parsing native session ID and rejects expired rows', async () => {
  const session = loadApi('api/security-session.js');
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/rpc/portal_security_status')) return reply(200, { ready: true, policy: {} });
    if (url.endsWith('/auth/v1/user')) return reply(200, ACTOR);
    if (url.includes('/rest/v1/profiles')) return reply(200, [ADMIN_PROFILE]);
    if (url.includes('/rpc/portal_session')) return reply(200, { valid: false, expired: true, sessionId: SESSION_ID });
    throw new Error(`unexpected ${url}`);
  };
  const res = await call(session, { body: { action: 'check' } });
  assert.equal(res.code, 403);
  assert.equal(res.body.code, 'APP_SESSION_EXPIRED');
  assert.equal(calls.filter(x => x.url.includes('/rpc/portal_session')).length, 1);
  const authIndex = calls.findIndex(x => x.url.endsWith('/auth/v1/user'));
  const rpcIndex = calls.findIndex(x => x.url.includes('/rpc/portal_session'));
  assert.ok(authIndex < rpcIndex);
});

test('close is authorized without a valid check and never revives an expired session', async () => {
  const session = loadApi('api/security-session.js');
  let action;
  global.fetch = async (url, options) => {
    if (url.includes('/rpc/portal_security_status')) return reply(200, { ready: true });
    if (url.endsWith('/auth/v1/user')) return reply(200, ACTOR);
    if (url.includes('/rest/v1/profiles')) return reply(200, [ADMIN_PROFILE]);
    if (url.includes('/rpc/portal_session')) { action = JSON.parse(options.body).p_action; return reply(200, { valid: false, expired: true, closed: true }); }
    throw new Error(`unexpected ${url}`);
  };
  const res = await call(session, { body: { action: 'close' } });
  assert.equal(res.code, 200);
  assert.equal(action, 'close');
  assert.equal(res.body.valid, false);
});

test('settings public response omits snapshots and full settings requires active Main Admin', async () => {
  const settings = loadApi('api/security-settings.js');
  global.fetch = async url => {
    if (url.includes('/rpc/portal_security_status')) return reply(200, { ready: true, policy: { sessionTimeoutMinutes: 30 }, settings: { values: { churchName: 'NAC' }, logo: 'private-logo' } });
    throw new Error(`unexpected ${url}`);
  };
  const publicRes = await call(settings, { method: 'GET', headers: {}, url: '/api/security-settings' });
  assert.equal(publicRes.code, 200);
  assert.equal(publicRes.body.settings, undefined);
  assert.deepEqual(publicRes.body.policy, { sessionTimeoutMinutes: 30 });

  global.fetch = async url => {
    if (url.includes('/rpc/portal_security_status')) return reply(200, { ready: true, policy: {}, settings: {} });
    if (url.endsWith('/auth/v1/user')) return reply(200, ACTOR);
    if (url.includes('/rest/v1/profiles')) return reply(200, [{ ...ADMIN_PROFILE, role: 'admin' }]);
    throw new Error(`unexpected ${url}`);
  };
  const denied = await call(settings, { method: 'GET', url: '/api/security-settings?full=1' });
  assert.equal(denied.code, 403);
  assert.equal(denied.body.code, 'MAIN_ADMIN_REQUIRED');
});

test('settings validates ranges after Main Admin/session authorization and saves persisted result', async () => {
  const settings = loadApi('api/security-settings.js');
  let saveBody;
  global.fetch = async (url, options) => {
    if (url.includes('/rpc/portal_security_status')) return reply(200, { ready: true, policy: {} });
    if (url.endsWith('/auth/v1/user')) return reply(200, ACTOR);
    if (url.includes('/rest/v1/profiles')) return reply(200, [MAIN_PROFILE]);
    if (url.includes('/rpc/portal_session')) return reply(200, { valid: true, sessionId: SESSION_ID });
    if (url.includes('/rpc/portal_save_settings')) { saveBody = JSON.parse(options.body); return reply(200, { ready: true, policy: saveBody.p_settings.policy, settings: saveBody.p_settings }); }
    throw new Error(`unexpected ${url}`);
  };
  const invalid = await call(settings, { body: { settings: { policy: { sessionTimeoutMinutes: 4 } } } });
  assert.equal(invalid.code, 400);
  assert.equal(invalid.body.code, 'INVALID_SETTINGS');
  assert.equal(saveBody, undefined);
  const valid = await call(settings, { body: { settings: { values: { churchName: 'NAC', sessionTimeoutMinutes: '30', failedLoginLimit: '5', lockoutMinutes: '15', backupRetention: '10', autoBackupEnabled: false }, logo: null } } });
  assert.equal(valid.code, 200);
  assert.equal(valid.body.ready, true);
  assert.equal(saveBody.p_actor, ACTOR.id);
  assert.equal(saveBody.p_session, SESSION_ID);
  assert.equal(saveBody.p_settings.values.sessionTimeoutMinutes, '30');
});

test('native session ID rejects malformed or missing session_id claims', () => {
  const security = loadSecurity();
  assert.throws(() => security.sessionIdFromToken(jwt({ session_id: 'not-a-uuid' })), error => error.code === 'APP_SESSION_REQUIRED');
  assert.throws(() => security.sessionIdFromToken(jwt({})), error => error.code === 'APP_SESSION_REQUIRED');
  assert.equal(security.sessionIdFromToken(jwt({ session_id: SESSION_ID })), SESSION_ID);
  assert.equal(ANON_KEY.startsWith('eyJ'), true);
});

test('first bad password is not mislabeled as an active lockout', async () => {
  const login = loadApi('api/security-login.js');
  global.fetch = async url => {
    if (url.includes('portal_security_status')) return reply(200, { ready: true, policy: {} });
    if (url.includes('portal_begin_login')) return reply(200, { allowed: true, ticket: 'one' });
    if (url.includes('/auth/v1/token')) return reply(400, { code: 'invalid_credentials' });
    return reply(200, { allowed: false, retryAfterSeconds: 0, lockedUntil: null });
  };
  const res = await call(login, { body: { email: ACTOR.email, password: 'bad-password' } });
  assert.equal(res.code, 401); assert.equal(res.body.code, 'INVALID_CREDENTIALS');
});
test('email-confirmation/provider refusals never add a bad-password count', async () => {
  const login = loadApi('api/security-login.js'); let outcome;
  global.fetch = async (url, options) => {
    if (url.includes('portal_security_status')) return reply(200, { ready: true, policy: {} });
    if (url.includes('portal_begin_login')) return reply(200, { allowed: true, ticket: 'one' });
    if (url.includes('/auth/v1/token')) return reply(400, { code: 'email_not_confirmed' });
    outcome = JSON.parse(options.body).p_success; return reply(200, { allowed: true });
  };
  await call(login, { body: { email: ACTOR.email, password: 'valid-password' } }); assert.equal(outcome, null);
});
test('backup endpoint maps unauthorized creation and pruned downloads to errors', async () => {
  const backups = loadApi('api/backups.js'); let mode = 'forbidden';
  global.fetch = async url => {
    if (url.endsWith('/auth/v1/user')) return reply(200, ACTOR);
    if (url.includes('portal_security_status')) return reply(200, { ready: true });
    if (url.includes('portal_session')) return reply(200, { valid: true });
    if (mode === 'forbidden') return reply(200, { created: false, reason: 'main-admin-required' });
    return reply(200, { id: SESSION_ID, createdAt: null, data: null });
  };
  assert.equal((await call(backups, { body: { automatic: false } })).code, 403);
  mode = 'missing'; assert.equal((await call(backups, { method: 'GET', url: '/api/backups?id=' + SESSION_ID })).code, 404);
});
