const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const endpointSource = fs.readFileSync(path.join(root, 'api/admin-create-user.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(root, 'js/supabase-client.js'), 'utf8');

function reply(status, data) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data), json: async () => data };
}
function loadEndpoint(key, responses, adminKey = '') {
  const calls = [];
  const context = { module: { exports: {} }, console: { warn() {} }, process: { env: { SUPABASE_SERVICE_ROLE_KEY: key, SUPABASE_AUTH_ADMIN_KEY: adminKey } }, fetch: async (url, options) => {
    calls.push({ url, ...options });
    const next = responses.shift();
    assert.ok(next, 'Unexpected upstream request');
    if (next instanceof Error) throw next;
    return next;
  } };
  vm.runInNewContext(endpointSource, context);
  return { handler: context.module.exports, calls };
}
async function invoke(endpoint, changes = {}) {
  const request = { method: 'POST', headers: { authorization: 'Bearer test-user-jwt' }, body: { email: 'newuser@example.com', password: 'a-test-password-only', name: 'Test User', role: 'admin', status: 'Active' }, ...changes };
  const res = { headers: {}, status(value) { this.code = value; return this; }, setHeader(key, value) { this.headers[key] = value; return this; }, end(value) { this.body = JSON.parse(value); return this; } };
  await endpoint.handler(request, res);
  return res;
}
const actor = { id: 'actor-id', email: 'other-main-admin@example.com' };
const adminProfile = [{ id: actor.id, email: actor.email, role: 'main-admin', status: 'Active' }];
const happy = () => [reply(200, actor), reply(200, adminProfile), reply(200, { id: 'new-auth-id' }), reply(201, [{ id: 'new-auth-id' }])];

for (const key of ['sb_secret_test_not_a_real_key', 'eyJ.test-legacy-service-role.synthetic']) {
  test(`server headers and successful profile save for ${key.startsWith('sb_secret') ? 'new secret key' : 'legacy service-role JWT'}`, async () => {
    const endpoint = loadEndpoint(key, happy());
    const res = await invoke(endpoint);
    assert.equal(res.code, 201);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.body.user.id, 'new-auth-id');
    assert.equal('password' in res.body.user, false);
    assert.equal(endpoint.calls[0].headers.Authorization, 'Bearer test-user-jwt');
    for (const call of endpoint.calls.slice(1)) {
      assert.equal(call.headers.apikey, key);
      assert.equal(call.headers.Authorization, key.startsWith('sb_secret_') ? undefined : `Bearer ${key}`);
    }
    assert.equal(endpoint.calls[2].url.endsWith('/auth/v1/admin/users'), true);
    assert.equal(JSON.parse(endpoint.calls[2].body).email_confirm, true);
    assert.match(endpoint.calls[3].url, /profiles\?on_conflict=id$/);
    assert.match(endpoint.calls[3].headers.Prefer, /resolution=merge-duplicates/);
    assert.equal(JSON.parse(endpoint.calls[3].body).role, 'admin');
  });
}

