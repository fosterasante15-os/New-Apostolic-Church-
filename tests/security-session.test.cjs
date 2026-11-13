const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js/security-session.js'), 'utf8');
const AUTH_KEY = 'church-auth-v1';

class Bus {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    list.push(fn); this.listeners.set(type, list);
  }
  async emit(type, detail = {}) {
    const event = { type, ...detail };
    const jobs = (this.listeners.get(type) || []).map(fn => fn(event));
    await Promise.all(jobs);
    await new Promise(resolve => setImmediate(resolve));
  }
  dispatchEvent(event) { this.emit(event.type, event); return true; }
}
class Storage {
  constructor(seed = {}) { this.map = new Map(Object.entries(seed).map(([k, v]) => [k, String(v)])); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

function environment(options = {}) {
  let clock = options.now || 1_700_000_000_000;
  const timers = new Map(); let nextTimer = 1;
  const localStorage = options.localStorage || new Storage();
  const sessionStorage = new Storage();
  const cached = options.cached === undefined ? {
    id: 'user-1', role: 'admin', status: 'Active', isCloud: true,
    signedInAt: new Date(clock).toISOString()
  } : options.cached;
  if (cached) sessionStorage.setItem(AUTH_KEY, JSON.stringify(cached));
  const locationURL = new URL(options.url || 'https://church.test/index.html#members');
  const redirects = [];
  const location = {
    href: locationURL.href, pathname: locationURL.pathname, search: locationURL.search,
    hash: locationURL.hash, origin: locationURL.origin,
    replace(value) { redirects.push(value); }
  };
  const window = new Bus();
  const document = new Bus();
  document.visibilityState = 'visible';
  const status = { textContent: '', hidden: true, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  const dashboard = options.login ? null : {};
  document.getElementById = id => id === 'dashboard' ? dashboard : id === 'auth-form' ? (options.login ? {} : null) : id === 'security-settings-status' ? status : null;
  const calls = [];
  const base = {
    isValidAppSession: session => Boolean(session && session.id && ['admin', 'main-admin'].includes(String(session.role).toLowerCase())),
    async getSecurityPolicy() {
      calls.push('policy');
      return options.policyResult || { ready: true, policy: { sessionTimeoutMinutes: 30, failedLoginLimit: 5, lockoutMinutes: 15, backupRetention: 10, autoBackupEnabled: false } };
    },
    async ensurePortalSession(action) {
      calls.push(action);
      if (typeof options.ensure === 'function') return options.ensure(action, clock, calls);
      return { valid: true, sessionId: 'server-session-1', userId: 'user-1', lastActiveAt: new Date(clock).toISOString(), expiresAt: new Date(clock + 30 * 60000).toISOString() };
    },
    async syncNow() { calls.push('sync'); return { ok: true }; },
    async createBackup(payload) { calls.push(['backup', payload]); return { ok: true }; },
    async signOut() { calls.push('signOut'); }
  };
  const DB = { ...base, ...(options.DB || {}) };
  Object.assign(window, { window, localStorage, sessionStorage, location, ChurchDB: DB });
  const context = vm.createContext({ window, document, localStorage, sessionStorage, location,
    setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    Date: class extends Date { static now() { return clock; } },
    Math, console: { warn() {}, info() {}, log() {} }
  });
  vm.runInContext(source, context);
  return {
    window, document, DB, calls, status, redirects, localStorage, sessionStorage, timers,
    advance(ms) { clock += ms; },
    async ready() { await window.ChurchSecurity.ready; await new Promise(resolve => setImmediate(resolve)); },
    async runTimer(id) { const timer = timers.get(id); if (!timer) return; timers.delete(id); await timer.fn(); await new Promise(resolve => setImmediate(resolve)); },
    async runAllTimers() { for (const id of [...timers.keys()]) await this.runTimer(id); },
    async emit(type, detail) { await document.emit(type, detail); },
    async emitWindow(type, detail) { await window.emit(type, detail); }
  };
}

test('missing security migration is pending and does not fake-enforce or open a portal session', async () => {
  const env = environment({ policyResult: { ready: false } });
  await env.ready();
  assert.equal(env.window.ChurchSecurity.getState().policyReady, false);
  assert.equal(env.status.attrs['data-security-state'], 'pending');
  assert.match(env.status.textContent, /pending/i);
  assert.equal(env.calls.includes('open'), false);
  assert.equal(env.redirects.length, 0);
  assert.deepEqual(env.sessionStorage.getItem(AUTH_KEY) && JSON.parse(env.sessionStorage.getItem(AUTH_KEY)).id, 'user-1');
});

test('typed activity touches the server only after real input and is throttled; return checks do not heartbeat', async () => {
  let touchCount = 0;
  const env = environment({ ensure(action, clock) {
    if (action === 'touch') touchCount++;
    return { valid: true, sessionId: 'server-session-1', userId: 'user-1', lastActiveAt: new Date(clock).toISOString(), expiresAt: new Date(clock + 30 * 60000).toISOString() };
  }});
  await env.ready();
  assert.deepEqual(env.calls.slice(0, 2), ['policy', 'open']);
  assert.equal(env.calls.includes('touch'), false);

  await env.emit('visibilitychange', { }); // visible check only, still no activity
  env.document.visibilityState = 'hidden';
  await env.emit('visibilitychange');
  env.document.visibilityState = 'visible';
  await env.emit('visibilitychange');
  await env.emitWindow('focus');
  assert.equal(env.calls.filter(item => item === 'touch').length, 0);

  await env.emit('input');
  assert.equal(touchCount, 1);
  await env.emit('keydown');
  assert.equal(touchCount, 1, 'events inside the throttle window do not touch again');
  assert.equal(env.calls.includes('sync'), true);
});

test('an expired touch clears the app session and redirects once with the current route', async () => {
  const env = environment({ ensure(action, clock) {
    if (action === 'touch') { const error = new Error('expired'); error.code = 'APP_SESSION_EXPIRED'; throw error; }
    return { valid: true, sessionId: 'server-session-1', userId: 'user-1', lastActiveAt: new Date(clock).toISOString(), expiresAt: new Date(clock + 30 * 60000).toISOString() };
  }});
  await env.ready();
  await env.emit('pointerdown');
  await env.emit('pointerdown');
  assert.equal(env.sessionStorage.getItem(AUTH_KEY), null);
  assert.equal(env.calls.filter(item => item === 'close').length, 1);
  assert.equal(env.calls.filter(item => item === 'signOut').length, 1);
  assert.equal(env.redirects.length, 1);
  assert.equal(env.redirects[0], 'login.html?loggedout=1&timeout=1&from=index.html%23members');
});

test('activity timestamps from another tab extend the local deadline without exposing credentials', async () => {
  const env = environment();
  await env.ready();
  const key = 'church-security-activity-v1:server-session-1';
  env.localStorage.setItem(key, '1700000100000');
  await env.emitWindow('storage', { key, newValue: '1700000100000' });
  const state = env.window.ChurchSecurity.getState();
  assert.equal(state.lastActiveAt !== undefined, true);
  assert.equal(env.sessionStorage.getItem(AUTH_KEY).includes('access_token'), false);
});

test('automatic backup is conditional, consumes the manual-sign-in flag, and restored sessions do not repeat it', async () => {
  const enabled = environment({
    cached: { id: 'user-1', role: 'main-admin', status: 'Active', automaticBackupPending: true },
    policyResult: { ready: true, policy: { sessionTimeoutMinutes: 30, failedLoginLimit: 5, lockoutMinutes: 15, backupRetention: 10, autoBackupEnabled: true } }
  });
  await enabled.ready();
  assert.equal(enabled.calls.some(item => Array.isArray(item) && item[0] === 'backup' && item[1].automatic === true), true);
  assert.equal(JSON.parse(enabled.sessionStorage.getItem(AUTH_KEY)).automaticBackupPending, undefined);

  const restored = environment({
    cached: { id: 'user-1', role: 'admin', status: 'Active' },
    policyResult: { ready: true, policy: { sessionTimeoutMinutes: 30, failedLoginLimit: 5, lockoutMinutes: 15, backupRetention: 10, autoBackupEnabled: true } }
  });
  await restored.ready();
  assert.equal(restored.calls.some(item => Array.isArray(item) && item[0] === 'backup'), false);
});

test('pending-to-ready transition enrolls the already open dashboard without reload', async () => {
  const env = environment({ policyResult: { ready: false } }); await env.ready();
  env.DB.getSecurityPolicy = async () => ({ ready: true, policy: { sessionTimeoutMinutes: 30 } });
  await env.window.ChurchSecurity.refreshPolicy();
  assert.equal(env.calls.filter(x => x === 'open').length, 1);
  assert.equal(env.calls.includes('sync'), true); assert.equal(env.redirects.length, 0);
});
test('a transient policy outage preserves known-good session preflight', async () => {
  const env = environment(); await env.ready();
  env.DB.getSecurityPolicy = async () => { throw new Error('Network unavailable'); };
  await env.window.ChurchSecurity.refreshPolicy();
  assert.equal(env.DB.securityPolicy.ready, true);
  assert.equal(env.window.ChurchSecurity.getState().policyReady, true);
});
test('Account role enrolls and receives timeout enforcement', async () => {
  const env = environment({ cached: { id: 'user-1', role: 'account', status: 'Active', isCloud: true }, DB: { isValidAppSession: () => true } });
  await env.ready(); assert.equal(env.calls.includes('open'), true);
});
test('synthetic events do not touch while genuine wheel input counts as activity', async () => {
  const env = environment(); await env.ready();
  await env.emit('input', { isTrusted: false }); assert.equal(env.calls.includes('touch'), false);
  await env.emit('wheel', { isTrusted: true }); assert.equal(env.calls.includes('touch'), true);
});
