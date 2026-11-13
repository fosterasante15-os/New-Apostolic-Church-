const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'api/admin-reset-password.js'), 'utf8');
const secretKey = 'sb_secret_synthetic_server_key';
const legacyKey = 'eyJ.synthetic-service-role.jwt';
const actor = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@example.com', user_metadata: { role: 'member' } };
const target = { id: '22222222-2222-4222-8222-222222222222', email: 'member@example.com' };
const activeMain = [{ id: actor.id, role: ' MAIN-ADMIN ', status: 'Active' }];

function reply(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => data === undefined ? '' : JSON.stringify(data),
    json: async () => data
  };
}

function loadEndpoint(key, responses, adminKey = '') {
  const calls = [];
  const context = {
    module: { exports: {} },
    require: () => ({ requireSession: async () => ({ ready: false }) }),
    console: { warn() {} },
    process: { env: { SUPABASE_SERVICE_ROLE_KEY: key, SUPABASE_AUTH_ADMIN_KEY: adminKey } },
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      const next = responses.shift();
      assert.ok(next, `Unexpected upstream request: ${url}`);
      if (next instanceof Error) throw next;
      return next;
    }
  };
  vm.runInNewContext(source, context);
  return { handler: context.module.exports, calls };
}

async function invoke(endpoint, changes = {}) {
  const request = {
    method: 'POST',
    headers: { authorization: 'Bearer caller-user-jwt' },
    body: { userId: target.id, password: 'A-new-password-42' },
    ...changes
  };
  const res = {
    headers: {},
    status(value) { this.code = value; return this; },
    setHeader(key, value) { this.headers[key] = value; return this; },
    end(value) { this.body = JSON.parse(value); return this; }
  };
  await endpoint.handler(request, res);
  return res;
}

function happy(targetUser = target) {
  return [reply(200, actor), reply(200, activeMain), reply(200, targetUser), reply(200, { user: targetUser })];
}

test('method and malformed authentication guards do not reach Supabase', async () => {
  for (const changes of [{ method: 'GET' }, { headers: {} }, { headers: { authorization: 'Basic bad' } }, { headers: { authorization: 'Bearer' } }]) {
    const endpoint = loadEndpoint(secretKey, []);
    const res = await invoke(endpoint, changes);
    assert.equal(res.code, changes.method === 'GET' ? 405 : 401);
    assert.equal(endpoint.calls.length, 0);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
});

test('missing server configuration is explicit and does not call upstream', async () => {
  const endpoint = loadEndpoint('', []);
  const res = await invoke(endpoint);
  assert.equal(res.code, 503);
  assert.equal(endpoint.calls.length, 0);
});

test('malformed JSON and malformed request bodies are rejected before privileged calls', async () => {
  for (const body of ['not-json', null, [], { userId: target.id }, { userId: 'not-a-uuid', password: 'A-new-password-42' }]) {
    const endpoint = loadEndpoint(secretKey, []);
    const res = await invoke(endpoint, { body });
    assert.equal(res.code, 400);
    assert.equal(endpoint.calls.length, 0);
  }
});

test('expired or missing caller sessions return 401 and never inspect profiles', async () => {
  const endpoint = loadEndpoint(secretKey, [reply(401, { msg: 'Expired JWT' })]);
  const res = await invoke(endpoint);
  assert.equal(res.code, 401);
  assert.equal(endpoint.calls.length, 1);

  const missingActor = loadEndpoint(secretKey, [reply(200, { user_metadata: { role: 'main-admin' } })]);
  assert.equal((await invoke(missingActor)).code, 401);
  assert.equal(missingActor.calls.length, 1);
});

test('non-Main-Admin and inactive Main Admin profiles cannot reset passwords', async () => {
  for (const profile of [{ role: 'admin', status: 'Active' }, { role: 'main-admin', status: 'Inactive' }]) {
    const endpoint = loadEndpoint(secretKey, [reply(200, actor), reply(200, [{ id: actor.id, ...profile }])]);
    const res = await invoke(endpoint);
    assert.equal(res.code, 403);
    assert.equal(endpoint.calls.length, 2);
  }
});

test('request body role/email and Auth user metadata cannot grant Main Admin access', async () => {
  const endpoint = loadEndpoint(secretKey, [reply(200, { ...actor, user_metadata: { role: 'main-admin' } }), reply(200, [{ id: actor.id, role: 'member', status: 'Active' }])]);
  const res = await invoke(endpoint, { body: { userId: target.id, password: 'A-new-password-42', role: 'main-admin', email: 'admin@example.com', status: 'Active' } });
  assert.equal(res.code, 403);
  assert.equal(endpoint.calls.length, 2);
  assert.match(endpoint.calls[1].url, /profiles\?id=eq\.11111111-1111-4111-8111-111111111111&select=id,role,status&limit=1$/);
});

test('normalized main-admin role with Active status can reset a real target account', async () => {
  const endpoint = loadEndpoint(secretKey, happy());
  const res = await invoke(endpoint);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true, userId: target.id });
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(endpoint.calls.length, 4);
  assert.match(endpoint.calls[2].url, new RegExp(`/auth/v1/admin/users/${target.id}$`));
  assert.equal(endpoint.calls[3].method, 'PUT');
  assert.deepEqual(JSON.parse(endpoint.calls[3].body), { password: 'A-new-password-42' });
  assert.equal(Object.keys(JSON.parse(endpoint.calls[3].body)).length, 1);
  assert.equal(JSON.stringify(res.body).includes('A-new-password-42'), false);
});