test('requests without a valid Bearer header never reach Supabase', async () => {
  for (const authorization of ['', 'invalid', 'Basic bad', 'Bearer']) {
    const endpoint = loadEndpoint('sb_secret_test_only', []);
    const res = await invoke(endpoint, { headers: { authorization } });
    assert.equal(res.code, 401);
    assert.equal(endpoint.calls.length, 0);
  }
});
test('missing configuration has an explicit error', async () => {
  assert.equal((await invoke(loadEndpoint('', []))).code, 503);
});
test('expired caller token never creates an account', async () => {
  const endpoint = loadEndpoint('sb_secret_test_only', [reply(401, { msg: 'Expired JWT' })]);
  assert.equal((await invoke(endpoint)).code, 401);
  assert.equal(endpoint.calls.length, 1);
});
test('non-Main-Admin and inactive Main Admin cannot create users', async () => {
  for (const profile of [{ role: 'admin', status: 'Active' }, { role: 'main-admin', status: 'Inactive' }]) {
    const endpoint = loadEndpoint('sb_secret_test_only', [reply(200, actor), reply(200, [profile])]);
    assert.equal((await invoke(endpoint)).code, 403);
    assert.equal(endpoint.calls.length, 2);
  }
});
test('Foster must not bypass an explicitly inactive profile', async () => {
  const endpoint = loadEndpoint('sb_secret_test_only', [reply(200, { ...actor, email: 'fosterasante15@gmail.com' }), reply(200, [{ role: 'main-admin', status: 'Inactive' }])]);
  assert.equal((await invoke(endpoint)).code, 403);
});
test('profile lookup failure is a server error rather than a user-session error', async () => {
  const endpoint = loadEndpoint('sb_secret_test_only', [reply(200, actor), reply(401, { message: 'Invalid API key' })]);
  assert.equal((await invoke(endpoint)).code, 502);
});
test('rejected server key is not returned as an expired user session', async () => {
  const endpoint = loadEndpoint('sb_secret_test_only', [reply(200, actor), reply(200, adminProfile), reply(401, { msg: 'This endpoint requires a valid Bearer token' }), reply(403, { error_code: 'bad_jwt', msg: 'invalid JWT' })]);
  const res = await invoke(endpoint);
  assert.equal(res.code, 502);
  assert.equal(res.body.code, 'bad_jwt');
  assert.match(res.body.error, /SUPABASE_AUTH_ADMIN_KEY/);
});
test('existing Auth account is not overwritten', async () => {
  const endpoint = loadEndpoint('sb_secret_test_only', [reply(200, actor), reply(200, adminProfile), reply(422, { msg: 'User already registered' })]);
  assert.equal((await invoke(endpoint)).code, 409);
  assert.equal(endpoint.calls.length, 3);
});
test('failed profile write never returns success and attempts Auth rollback', async () => {
  const endpoint = loadEndpoint('sb_secret_test_only', [reply(200, actor), reply(200, adminProfile), reply(200, { id: 'new-auth-id' }), reply(400, { message: 'Profile rejected' }), reply(200, {})]);
  assert.equal((await invoke(endpoint)).code, 502);
  assert.equal(endpoint.calls[4].method, 'DELETE');
  assert.match(endpoint.calls[4].url, /admin\/users\/new-auth-id$/);
});
test('network failures are handled without leaking headers or passwords', async () => {
  const endpoint = loadEndpoint('sb_secret_test_only', [new Error('Synthetic network failure')]);
  const res = await invoke(endpoint);
  assert.equal(res.code, 502);
  assert.equal(JSON.stringify(res.body).includes('sb_secret'), false);
});

function loadCreateUser(client, fetch) {
  const start = clientSource.indexOf('async createUserAccount(payload) {');
  const end = clientSource.indexOf('\n    async getSession()', start);
  const method = clientSource.slice(start, end).trim().replace(/,$/, '');
  return vm.runInNewContext(`({ ${method} }).createUserAccount`, { client, fetch });
}
test('browser refreshes near-expiry session before sending its own access token', async () => {
  let refreshes = 0;
  const create = loadCreateUser({ auth: {
    getSession: async () => ({ data: { session: { access_token: 'old-user-jwt', expires_at: 1 } } }),
    refreshSession: async () => { refreshes++; return { data: { session: { access_token: 'fresh-user-jwt' } } }; }
  } }, async (url, options) => { assert.equal(options.headers.Authorization, 'Bearer fresh-user-jwt'); return reply(201, { user: { id: 'created' } }); });
  assert.equal((await create({ email: 'newuser@example.com' })).user.id, 'created');
  assert.equal(refreshes, 1);
});
test('browser retries a rejected user token once with the refreshed token', async () => {
  const sent = [];
  const create = loadCreateUser({ auth: {
    getSession: async () => ({ data: { session: { access_token: 'old-user-jwt' } } }),
    refreshSession: async () => ({ data: { session: { access_token: 'fresh-user-jwt' } } })
  } }, async (url, options) => { sent.push(options.headers.Authorization); return sent.length === 1 ? reply(401, {}) : reply(201, { user: { id: 'created' } }); });
  await create({});
  assert.deepEqual(sent, ['Bearer old-user-jwt', 'Bearer fresh-user-jwt']);
});
test('missing browser session requests real sign-in without calling the account endpoint', async () => {
  const create = loadCreateUser({ auth: { getSession: async () => ({ data: { session: null } }), refreshSession: async () => ({ data: { session: null } }) } }, async () => { throw new Error('Should not call endpoint'); });
  await assert.rejects(create({}), err => err.code === 'AUTH_REQUIRED');
});
test('server configuration errors do not trigger user-token refresh or retry', async () => {
  let refreshes = 0;
  const create = loadCreateUser({ auth: {
    getSession: async () => ({ data: { session: { access_token: 'user-jwt' } } }),
    refreshSession: async () => { refreshes++; return { data: {} }; }
  } }, async () => reply(502, { error: 'Invalid server key' }));
  await assert.rejects(create({}), /Invalid server key/);
  assert.equal(refreshes, 0);
});

