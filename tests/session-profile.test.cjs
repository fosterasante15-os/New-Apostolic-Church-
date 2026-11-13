const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../api/session-profile.js'), 'utf8');
const key = 'sb_secret_synthetic_server_key';
const actor = { id: 'own-auth-id', email: 'admin@example.com', email_confirmed_at: '2026-11-13T00:00:00Z' };
const profile = { id: actor.id, email: actor.email, name: 'Existing Admin', role: 'admin', status: 'Active' };
const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
function endpoint(responses, env = {}) {
  const calls = [];
  const context = { module: { exports: {} }, process: { env: { SUPABASE_SERVICE_ROLE_KEY: key, ...env } }, fetch: async (url, options) => {
    calls.push({ url, ...options }); const next = responses.shift(); assert.ok(next, 'Unexpected request'); if (next instanceof Error) throw next; return next;
  } };
  vm.runInNewContext(source, context);
  return { handler: context.module.exports, calls };
}
async function invoke(endpoint, changes = {}) {
  const req = { method: 'POST', headers: { authorization: 'Bearer synthetic-user-jwt' }, body: {}, ...changes };
  const res = { headers: {}, status(code) { this.code = code; return this; }, setHeader(name, value) { this.headers[name] = value; return this; }, end(value) { this.body = JSON.parse(value); return this; } };
  await endpoint.handler(req, res); return res;
}
test('unauthenticated requests cannot read or create profiles', async () => {
  const e = endpoint([]); assert.equal((await invoke(e, { headers: {} })).code, 401); assert.equal(e.calls.length, 0);
});
test('expired caller tokens are rejected before privileged profile lookup', async () => {
  const e = endpoint([reply(401, {})]); assert.equal((await invoke(e)).code, 401); assert.equal(e.calls.length, 1);
});
test('existing own profile is returned without writes or private-key exposure', async () => {
  const e = endpoint([reply(200, actor), reply(200, [profile])]); const res = await invoke(e);
  assert.equal(res.code, 200); assert.equal(res.body.profile.id, actor.id); assert.equal(res.body.profile.role, 'admin');
  assert.equal(res.headers['Cache-Control'], 'no-store'); assert.equal(JSON.stringify(res.body).includes(key), false);
  assert.match(e.calls[1].url, /profiles\?id=eq\.own-auth-id&/); assert.equal(e.calls.length, 2);
  assert.equal(e.calls[0].headers.Authorization, 'Bearer synthetic-user-jwt'); assert.equal(e.calls[1].headers.Authorization, undefined);
});
test('existing inactive/member roles remain unchanged, including the owner', async () => {
  const owner = { ...actor, email: 'fosterasante15@gmail.com' };
  const e = endpoint([reply(200, owner), reply(200, [{ ...profile, email: owner.email, role: 'member', status: 'Inactive' }])]);
  const res = await invoke(e); assert.equal(res.body.profile.role, 'member'); assert.equal(res.body.profile.status, 'Inactive'); assert.equal(e.calls.length, 2);
});
test('other missing users cannot bootstrap from request data or editable metadata', async () => {
  const e = endpoint([reply(200, { ...actor, user_metadata: { role: 'main-admin' } }), reply(200, [])]);
  const res = await invoke(e, { body: { email: 'fosterasante15@gmail.com', role: 'main-admin', status: 'Active' } });
  assert.equal(res.code, 404); assert.equal(e.calls.length, 2);
});
test('confirmed designated owner can restore only its own missing profile', async () => {
  const owner = { ...actor, email: 'fosterasante15@gmail.com' };
  const restored = { ...profile, email: owner.email, name: 'Foster Asante', role: 'main-admin' };
  const e = endpoint([reply(200, owner), reply(200, []), reply(200, []), reply(201, [restored]), reply(200, [restored])]);
  const res = await invoke(e); assert.equal(res.code, 200); assert.equal(res.body.profile.role, 'main-admin');
  const saved = JSON.parse(e.calls[3].body); assert.equal(saved.id, owner.id); assert.equal(saved.email, owner.email);
  assert.match(e.calls[3].headers.Prefer, /ignore-duplicates/); assert.equal(e.calls[3].method, 'POST');
});
test('unconfirmed owner cannot create privileged profile', async () => {
  const e = endpoint([reply(200, { ...actor, email: 'fosterasante15@gmail.com', email_confirmed_at: null }), reply(200, [])]);
  assert.equal((await invoke(e)).code, 404); assert.equal(e.calls.length, 2);
});
test('owner email linked to another Auth identity is never automatically relinked', async () => {
  const e = endpoint([reply(200, { ...actor, email: 'fosterasante15@gmail.com' }), reply(200, []), reply(200, [{ id: 'another-auth-id' }])]);
  assert.equal((await invoke(e)).code, 409); assert.equal(e.calls.length, 3);
});
test('a concurrently created blocked profile wins over owner bootstrap defaults', async () => {
  const owner = { ...actor, email: 'fosterasante15@gmail.com' };
  const e = endpoint([reply(200, owner), reply(200, []), reply(200, []), reply(201, []), reply(200, [{ ...profile, email: owner.email, status: 'Blocked' }])]);
  const res = await invoke(e); assert.equal(res.code, 200); assert.equal(res.body.profile.status, 'Blocked');
});
test('database failures never trigger owner creation', async () => {
  const e = endpoint([reply(200, { ...actor, email: 'fosterasante15@gmail.com' }), reply(403, {})]);
  assert.equal((await invoke(e)).code, 502); assert.equal(e.calls.length, 2);
});