test('Main Admin can reset own password after target Auth verification', async () => {
  const own = { id: actor.id, email: actor.email };
  const endpoint = loadEndpoint(secretKey, happy(own));
  const res = await invoke(endpoint, { body: { userId: actor.id, password: 'Another-new-password-42' } });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true, userId: actor.id });
  assert.deepEqual(JSON.parse(endpoint.calls[3].body), { password: 'Another-new-password-42' });
});

test('short and weak passwords are rejected consistently before any upstream write', async () => {
  for (const password of ['short', 'password', '12345678', 'QWERTY123']) {
    const endpoint = loadEndpoint(secretKey, []);
    const res = await invoke(endpoint, { body: { userId: target.id, password } });
    assert.equal(res.code, 400);
    assert.match(res.body.error, password.length < 8 ? /at least 8/ : /stronger password/);
    assert.equal(endpoint.calls.length, 0);
  }
});

test('missing target Auth account never issues a password update', async () => {
  const endpoint = loadEndpoint(secretKey, [reply(200, actor), reply(200, activeMain), reply(404, { msg: 'User not found' })]);
  const res = await invoke(endpoint);
  assert.equal(res.code, 404);
  assert.equal(endpoint.calls.length, 3);
});

test('target lookup failure never returns success', async () => {
  const endpoint = loadEndpoint(secretKey, [reply(200, actor), reply(200, activeMain), reply(500, { message: 'Auth unavailable' })]);
  const res = await invoke(endpoint);
  assert.equal(res.code, 502);
  assert.equal(res.body.ok, undefined);
  assert.equal(endpoint.calls.length, 3);
});

test('failed password update never returns success or retries as a user-session error', async () => {
  const endpoint = loadEndpoint(secretKey, [reply(200, actor), reply(200, activeMain), reply(200, target), reply(500, { message: 'update failed' })]);
  const res = await invoke(endpoint);
  assert.equal(res.code, 502);
  assert.equal(res.body.ok, undefined);
  assert.equal(endpoint.calls.length, 4);
});

test('profile/database failures are 502 rather than 401 session failures', async () => {
  const endpoint = loadEndpoint(secretKey, [reply(200, actor), reply(503, { message: 'database unavailable' })]);
  const res = await invoke(endpoint);
  assert.equal(res.code, 502);
  assert.equal(endpoint.calls.length, 2);
});