test('weak passwords rejected at login are also rejected before account creation', async () => {
  const endpoint = loadEndpoint('sb_secret_test_only', [reply(200, actor), reply(200, adminProfile)]);
  const res = await invoke(endpoint, { body: { email: 'newuser@example.com', password: 'password', role: 'admin', status: 'Active' } });
  assert.equal(res.code, 400);
  assert.match(res.body.error, /stronger password/);
  assert.equal(endpoint.calls.length, 2);
});
test('failed rollback warns that an Auth account may need repair', async () => {
  const endpoint = loadEndpoint('sb_secret_test_only', [reply(200, actor), reply(200, adminProfile), reply(200, { id: 'new-auth-id' }), reply(400, {}), reply(500, {})]);
  const res = await invoke(endpoint);
  assert.equal(res.code, 502);
  assert.match(res.body.error, /profile could not be saved or rolled back/);
});

test('separate legacy Auth Admin key never replaces the caller JWT or database key', async () => {
  const dbKey = 'sb_secret_test_db_only';
  const adminKey = 'eyJ.synthetic-service-role.jwt';
  const endpoint = loadEndpoint(dbKey, happy(), adminKey);
  const res = await invoke(endpoint);
  assert.equal(res.code, 201);
  assert.equal(endpoint.calls[0].headers.apikey, dbKey);
  assert.equal(endpoint.calls[0].headers.Authorization, 'Bearer test-user-jwt');
  assert.equal(endpoint.calls[1].headers.apikey, dbKey);
  assert.equal(endpoint.calls[1].headers.Authorization, undefined);
  assert.equal(endpoint.calls[2].headers.apikey, adminKey);
  assert.equal(endpoint.calls[2].headers.Authorization, `Bearer ${adminKey}`);
  assert.equal(endpoint.calls[3].headers.apikey, dbKey);
  assert.equal(endpoint.calls[3].headers.Authorization, undefined);
});
test('missing Bearer Admin credential gets one documented exact-match compatibility retry', async () => {
  const key = 'sb_secret_test_compatibility';
  const endpoint = loadEndpoint(key, [reply(200, actor), reply(200, adminProfile), reply(401, { msg: 'This endpoint requires a valid Bearer token' }), reply(200, { id: 'new-auth-id' }), reply(201, [{ id: 'new-auth-id' }])]);
  const res = await invoke(endpoint);
  assert.equal(res.code, 201);
  assert.equal(endpoint.calls.length, 5);
  assert.equal(endpoint.calls[2].headers.Authorization, undefined);
  assert.equal(endpoint.calls[3].headers.Authorization, `Bearer ${key}`);
  assert.equal(endpoint.calls[3].headers.apikey, key);
  assert.equal(endpoint.calls[2].body, endpoint.calls[3].body);
});
test('a not_admin rejection does not attempt another account-creation request', async () => {
  const endpoint = loadEndpoint('sb_secret_test_only', [reply(200, actor), reply(200, adminProfile), reply(403, { error_code: 'not_admin', msg: 'User not allowed' })]);
  const res = await invoke(endpoint);
  assert.equal(res.code, 502);
  assert.equal(res.body.code, 'not_admin');
  assert.equal(endpoint.calls.length, 3);
});
test('Admin rollback uses the Auth Admin key, not the database key', async () => {
  const adminKey = 'eyJ.synthetic-service-role.jwt';
  const endpoint = loadEndpoint('sb_secret_test_db_only', [reply(200, actor), reply(200, adminProfile), reply(200, { id: 'new-auth-id' }), reply(400, {}), reply(200, {})], adminKey);
  assert.equal((await invoke(endpoint)).code, 502);
  assert.equal(endpoint.calls[4].headers.apikey, adminKey);
  assert.equal(endpoint.calls[4].headers.Authorization, `Bearer ${adminKey}`);
});
test('Save user label remains stable and duplicate-submission protection remains enabled', () => {
  const users = fs.readFileSync(path.join(root, 'js/modules/users.js'), 'utf8');
  assert.equal(users.includes('Saving to Supabase'), false);
  assert.match(users, /saveBtn\.textContent = 'Save user'/);
  assert.match(users, /if \(saveBtn\.disabled\) return/);
  assert.match(users, /saveBtn\.disabled = true/);
  assert.match(users, /finally \{\s+saveBtn\.disabled = false/);
});
