const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
class Bus {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback) { const list = this.listeners.get(name) || []; list.push(callback); this.listeners.set(name, list); }
  async emit(name, event = {}) { return Promise.all((this.listeners.get(name) || []).map(fn => fn({ type: name, ...event }))); }
  dispatchEvent(event) { this.emit(event.type, event); return true; }
}
const user = { id: 'auth-user-test', email: 'admin@example.com', user_metadata: { name: 'Admin', role: 'main-admin' } };
const profile = { id: user.id, email: user.email, name: 'Test Admin', role: 'admin', status: 'Active' };
const valid = { ...profile, isCloud: true };
function environment(options = {}) {
  class Storage {
    constructor() { this.map = new Map(); }
    getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
    setItem(key, value) { this.map.set(key, String(value)); }
    removeItem(key) { this.map.delete(key); }
  }
  const localStorage = new Storage(), sessionStorage = new Storage();
  for (const [key, value] of Object.entries(options.local || {})) localStorage.setItem(key, JSON.stringify(value));
  if (options.cached) sessionStorage.setItem('church-auth-v1', JSON.stringify(options.cached));
  const locationURL = new URL(options.url || 'https://church.test/index.html#members');
  const redirects = [], reloads = [], calls = [], timers = new Map(); let nextTimer = 1;
  const location = { href: locationURL.href, origin: locationURL.origin, pathname: locationURL.pathname, search: locationURL.search, hash: locationURL.hash,
    replace(value) { redirects.push(value); }, reload() { reloads.push(true); } };
  const window = new Bus(), document = new Bus();
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, Object.assign(new Bus(), { value: '', textContent: '', disabled: false, hidden: true, type: 'password', classList: { toggle() {} }, checkValidity() { return this.value.includes('@'); }, focus() {}, setAttribute() {} }));
    return elements.get(id);
  }
  for (const id of ['auth-message', 'auth-form', 'auth-email', 'auth-password', 'auth-submit', 'show-password', 'church-name']) element(id);
  document.activeElement = { tagName: 'BODY' }; document.visibilityState = 'visible'; document.openDialog = false;
  document.getElementById = id => id === 'dashboard' ? (options.login ? null : {}) : id === 'settings-dirty' ? (document.dirtySettings ? { hidden: false } : null) : (elements.get(id) || null);
  document.querySelector = selector => selector === 'dialog[open]' && document.openDialog ? {} : null;
  const tables = structuredClone(options.tables || { members: [{ id: 'NAC-0040', name: 'Cloud Member', status: 'Active' }] });
  const saved = options.saved === undefined ? { access_token: 'synthetic-user-jwt' } : options.saved;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: saved } }),
      getUser: async () => options.expired ? { data: {}, error: new Error('Expired token') } : { data: { user } },
      signInWithPassword: async () => ({ data: { user, session: { access_token: 'synthetic-user-jwt' } } }),
      signOut: async () => ({}),
      refreshSession: async () => ({ data: { session: saved } })
    },
    from(table) {
      calls.push(table);
      const query = {
        select() { return this; }, eq() { return this; }, limit() { return this; },
        async maybeSingle() {
          if (table === 'profiles') return { data: options.missingProfile ? null : (options.profile || profile), error: options.profileError || null };
          return { data: null, error: null };
        },
        async upsert(rows) { tables[table] = Array.isArray(rows) ? rows : [rows]; return { error: null }; },
        delete() { return { in: async () => ({ error: null }) }; },
        then(resolve, reject) { return Promise.resolve({ data: tables[table] || [], error: null }).then(resolve, reject); }
      };
      return query;
    }
  };
  Object.assign(window, { localStorage, sessionStorage, location, supabase: { createClient: () => client }, scrollX: 0, scrollY: 240,
    scrollTo(x, y) { this.scrollX = x; this.scrollY = y; }, notify() {} });
  const context = vm.createContext({ window, document, location, localStorage, sessionStorage, Storage, URL, URLSearchParams,
    CustomEvent: class { constructor(type, details = {}) { this.type = type; Object.assign(this, details); } },
    setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    console: { warn() {}, info() {}, log() {} }, alert() {}, fetch: async () => { throw new Error('Unexpected fetch'); } });
  vm.runInContext(source('js/supabase-client.js'), context);
  return { window, document, context, location, localStorage, sessionStorage, client, tables, calls, redirects, reloads, element, timers,
    async runTimers() { const jobs = [...timers.values()]; timers.clear(); for (const fn of jobs) await fn(); await new Promise(setImmediate); } };
}
const settle = () => new Promise(setImmediate);