test('network failures are caught without leaking key or password', async () => {
  const endpoint = loadEndpoint(secretKey, [new Error('synthetic network failure')]);
  const res = await invoke(endpoint);
  assert.equal(res.code, 502);
  const serialized = JSON.stringify(res.body);
  assert.equal(serialized.includes(secretKey), false);
  assert.equal(serialized.includes('A-new-password-42'), false);
});

test('new secret-key headers omit Authorization while caller keeps its JWT', async () => {
  const endpoint = loadEndpoint(secretKey, happy());
  assert.equal((await invoke(endpoint)).code, 200);
  assert.equal(endpoint.calls[0].headers.Authorization, 'Bearer caller-user-jwt');
  assert.equal(endpoint.calls[0].headers.apikey, secretKey);
  for (const call of endpoint.calls.slice(1)) {
    assert.equal(call.headers.apikey, secretKey);
    assert.equal(call.headers.Authorization, undefined);
  }
});

test('legacy Auth Admin key is used only for Auth Admin GET and PUT', async () => {
  const endpoint = loadEndpoint(secretKey, happy(), legacyKey);
  assert.equal((await invoke(endpoint)).code, 200);
  assert.equal(endpoint.calls[0].headers.apikey, secretKey);
  assert.equal(endpoint.calls[0].headers.Authorization, 'Bearer caller-user-jwt');
  assert.equal(endpoint.calls[1].headers.apikey, secretKey);
  assert.equal(endpoint.calls[1].headers.Authorization, undefined);
  for (const call of endpoint.calls.slice(2)) {
    assert.equal(call.headers.apikey, legacyKey);
    assert.equal(call.headers.Authorization, `Bearer ${legacyKey}`);
  }
});

test('server Auth Admin key rejection is a 502, never an expired-session 401', async () => {
  const endpoint = loadEndpoint(secretKey, [reply(200, actor), reply(200, activeMain), reply(403, { error_code: 'bad_jwt', msg: 'invalid JWT' }), reply(403, { error_code: 'bad_jwt', msg: 'invalid JWT' })]);
  const res = await invoke(endpoint);
  assert.equal(res.code, 502);
  assert.equal(res.body.code, 'bad_jwt');
  assert.equal(endpoint.calls.length, 4);
  assert.match(res.body.error, /SUPABASE_AUTH_ADMIN_KEY/);
  assert.equal(JSON.stringify(res.body).includes(secretKey), false);
});

test('secret Auth Admin compatibility retry uses the exact key only after rejected GET', async () => {
  const endpoint = loadEndpoint(secretKey, [reply(200, actor), reply(200, activeMain), reply(401, { msg: 'This endpoint requires a valid Bearer token' }), reply(200, target), reply(200, {})]);
  assert.equal((await invoke(endpoint)).code, 200);
  assert.equal(endpoint.calls.length, 5);
  assert.equal(endpoint.calls[2].headers.Authorization, undefined);
  assert.equal(endpoint.calls[3].headers.Authorization, `Bearer ${secretKey}`);
  assert.equal(endpoint.calls[3].headers.apikey, secretKey);
});

test('secret Auth Admin compatibility retry also supports rejected PUT without duplicating a successful write', async () => {
  const endpoint = loadEndpoint(secretKey, [reply(200, actor), reply(200, activeMain), reply(200, target), reply(401, { msg: 'requires a valid Bearer token' }), reply(200, {})]);
  assert.equal((await invoke(endpoint)).code, 200);
  assert.equal(endpoint.calls.length, 5);
  assert.equal(endpoint.calls[3].headers.Authorization, undefined);
  assert.equal(endpoint.calls[4].headers.Authorization, `Bearer ${secretKey}`);
  assert.equal(endpoint.calls[3].body, endpoint.calls[4].body);
});
