const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function directory(responses) {
  const calls = [];
  const context = { module: { exports: {} }, process: { env: { SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_synthetic_test', SUPABASE_AUTH_ADMIN_KEY: 'synthetic-legacy-admin-key' } },
    fetch: async (url, options) => { calls.push({ url, ...options }); const [status, data] = responses.shift(); return { ok: status >= 200 && status < 300, status, json: async () => data }; } };
  vm.runInNewContext(source('api/user-directory.js'), context);
  return { calls, async invoke(headers = { authorization: 'Bearer synthetic-user-token' }) {
    const res = { status(n) { this.code = n; return this; }, setHeader() { return this; }, end(s) { this.body = JSON.parse(s); } };
    await context.module.exports({ method: 'GET', headers }, res); return res;
  } };
}
test('only an authenticated active Main Admin can read all login times', async () => {
  const e = directory([]); assert.equal((await e.invoke({})).code, 401); assert.equal(e.calls.length, 0);
  for (const profile of [{ role: 'admin', status: 'Active' }, { role: 'main-admin', status: 'Inactive' }]) {
    const e = directory([[200, { id: 'actor' }], [200, [profile]]]); assert.equal((await e.invoke()).code, 403); assert.equal(e.calls.length, 2);
  }
});
test('directory uses existing profile times and falls back to historical Auth sign-ins without exposing Auth objects', async () => {
  const e = directory([[200, { id: 'actor' }], [200, [{ role: 'main-admin', status: 'Active' }]],
    [200, [{ id: 'one', email: 'one@example.com', last_login: '2026-11-13T00:00:01Z' }, { id: 'two', email: 'two@example.com' }]],
    [200, { users: [{ id: 'one', last_sign_in_at: '2026-11-12T23:00:00Z', user_metadata: { secret: 'do-not-return' } }, { id: 'two', last_sign_in_at: '2026-11-13T00:00:02Z' }] }]]);
  const res = await e.invoke(); assert.equal(res.code, 200); assert.equal(res.body.users[0].lastLogin, '2026-11-13T00:00:01Z');
  assert.equal(res.body.users[1].lastLogin, '2026-11-13T00:00:02Z'); assert.doesNotMatch(JSON.stringify(res.body), /do-not-return|user_metadata|synthetic-legacy-admin-key/);
});
test('unavailable historical Auth times do not discard existing profile timestamps', async () => {
  const e = directory([[200, { id: 'actor' }], [200, [{ role: 'main-admin', status: 'Active' }]], [200, [{ id: 'one', last_login: '2026-11-13T00:00:01Z' }]], [403, { error_code: 'not_admin' }]]);
  const res = await e.invoke(); assert.equal(res.code, 200); assert.equal(res.body.users[0].lastLogin, '2026-11-13T00:00:01Z'); assert.ok(res.body.warning);
});
function visibility() {
  const handlers = {}, windowHandlers = {};
  const input = { type: 'password', value: 'synthetic-typed-password', disabled: false };
  const button = { dataset: { passwordToggle: 'password' }, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; } };
  const document = { querySelectorAll: () => [button], getElementById: () => input, addEventListener(name, fn) { handlers[name] = fn; } };
  const window = { addEventListener(name, fn) { windowHandlers[name] = fn; } };
  vm.runInNewContext(source('js/password-visibility.js'), { document, window, setTimeout: fn => fn() });
  return { input, button, handlers, windowHandlers, click() { handlers.click({ target: { closest: () => button } }); } };
}
test('Show and Hide reveal only the password being typed with correct accessibility state', () => {
  const e = visibility(); e.click(); assert.equal(e.input.type, 'text'); assert.equal(e.button.textContent, 'Hide'); assert.equal(e.button.attributes['aria-pressed'], 'true');
  e.click(); assert.equal(e.input.type, 'password'); assert.equal(e.button.textContent, 'Show'); assert.equal(e.input.value, 'synthetic-typed-password');
});
test('dialog close and navigation clear and remask typed passwords', () => {
  const e = visibility(); e.click(); e.handlers.close({ target: { tagName: 'DIALOG', querySelectorAll: () => [e.button] } });
  assert.equal(e.input.value, ''); assert.equal(e.input.type, 'password'); assert.equal(e.button.textContent, 'Show');
  e.input.value = 'another-synthetic-password'; e.click(); e.windowHandlers.pagehide(); assert.equal(e.input.value, ''); assert.equal(e.input.type, 'password');
});
test('current-user table uses a real timestamp, not Current session, and does not prefer a stale cached row', () => {
  const users = source('js/modules/users.js'); const start = users.indexOf('function formatTimestamp'); const end = users.indexOf('function renderSessionSummary', start);
  const context = {}; vm.runInNewContext(users.slice(start, end), context);
  const current = { id: 'one', signedInAt: '2026-11-13T00:12:01Z', lastLogin: '2026-11-13T00:12:01Z' };
  assert.equal(context.loginTimestamp({ id: 'one', lastLogin: '2026-11-12T00:00:00Z' }, current), current.lastLogin);
  assert.equal(context.formatTimestamp('Current session'), ''); assert.match(context.formatTimestamp(current.lastLogin), /2026/);
  assert.doesNotMatch(users, /email\.innerHTML|crypto\.subtle\.digest/);
});