test('startup sync adopts cloud data and renders in place without reload or route/scroll changes', async () => {
  const env = environment(); let renders = 0;
  env.window.ChurchDB.onStoresChanged(['church-members-v1'], () => { renders++; });
  await env.document.emit('DOMContentLoaded');
  assert.equal(renders, 1);
  assert.equal(JSON.parse(env.localStorage.getItem('church-members-v1'))[0].name, 'Cloud Member');
  assert.equal(env.location.hash, '#members'); assert.equal(env.window.scrollY, 240);
  assert.equal(env.reloads.length, 0); assert.equal(env.redirects.length, 0);
});
test('syncNow and repeated tab reopening never reload the document', async () => {
  const env = environment();
  await env.window.ChurchDB.syncNow();
  for (let i = 0; i < 3; i++) { await env.document.emit('visibilitychange'); await env.runTimers(); }
  assert.equal(env.reloads.length, 0); assert.equal(env.location.hash, '#members');
});
test('input editing defers and batches view updates until focus leaves the input', async () => {
  const env = environment(); const batches = [];
  env.window.ChurchDB.onStoresChanged(['church-members-v1'], keys => batches.push([...keys]));
  env.document.activeElement = { tagName: 'INPUT', value: 'unsaved draft' };
  await env.window.ChurchDB.syncNow();
  env.tables.members[0].name = 'Updated cloud member';
  await env.window.ChurchDB.syncNow();
  assert.equal(batches.length, 0); assert.equal(env.document.activeElement.value, 'unsaved draft');
  env.document.activeElement = { tagName: 'BODY' };
  await env.document.emit('focusout'); await env.runTimers();
  assert.equal(batches.length, 1); assert.deepEqual(batches[0], ['church-members-v1']);
  assert.equal(env.reloads.length, 0);
});
test('even manual cloud pull preserves open dialogs and updates after they close', async () => {
  const env = environment(); let renders = 0; env.document.openDialog = true;
  env.window.ChurchDB.onStoresChanged(['church-members-v1'], () => renders++);
  await env.window.ChurchDB.pullAllFromCloud(); assert.equal(renders, 0);
  env.document.openDialog = false;
  await env.document.emit('close'); await env.runTimers(); assert.equal(renders, 1);
  assert.equal(env.reloads.length, 0);
});
test('new/edit routes defer rendering without replacing the route', async () => {
  const env = environment({ url: 'https://church.test/index.html#member-new' }); let renders = 0;
  env.window.ChurchDB.onStoresChanged(['church-members-v1'], () => renders++);
  await env.window.ChurchDB.syncNow(); assert.equal(renders, 0); assert.equal(env.location.hash, '#member-new');
  env.location.hash = '#members'; await env.window.emit('hashchange'); await env.runTimers(); assert.equal(renders, 1);
});
test('dirty settings are not overwritten by background UI rendering', async () => {
  const env = environment(); let renders = 0; env.document.dirtySettings = true;
  env.window.ChurchDB.onStoresChanged(['church-members-v1'], () => renders++);
  await env.window.ChurchDB.syncNow(); assert.equal(renders, 0);
  env.document.dirtySettings = false; await env.document.emit('focusout'); await env.runTimers(); assert.equal(renders, 1);
});
test('the login page does not start background record sync or trigger refresh timers', async () => {
  const env = environment({ login: true, url: 'https://church.test/login.html' });
  await env.document.emit('DOMContentLoaded');
  env.localStorage.setItem('church-activity-v1', '[]');
  await env.document.emit('visibilitychange'); await env.window.emit('online'); await env.runTimers();
  assert.equal(env.calls.length, 0); assert.equal(env.reloads.length, 0); assert.equal(env.timers.size, 0);
});
test('store subscriptions can be removed and irrelevant changes do not refresh them', async () => {
  const env = environment(); let renders = 0;
  const unsubscribe = env.window.ChurchDB.onStoresChanged(['church-members-v1'], () => renders++);
  await env.window.emit('storage', { key: 'church-theme-v1' }); assert.equal(renders, 0);
  unsubscribe(); await env.window.ChurchDB.syncNow(); assert.equal(renders, 0);
});
test('only active cloud administration roles are valid app sessions', () => {
  const db = environment().window.ChurchDB;
  for (const role of ['admin', 'main-admin', 'account', ' Admin ']) assert.equal(db.isValidAppSession({ ...valid, role }), true);
  for (const patch of [{ role: 'member' }, { role: 'Member' }, { role: 'unknown' }, { status: 'Pending' }, { status: undefined }, { id: '' }, { isCloud: false }]) assert.equal(db.isValidAppSession({ ...valid, ...patch }), false);
});
test('verified profiles are authoritative, not user-supplied role metadata', async () => {
  const session = await environment().window.ChurchDB.appSessionForUser(user);
  assert.equal(session.role, 'admin'); assert.equal(session.name, 'Test Admin');
});
test('missing/error/inactive/member profiles cannot become active admins', async () => {
  for (const options of [{ missingProfile: true }, { profileError: new Error('RLS rejected') }, { profile: { ...profile, status: 'Inactive' } }, { profile: { ...profile, role: 'Member' } }]) {
    await assert.rejects(environment(options).window.ChurchDB.appSessionForUser(user));
  }
});
test('saved Supabase sessions restore a normalized active profile; expired tokens do not', async () => {
  const restored = await environment({ profile: { ...profile, role: ' Admin ' } }).window.ChurchDB.getAppSession();
  assert.equal(restored.role, 'admin'); assert.equal(restored.isCloud, true);
  const expired = environment({ expired: true });
  assert.equal(await expired.window.ChurchDB.getAppSession(), null); assert.equal(expired.calls.length, 0);
});
test('stale disallowed login cache is cleared without auto-forwarding', async () => {
  const env = environment({ login: true, saved: null, cached: { ...valid, role: 'member' }, url: 'https://church.test/login.html' });
  vm.runInContext(source('js/login.js'), env.context); await settle();
  assert.equal(env.sessionStorage.getItem('church-auth-v1'), null); assert.equal(env.redirects.length, 0);
});
test('new mobile tab restores its saved cloud session and preserves the requested route', async () => {
  const env = environment({ login: true, url: 'https://church.test/login.html?from=index.html%23attendance' });
  vm.runInContext(source('js/login.js'), env.context); await settle();
  assert.deepEqual(env.redirects, ['index.html#attendance']);
  assert.equal(JSON.parse(env.sessionStorage.getItem('church-auth-v1')).role, 'admin');
  assert.equal(env.localStorage.getItem('church-activity-v1'), null, 'resuming must not duplicate Login audit events');
});
test('logout never automatically resumes a persisted token', async () => {
  const env = environment({ login: true, cached: valid, url: 'https://church.test/login.html?loggedout=1' });
  vm.runInContext(source('js/login.js'), env.context); await settle();
  assert.equal(env.redirects.length, 0); assert.equal(env.sessionStorage.getItem('church-auth-v1'), null);
});
test('login return URLs cannot redirect externally or back to the login page', async () => {
  for (const target of ['https://evil.test/index.html', 'login.html', '//evil.test/index.html']) {
    const env = environment({ login: true, url: 'https://church.test/login.html?from=' + encodeURIComponent(target) });
    vm.runInContext(source('js/login.js'), env.context); await settle(); assert.deepEqual(env.redirects, ['index.html']);
  }
});
test('saved-session restore does not interrupt a user entering different credentials', async () => {
  const env = environment({ login: true, url: 'https://church.test/login.html' });
  env.element('auth-email').value = 'different@example.com';
  vm.runInContext(source('js/login.js'), env.context); await settle(); assert.equal(env.redirects.length, 0);
});
test('profile failures keep the login page stable and discard stale UI identity', async () => {
  const env = environment({ login: true, cached: valid, profileError: new Error('Connection failed'), url: 'https://church.test/login.html' });
  vm.runInContext(source('js/login.js'), env.context); await settle();
  assert.equal(env.redirects.length, 0); assert.equal(env.sessionStorage.getItem('church-auth-v1'), null);
  assert.match(env.element('auth-message').textContent, /verify your account profile/);
});
test('manual sign-in saves the verified session before a single route-preserving redirect', async () => {
  const env = environment({ login: true, saved: null, url: 'https://church.test/login.html?from=index.html%23users' });
  vm.runInContext(source('js/login.js'), env.context); await settle();
  env.element('auth-email').value = user.email; env.element('auth-password').value = 'strong-test-password';
  await env.element('auth-form').emit('submit', { preventDefault() {} });
  assert.deepEqual(env.redirects, ['index.html#users']);
  assert.equal(JSON.parse(env.sessionStorage.getItem('church-auth-v1')).role, 'admin');
  assert.equal(JSON.parse(env.localStorage.getItem('church-activity-v1')).filter(item => item.action === 'login').length, 1);
});
test('dashboard rejects invalid cached identity once and encodes the requested route', () => {
  const env = environment({ cached: { ...valid, role: 'Member' }, url: 'https://church.test/index.html?view=records#attendance' });
  vm.runInContext(source('js/access.js'), env.context);
  assert.equal(env.sessionStorage.getItem('church-auth-v1'), null);
  assert.deepEqual(env.redirects, ['login.html?from=index.html%3Fview%3Drecords%23attendance']);
});
test('every business module registers in-place refresh rather than a new reload callback', () => {
  for (const name of ['members', 'departments', 'services', 'dues', 'offerings', 'attendance', 'ministers', 'announcements', 'activity', 'reports', 'settings', 'dashboard']) {
    const content = source('js/modules/' + name + '.js');
    assert.match(content, /onStoresChanged/, name);
    assert.doesNotMatch(content, /location\.reload\(/, name);
  }
});

test('inline edit guards keep pending updates until save/cancel resumes the views', async () => {
  const env = environment(); let editing = true, renders = 0;
  env.window.ChurchDB.deferViewUpdatesWhile(() => editing);
  env.window.ChurchDB.onStoresChanged(['church-members-v1'], () => renders++);
  await env.window.ChurchDB.syncNow(); assert.equal(renders, 0);
  editing = false; env.window.ChurchDB.resumeViewUpdates(); await env.runTimers();
  assert.equal(renders, 1); assert.equal(env.reloads.length, 0);
});
test('attendance cloud merge preserves explicitly unsaved marks and adopts untouched cloud records', () => {
  const attendance = source('js/modules/attendance.js');
  const start = attendance.indexOf('function mergeDraftFromCloud() {');
  const end = attendance.indexOf('\n      const statusOf', start);
  assert.ok(start >= 0 && end > start);
  const context = { draftKey: 'service-A', draft: { one: 'absent', two: 'present' }, draftChanges: new Set(['one']),
    serviceKey: () => 'service-A', readAll: () => ({ 'service-A': { one: 'present', two: 'late', three: 'excused' } }),
    loadDraft: () => { throw new Error('Must not discard an unsaved draft for the same service'); } };
  vm.runInNewContext(attendance.slice(start, end) + '\nmergeDraftFromCloud();', context);
  assert.equal(context.draft.one, 'absent'); assert.equal(context.draft.two, 'late'); assert.equal(context.draft.three, 'excused');
  assert.match(attendance, /draftChanges\.add\(m\.id\)/);
  assert.match(attendance, /draftChanges\.delete\(m\.id\)/);
});
test('cloud service adoption notifies attendance after rendering the updated service picker', () => {
  const services = source('js/modules/services.js');
  assert.match(services, /window\.churchServices = services;\s+render\(\);\s+window\.dispatchEvent\(new CustomEvent\('services-change'\)\)/);
  const attendance = source('js/modules/attendance.js');
  assert.match(attendance, /addEventListener\('services-change', \(\) => \{ mergeDraftFromCloud\(\); render\(\); syncCalendarToService\(\); \}\)/);
});
test('offering editors register a dirty guard and resume pending refreshes on reset', () => {
  const offerings = source('js/modules/offerings.js');
  assert.match(offerings, /deferViewUpdatesWhile\?\.\(\(\) => Boolean\(sEdit \|\| tEdit\)\)/);
  assert.equal((offerings.match(/resumeViewUpdates/g) || []).length, 2);
});
