/*
 * New Apostolic Church — portal security session runtime
 *
 * This file deliberately owns only the browser-side session policy/runtime. The
 * authenticated API and database primitives are supplied by ChurchDB:
 *   getSecurityPolicy(), ensurePortalSession(action), syncNow(), signOut(),
 *   createBackup({ automatic: true })
 */
(function installChurchSecurity(root) {
  'use strict';

  const win = root && root.window === root ? root : (root && root.window) || root;
  const doc = (win && win.document) || (typeof document !== 'undefined' ? document : null);
  const DB = win && win.ChurchDB;
  const AUTH_KEY = 'church-auth-v1';
  const NATIVE_SESSION_KEY = 'church-security-native-session-v1';
  const ACTIVITY_PREFIX = 'church-security-activity-v1:';
  const REDIRECT_KEY = 'church-security-redirected-v1';
  const DEFAULT_POLICY = Object.freeze({
    sessionTimeoutMinutes: 30,
    failedLoginLimit: 5,
    lockoutMinutes: 15,
    backupRetention: 10,
    autoBackupEnabled: false
  });
  const TOUCH_THROTTLE_MS = 20000;
  const POLICY_REFRESH_MS = 60000;

  const state = {
    policy: null,
    policyReady: false,
    policyError: null,
    session: null,
    portal: null,
    lastActiveAt: null,
    localDeadline: 0,
    lastServerTouchAt: 0,
    lastHumanActivityAt: 0,
    lastPeerActivityAt: 0,
    wasHidden: false,
    expired: false,
    expiring: false,
    redirected: false,
    nativeSessionId: null,
    expiryTimer: null,
    policyTimer: null,
    listenersAttached: false,
    started: false,
    startupComplete: false,
    establishing: null
  };

  const now = () => Date.now();
  const storage = name => {
    try { return win && win[name]; } catch (_) { return null; }
  };
  const localStorage = () => storage('localStorage');
  const sessionStorage = () => storage('sessionStorage');
  const isVisible = () => !doc || doc.visibilityState === undefined || doc.visibilityState === 'visible';
  const isDashboard = () => Boolean(doc && doc.getElementById && doc.getElementById('dashboard'));
  const isLogin = () => Boolean(doc && doc.getElementById && doc.getElementById('auth-form')) || /(?:^|\/)login(?:\.html)?$/i.test(String((win && win.location && win.location.pathname) || ''));
  const eventTarget = () => win || root;

  function readJson(store, key, fallback = null) {
    try { const value = store && store.getItem(key); return value == null ? fallback : JSON.parse(value); }
    catch (_) { return fallback; }
  }
  function writeJson(store, key, value) {
    try { store && store.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
  }
  function readAppSession() {
    const value = readJson(sessionStorage(), AUTH_KEY, null);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }
  function clearAppSession() { try { sessionStorage()?.removeItem(AUTH_KEY); } catch (_) {} }
  function normalizedRole(value) { return String(value || '').trim().toLowerCase(); }
  function isAdminSession(session = state.session) {
    const role = normalizedRole(session && session.role);
    const active = String(session && session.status || 'Active').trim().toLowerCase() === 'active';
    return Boolean(session && active && (role === 'admin' || role === 'main-admin'));
  }
  function isValidCachedSession(session) {
    if (!session || !session.id || !['main-admin', 'admin', 'account'].includes(normalizedRole(session.role)) || String(session.status || '').toLowerCase() !== 'active') return false;
    try {
      if (typeof DB?.isValidAppSession === 'function') return Boolean(DB.isValidAppSession(session));
    } catch (_) { return false; }
    return true;
  }
  function getNativeSessionId(session = state.session) {
    const candidate = session && (session.nativeSessionId || session.sessionId || session.id);
    if (candidate) return String(candidate);
    const store = sessionStorage();
    const existing = store && (() => { try { return store.getItem(NATIVE_SESSION_KEY); } catch (_) { return null; } })();
    if (existing) return existing;
    const generated = `tab-${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    try { store && store.setItem(NATIVE_SESSION_KEY, generated); } catch (_) {}
    return generated;
  }
  function parseDate(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function timeoutMs() {
    const minutes = Number(state.policy && state.policy.sessionTimeoutMinutes);
    return (Number.isFinite(minutes) && minutes >= 5 ? minutes : DEFAULT_POLICY.sessionTimeoutMinutes) * 60000;
  }
  function normalizePolicy(value) {
    const source = value && value.policy && typeof value.policy === 'object' ? value.policy : value;
    if (!source || typeof source !== 'object') return null;
    const policy = { ...DEFAULT_POLICY };
    for (const key of Object.keys(policy)) {
      if (key === 'autoBackupEnabled') policy[key] = Boolean(source[key]);
      else if (source[key] !== undefined && Number.isFinite(Number(source[key]))) policy[key] = Number(source[key]);
    }
    policy.sessionTimeoutMinutes = Math.min(1440, Math.max(5, policy.sessionTimeoutMinutes));
    policy.failedLoginLimit = Math.min(20, Math.max(1, policy.failedLoginLimit));
    policy.lockoutMinutes = Math.min(1440, Math.max(1, policy.lockoutMinutes));
    policy.backupRetention = Math.min(100, Math.max(1, policy.backupRetention));
    return policy;
  }
  function setStatus(kind, detail = '') {
    const element = doc && doc.getElementById && doc.getElementById('security-settings-status');
    if (!element) return;
    if (kind === 'ready') {
      element.textContent = '';
      element.hidden = true;
      element.removeAttribute?.('data-security-state');
      return;
    }
    const pending = kind === 'pending';
    element.hidden = false;
    element.setAttribute?.('data-security-state', pending ? 'pending' : 'connection');
    element.textContent = pending
      ? 'Security settings setup is pending. Run security-settings-migration.sql in Supabase SQL Editor to enable these controls.'
      : `Security settings could not be checked while offline. ${detail || 'Session enforcement will resume when the connection returns.'}`;
  }
  function isMigrationError(error) {
    const text = `${error && error.code || ''} ${error && error.message || ''} ${error && error.details || ''}`;
    return /42P01|PGRST205|does not exist|schema cache|security.?session|migration|relation/i.test(text);
  }
  function applyPolicyResult(result, error = null) {
    const ready = Boolean(result && result.ready);
    const next = ready ? normalizePolicy(result.policy || result) : null;
    if (ready && next) {
      state.policy = next;
      state.policyReady = true;
      state.policyError = null;
      if (DB) DB.securityPolicy = { ready: true, ...next };
      setStatus('ready');
      recalculateDeadline();
      return { ready: true, policy: { ...next } };
    }
    state.policyError = error || (result && result.error) || null;
    const migrationPending = isMigrationError(state.policyError) || (result && result.ready === false);
    if (migrationPending) {
      // Do not continue making policy decisions with a stale local policy when
      // the server explicitly says its security migration is unavailable.
      state.policyReady = false;
      setStatus('pending');
    } else if (!state.policyReady) {
      setStatus('connection', state.policyError && state.policyError.message);
    }
    if (DB) DB.securityPolicy = state.policyReady && state.policy ? { ready: true, ...state.policy } : { ready: false };
    return { ready: false, policy: state.policy ? { ...state.policy } : null, error: state.policyError };
  }
  async function refreshPolicy() {
    if (typeof DB?.getSecurityPolicy !== 'function') {
      return applyPolicyResult({ ready: false }, new Error('Security policy is not available yet.'));
    }
    try {
      const wasReady = state.policyReady;
      const result = await DB.getSecurityPolicy();
      const applied = applyPolicyResult(result);
      if (!wasReady && applied.ready && state.startupComplete && isDashboard()) await establishDashboardSession();
      return applied;
    } catch (error) {
      return applyPolicyResult(null, error);
    }
  }
  function recalculateDeadline() {
    if (!state.policyReady || !state.portal || !state.portal.valid) return;
    const last = parseDate(state.portal.lastActiveAt || state.lastActiveAt);
    const serverExpiry = parseDate(state.portal.expiresAt);
    const policyExpiry = last ? last + timeoutMs() : 0;
    state.localDeadline = serverExpiry && policyExpiry ? Math.min(serverExpiry, policyExpiry) : (serverExpiry || policyExpiry);
    scheduleExpiryCheck();
  }
  function scheduleExpiryCheck() {
    if (state.expiryTimer && typeof clearTimeout === 'function') clearTimeout(state.expiryTimer);
    state.expiryTimer = null;
    if (!state.localDeadline || !isVisible() || state.expired) return;
    const delay = Math.max(0, state.localDeadline - now());
    if (typeof setTimeout !== 'function') return;
    state.expiryTimer = setTimeout(() => {
      state.expiryTimer = null;
      if (!isVisible()) return;
      checkServerExpiry('deadline');
    }, Math.min(delay + 5, 2147483647));
  }
  function schedulePolicyRefresh() {
    if (state.policyTimer && typeof clearTimeout === 'function') clearTimeout(state.policyTimer);
    state.policyTimer = null;
    if (!isVisible() || typeof setTimeout !== 'function') return;
    state.policyTimer = setTimeout(async () => {
      state.policyTimer = null;
      if (isVisible()) await refreshPolicy();
      schedulePolicyRefresh();
    }, POLICY_REFRESH_MS);
  }
  function activityKey() { return `${ACTIVITY_PREFIX}${state.nativeSessionId || getNativeSessionId()}`; }
  function publishActivity(timestamp) {
    try { localStorage()?.setItem(activityKey(), String(timestamp)); } catch (_) {}
  }
  function receiveActivity(event) {
    if (!event || event.key !== activityKey()) return;
    const timestamp = Number(event.newValue);
    if (!Number.isFinite(timestamp) || timestamp <= state.lastPeerActivityAt) return;
    state.lastPeerActivityAt = timestamp;
    state.lastHumanActivityAt = Math.max(state.lastHumanActivityAt, timestamp);
    if (state.localDeadline && timestamp + timeoutMs() > state.localDeadline) {
      state.localDeadline = timestamp + timeoutMs();
      scheduleExpiryCheck();
    }
  }
  function isExpiredLocally() { return Boolean(state.localDeadline && now() >= state.localDeadline); }
  function expiredError(error) { return Boolean(error && (error.code === 'APP_SESSION_EXPIRED' || error.name === 'APP_SESSION_EXPIRED')) || /APP_SESSION_EXPIRED/i.test(String(error && error.message || '')); }
  async function closeAndSignOut() {
    try { await DB?.ensurePortalSession?.('close'); } catch (_) {}
    try { await DB?.signOut?.(); } catch (_) {}
  }
  function currentRoute() {
    const location = win && win.location;
    if (!location) return 'index.html';
    const path = String(location.pathname || 'index.html').split('/').pop() || 'index.html';
    return `${path}${String(location.search || '')}${String(location.hash || '')}`;
  }
  function redirectToLoginOnce() {
    if (state.redirected || !win?.location?.replace || /(?:^|[?&])loggedout=1(?:&|$)/.test(String(win.location.search || ''))) return;
    state.redirected = true;
    try {
      if (sessionStorage()?.getItem(REDIRECT_KEY) === '1') return;
      sessionStorage()?.setItem(REDIRECT_KEY, '1');
    } catch (_) {}
    const target = `login.html?loggedout=1&timeout=1&from=${encodeURIComponent(currentRoute())}`;
    win.location.replace(target);
  }
  async function expireSession() {
    if (state.expiring || state.expired) return false;
    state.expiring = true;
    state.expired = true;
    clearAppSession();
    await closeAndSignOut();
    redirectToLoginOnce();
    return true;
  }
  function acceptPortal(result) {
    if (!result || !result.valid) return false;
    state.portal = { ...result, valid: true };
    state.lastActiveAt = result.lastActiveAt || state.lastActiveAt;
    state.nativeSessionId = String(result.sessionId || state.nativeSessionId || getNativeSessionId());
    recalculateDeadline();
    return true;
  }
  async function checkServerExpiry(reason = 'check') {
    if (!state.session || typeof DB?.ensurePortalSession !== 'function' || state.expired) return false;
    try {
      const result = await DB.ensurePortalSession('check');
      if (result && (result.expired || result.code === 'APP_SESSION_EXPIRED')) { await expireSession(); return false; }
      if (result && result.valid) acceptPortal(result);
      else if (result && result.expired) await expireSession();
      return Boolean(result && result.valid);
    } catch (error) {
      if (expiredError(error)) { await expireSession(); return false; }
      // A connection failure is not an expiry. The API/RLS remains authoritative.
      state.policyError = error;
      return false;
    }
  }
  async function touchFromHumanActivity() {
    if (!state.session || state.expired || !state.policyReady || !isVisible()) return false;
    if (isExpiredLocally()) {
      const valid = await checkServerExpiry('activity-deadline');
      if (!valid) return false;
    }
    const timestamp = now();
    state.lastHumanActivityAt = timestamp;
    publishActivity(timestamp);
    if (timestamp - state.lastServerTouchAt < TOUCH_THROTTLE_MS) return true;
    if (typeof DB?.ensurePortalSession !== 'function') return false;
    try {
      const result = await DB.ensurePortalSession('touch');
      if (result && (result.expired || result.code === 'APP_SESSION_EXPIRED')) { await expireSession(); return false; }
      if (!result || !result.valid) return false;
      state.lastServerTouchAt = timestamp;
      acceptPortal(result);
      return true;
    } catch (error) {
      if (expiredError(error)) await expireSession();
      return false;
    }
  }
  async function onHumanActivity(event) {
    if (event?.isTrusted === false) return;
    if (!isVisible() || !state.session || state.expired) return;
    // A backgrounded phone may deliver its first input after returning. Check
    // the server first; visibility/focus itself never counts as activity.
    if (state.wasHidden) {
      state.wasHidden = false;
      const valid = await checkServerExpiry('return');
      if (!valid || state.expired) return;
    }
    await touchFromHumanActivity();
  }
  function onVisibilityChange() {
    if (isVisible()) {
      // This is an expiry check only. It intentionally does not touch activity.
      checkServerExpiry('visibility');
      schedulePolicyRefresh();
    } else {
      state.wasHidden = true;
      if (state.policyTimer && typeof clearTimeout === 'function') clearTimeout(state.policyTimer);
      state.policyTimer = null;
    }
  }
  function onFocus() {
    if (isVisible()) checkServerExpiry('focus');
  }
  function attachListeners() {
    if (state.listenersAttached || !doc) return;
    state.listenersAttached = true;
    ['pointerdown', 'pointermove', 'wheel', 'keydown', 'input', 'touchstart'].forEach(type => doc.addEventListener(type, onHumanActivity, { passive: true }));
    doc.addEventListener('visibilitychange', onVisibilityChange);
    eventTarget()?.addEventListener?.('focus', onFocus);
    eventTarget()?.addEventListener?.('storage', receiveActivity);
    ['security-policy-change', 'security-settings-saved', 'settings-saved', 'maintenance-change'].forEach(type => eventTarget()?.addEventListener?.(type, () => refreshPolicy()));
    try {
      const unsubscribe = DB?.onStoresChanged?.(['church-reconstruction-settings-v1'], () => refreshPolicy());
      state.unsubscribe = typeof unsubscribe === 'function' ? unsubscribe : null;
    } catch (_) {}
  }
  async function establishDashboardSession() {
    if (state.establishing) return state.establishing;
    state.establishing = establishDashboardSessionOnce();
    try { return await state.establishing; } finally { state.establishing = null; }
  }
  async function establishDashboardSessionOnce() {
    if (!isDashboard() || !state.policyReady || !isValidCachedSession(state.session)) return { valid: false, skipped: true };
    if (typeof DB?.ensurePortalSession !== 'function') return { valid: false, skipped: true };
    try {
      const result = await DB.ensurePortalSession('open');
      if (result && (result.expired || result.code === 'APP_SESSION_EXPIRED')) { await expireSession(); return result; }
      if (!result || !result.valid) return result || { valid: false };
      acceptPortal(result);
      let syncResult = null;
      try { syncResult = await DB.syncNow?.(); } catch (_) { syncResult = null; }
      const pending = Boolean(state.session && state.session.automaticBackupPending === true);
      if (pending && isAdminSession(state.session) && (!syncResult || syncResult.ok !== false)) {
        // The flag is consumed after the managed session has been established
        // and the initial sync attempted, even when policy disables backups.
        try {
          if (state.policy.autoBackupEnabled) await DB.createBackup?.({ automatic: true });
        } catch (_) {}
        try {
          const next = { ...state.session }; delete next.automaticBackupPending;
          sessionStorage()?.setItem(AUTH_KEY, JSON.stringify(next));
          state.session = next;
        } catch (_) {}
      }
      return { ...result, syncResult };
    } catch (error) {
      if (expiredError(error)) await expireSession();
      // Missing migration/network problems leave the cached identity intact.
      return { valid: false, error };
    }
  }
  async function start() {
    if (state.started) return ChurchSecurity.ready;
    state.started = true;
    state.session = readAppSession();
    state.nativeSessionId = getNativeSessionId(state.session);
    if (isLogin()) {
      // The marker prevents duplicate redirects during one expiry handling
      // pass, but must not survive a later successful sign-in in this tab.
      try { sessionStorage()?.removeItem(REDIRECT_KEY); } catch (_) {}
    }
    attachListeners();
    await refreshPolicy();
    schedulePolicyRefresh();
    if (isDashboard()) await establishDashboardSession();
    state.startupComplete = true;
    return ChurchSecurity;
  }
  const ChurchSecurity = {
    get ready() { return state.readyPromise || Promise.resolve(this); },
    refreshPolicy,
    resumeAfterSettingsSave: refreshPolicy,
    async check() { return checkServerExpiry('manual'); },
    async touch() { return touchFromHumanActivity(); },
    async expire() { return expireSession(); },
    getState() {
      return {
        policyReady: state.policyReady,
        policy: state.policy && { ...state.policy },
        session: state.session && { ...state.session },
        portal: state.portal && { ...state.portal },
        nativeSessionId: state.nativeSessionId,
        lastActiveAt: state.lastActiveAt,
        localDeadline: state.localDeadline,
        expired: state.expired
      };
    }
  };
  state.readyPromise = start();
  win.ChurchSecurity = ChurchSecurity;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
