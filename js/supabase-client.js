/**
 * New Apostolic Church Kumasi Central — Supabase Integration Client
 * Provides centralized cloud persistence, authentication, automatic sync, and offline fallback.
 */

(function () {
  const SUPABASE_URL = 'https://nsccmfevvkvjhvxrtmax.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zY2NtZmV2dmt2amh2eHJ0bWF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5NzAyMjUsImV4cCI6MjEwOTU0NjIyNX0.74g0XDDodI8rZ9FJvcnbTwh85Jy_XHBsn44TxnwbLok';

  let client = null;
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storage: window.localStorage
      }
    });
  }

  const STORES = {
    profiles: 'church-profiles-v1',
    guests: 'church-guests-v1',
    members: 'church-members-v1',
    departments: 'church-departments-v1',
    services: 'church-services-v1',
    churchDues: 'church-general-dues-v1',
    ministryDues: 'church-ministry-dues-v1',
    offerings: 'church-offerings-v1',
    thanksgiving: 'church-thanksgiving-v1',
    attendance: 'church-attendance-v1',
    ministers: 'church-reconstruction-ministers-v1',
    announcements: 'church-reconstruction-announcements-v1',
    settings: 'church-reconstruction-settings-v1',
    activity: 'church-activity-v1'
  };

  const DB = {
    client,
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    isValidAppSession: validAppSession,
    isConnected: false,
    isSyncing: false,
    reload() { location.reload(); },
    async syncNow() { const res = await syncAll(); afterSync(res); return res; },
    onStoresChanged(storeKeys, callback) { return registerStoreRenderer(storeKeys, callback); },
    deferViewUpdatesWhile(predicate) { viewUpdateGuards.add(predicate); return () => viewUpdateGuards.delete(predicate); },
    resumeViewUpdates() { setTimeout(flushViewUpdates, 0); },

    // ----------------------------------------------------
    // AUTHENTICATION
    // ----------------------------------------------------
    async signIn(email, password) {
      if (!client) throw new Error('Supabase client is not available.');
      const res = await client.auth.signInWithPassword({ email, password });
      if (res.error) throw res.error;
      return res.data;
    },

    async signUp(email, password, metadata = {}) {
      if (!client) throw new Error('Supabase client is not available.');
      const res = await client.auth.signUp({
        email,
        password,
        options: {
          data: metadata
        }
      });
      if (res.error) throw res.error;
      return res.data;
    },

    async signOut() {
      if (!client) return;
      await client.auth.signOut();
    },

    async createUserAccount(payload) {
      if (!client) throw new Error('Supabase client is not available.');
      const sessionError = () => Object.assign(new Error('Your Supabase session is missing or expired. Sign out, then sign in again as a Main Admin using the Supabase account password.'), { code: 'AUTH_REQUIRED' });
      const { data, error } = await client.auth.getSession();
      let session = data?.session || null;
      if (error || !session?.access_token || (session.expires_at && session.expires_at * 1000 <= Date.now() + 60000)) {
        const refreshed = await client.auth.refreshSession();
        session = refreshed.data?.session || null;
      }
      if (!session?.access_token) throw sessionError();
      const request = token => fetch('/api/admin-create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload || {})
      });
      let response = await request(session.access_token);
      if (response.status === 401) {
        const refreshed = await client.auth.refreshSession();
        const freshSession = refreshed.data?.session || null;
        if (freshSession?.access_token) response = await request(freshSession.access_token);
      }
      let result = {};
      try { result = await response.json(); } catch (_) {}
      if (response.status === 401) throw sessionError();
      if (!response.ok) throw new Error(result.error || 'Supabase could not create the account.');
      return result;
    },

    async getSession() {
      if (!client) return null;
      const { data } = await client.auth.getSession();
      return data?.session || null;
    },

    async appSessionForUser(user) { return verifiedAppProfile(user); },

    async getAppSession() {
      if (!client) return null;
      const { data: saved, error: sessionError } = await client.auth.getSession();
      if (sessionError || !saved?.session?.access_token) return null;
      const { data, error } = await client.auth.getUser();
      if (error || !data?.user) return null;
      return verifiedAppProfile(data.user);
    },

    // ----------------------------------------------------
    // TEST CONNECTION
    // ----------------------------------------------------
    async testConnection() {
      if (!client) return { ok: false, error: 'Supabase client not loaded' };
      try {
        const { data, error } = await client.from('members').select('id').limit(1);
        if (error) {
          return { ok: false, error: error.message };
        }
        this.isConnected = true;
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err.message || 'Network error' };
      }
    },

    // ----------------------------------------------------
    // TEST CONNECTION
    // ----------------------------------------------------
    async testConnection() {
      if (!client) return { ok: false, error: 'Supabase client not loaded' };
      try {
        const { data, error } = await client.from('members').select('id').limit(1);
        if (error) {
          return { ok: false, error: error.message };
        }
        this.isConnected = true;
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err.message || 'Network error' };
      }
    },



    // ----------------------------------------------------
    // REGISTRATION + APPROVAL REQUESTS (stored online so the Main Admin gets them on any device)
    // ----------------------------------------------------
    async sendRegistrationRequest({ userId, email, name }) {
      if (!client) return false;
      const dupe = e => e && (e.code === '23505' || /duplicate key/i.test(String(e.message || '')));
      let ok = true;
      const prof = await client.from('profiles').insert({ id: userId, email, name, role: 'member', status: 'Pending' });
      if (prof.error && !dupe(prof.error)) { ok = false; console.warn('[Registration] profile:', prof.error.message); }
      const req = await client.from('registration_requests').insert({ id: 'req-' + userId, user_id: userId, email, name, status: 'Pending' });
      if (req.error && !dupe(req.error)) { ok = false; console.warn('[Registration] request:', req.error.message); }
      return ok;
    },

    async registerAccount({ email, password, name }) {
      if (!client) throw new Error('Registration needs an internet connection. Please try again when you are online.');
      email = String(email || '').trim().toLowerCase();
      const exists = new Error('An account with this email already exists. Please sign in, or contact the Main Admin if your registration is still waiting.');
      const { data, error } = await client.auth.signUp({ email, password, options: { data: { name, role: 'member', status: 'Pending' } } });
      if (error) { if (/already|registered|exists/i.test(String(error.message || ''))) throw exists; throw new Error(error.message || 'Registration failed.'); }
      const user = data && data.user;
      if (!user || !user.id || (Array.isArray(user.identities) && user.identities.length === 0)) throw exists;
      const pending = { userId: user.id, email, name };
      let sent = false;
      try { sent = await this.sendRegistrationRequest(pending); } catch (_) { sent = false; }
      if (!sent) { try { const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); q.push(pending); rawSetItem(OUTBOX_KEY, JSON.stringify(q)); } catch (_) {} }
      try { if (data.session) await client.auth.signOut(); } catch (_) {}      /* a not-yet-approved person is never left signed in */
      return { userId: user.id, requestSent: sent };
    },

    async flushRegistrationOutbox() {
      if (!client) return;
      let q = []; try { q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch (_) {}
      if (!Array.isArray(q) || !q.length) return;
      const left = [];
      for (const item of q) { let ok = false; try { ok = await this.sendRegistrationRequest(item); } catch (_) {} if (!ok) left.push(item); }
      try { rawSetItem(OUTBOX_KEY, JSON.stringify(left)); } catch (_) {}
    },

    async listRegistrationRequests() {
      if (!client) throw new Error('Supabase client is not available.');
      const { data, error } = await client.from('registration_requests').select('*').order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return data || [];
    },

    async decideRegistration({ email, approve, role, decidedBy }) {
      if (!client) throw new Error('Supabase client is not available.');
      email = String(email || '').trim().toLowerCase();
      const patch = approve ? { role, status: 'Active' } : { status: 'Declined' };
      const prof = await client.from('profiles').update(patch).eq('email', email).select('id');
      if (prof.error) throw prof.error;
      if (!prof.data || !prof.data.length) throw new Error('No online account was found for ' + email + '. Ask the person to register again.');
      const req = await client.from('registration_requests').update({ status: approve ? 'Approved' : 'Declined', role: approve ? role : null, decided_by: decidedBy || null, decided_at: new Date().toISOString() }).eq('email', email).eq('status', 'Pending').select('id');
      if (req.error) throw req.error;
      return true;
    },

    watchRegistrations(callback) {
      try { if (client && client.channel) client.channel('registration-requests').on('postgres_changes', { event: '*', schema: 'public', table: 'registration_requests' }, () => callback()).subscribe(); } catch (_) {}
    },

    // ----------------------------------------------------
    // MANUAL BUTTONS (Settings page) - both just run a full two-way sync
    // ----------------------------------------------------
    async pullAllFromCloud(silent = false) {
      if (!client) return false;
      const res = await syncAll();
      if (res.ok && !silent && window.notify) window.notify('Synchronized with the Supabase cloud.', 'success', 'Cloud Synchronized');
      if (!res.ok && !silent) alert('Could not synchronize:\n\n' + res.errors.join('\n'));
      afterSync(res);
      return res.ok;
    },

    async pushAllToCloud() {
      if (!client) { alert('Supabase client is not loaded.'); return false; }
      const test = await this.testConnection();
      if (!test.ok) {
        alert('Could not connect to Supabase tables:\n\n' + test.error + '\n\nPlease ensure you ran "supabase-schema.sql" in your Supabase SQL Editor.');
        return false;
      }
      const res = await syncAll();
      if (!res.ok) { alert('Upload failed:\n\n' + res.errors.join('\n')); return false; }
      window.notify && window.notify('All records are synchronized with Supabase.', 'success', 'Upload Complete');
      afterSync(res);
      return true;
    },

    // ----------------------------------------------------
    // UI STATUS PILL
    // ----------------------------------------------------
    // No logo/pill in the top bar any more. Status is shown quietly in Settings -> Cloud Database.
    updateStatusBadge(status, detail) {
      this.lastStatus = status;
      const pill = document.getElementById('supabase-status-pill');   // remove any leftover pill
      if (pill) pill.remove();
      const el = document.getElementById('cloud-sync-status');
      if (!el) return;
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (status === 'connected') { el.textContent = 'Sync v2 · Connected and up to date (' + time + ')'; el.style.color = '#12805c'; }
      else if (status === 'error') { el.textContent = 'Sync v2 · Not synced yet' + (detail ? ': ' + detail : '') + '. Changes are kept on this device and will retry.'; el.style.color = '#b4332d'; }
      else { el.textContent = 'Sync v2 · Connecting…'; el.style.color = ''; }
    }
  };

  function validAppSession(session) {
    return !!session && typeof session === 'object' && !!session.id && !!session.email && session.isCloud === true
      && ['main-admin', 'admin', 'account'].includes(String(session.role || '').trim().toLowerCase())
      && String(session.status || '').trim().toLowerCase() === 'active';
  }

  async function verifiedAppProfile(user) {
    if (!client || !user?.id || !user?.email) throw new Error('A valid Supabase sign-in is required.');
    const lookup = await client.from('profiles').select('*').eq('id', user.id).maybeSingle();
    let profile = lookup.data, profileError = lookup.error, recoveryMessage = '';
    if (!profile || profileError) {
      try {
        const { data } = await client.auth.getSession();
        if (data?.session?.access_token) {
          const response = await fetch('/api/session-profile', { method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}` } });
          const result = await response.json();
          if (response.ok && result.profile?.id === user.id) { profile = result.profile; profileError = null; }
          else recoveryMessage = result.error || '';
        }
      } catch (_) { /* Keep the original validation error if recovery is unavailable. */ }
    }
    if (profileError) throw new Error(recoveryMessage || 'Could not verify your account profile. Check your connection and try signing in again.');
    if (!profile) throw new Error(recoveryMessage || 'Your account profile is missing. Ask the Main Admin to repair your account.');
    if (profile.id !== user.id) throw new Error('Your account profile identity could not be verified. Please contact the Main Admin.');
    const role = String(profile.role || '').trim().toLowerCase();
    const status = String(profile.status || '').trim().toLowerCase();
    if (status === 'pending') throw new Error('Your registration is pending approval by the Main Admin.');
    if (status === 'declined') throw new Error('Your registration was declined. Please contact the Main Admin.');
    if (status !== 'active') throw new Error('This account is inactive. Contact the Main Admin.');
    if (!['main-admin', 'admin', 'account'].includes(role)) throw new Error('This account does not have access to the administration system.');
    return {
      id: user.id, email: user.email,
      name: profile.name || profile.display_name || user.user_metadata?.name || String(user.email).split('@')[0],
      role, status: 'Active', isCloud: true
    };
  }

  function readJson(k, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      return v ?? fallback;
    } catch (_) {
      return fallback;
    }
  }


  // ==========================================================================
  //  SYNC ENGINE  (per-record, 3-way merge: this device  <->  cloud  <->  last sync)
  //
  //  Why: the old engine replaced local data with the cloud copy on every page
  //  load, so any change that had not reached the cloud yet (slow mobile data,
  //  a quick refresh, a failed upload) was wiped. Now:
  //    * a record you changed on this device is NEVER overwritten by the cloud
  //    * a record changed on another device is adopted here
  //    * records deleted on one device are deleted on the others
  //    * failed uploads are kept and retried automatically
  // ==========================================================================
  const nativeSetItem = Storage.prototype.setItem;               // captured BEFORE we patch it
  const rawSetItem = (k, v) => nativeSetItem.call(window.localStorage, k, v);
  const META_KEY = 'church-sync-meta-v1';
  const OUTBOX_KEY = 'church-registration-outbox-v1';

  const txt = (v, d) => (v === undefined || v === null) ? (d === undefined ? '' : d) : String(v);
  const COLLECTIONS = {
    members: { store: STORES.members, newFirst: true, chunk: 20, map: [
      ['id','id'],['name','name'],['email','email'],['phone','phone'],['dob','dob'],['place','place'],
      ['department','department'],['departments','departments','json',[]],['joined','joined'],
      ['status','status','text','Active'],['photo','photo']] },
    departments: { store: STORES.departments, uniqueBy: 'name', map: [['id','id'],['name','name'],['description','description']] },
    services: { store: STORES.services, map: [['id','id'],['date','date'],['time','time','text','09:00'],
      ['venue','venue','text','Main Auditorium'],['description','description']] },
    church_dues: { store: STORES.churchDues, map: [['id','id'],['memberId','member_id'],['memberName','member_name'],
      ['department','department'],['amount','amount','num'],['month','month'],['paidOn','paid_on'],
      ['method','method','text','Cash'],['txnId','txn_id'],['recordedBy','recorded_by','json',null]] },
    ministry_dues: { store: STORES.ministryDues, map: [['id','id'],['memberId','member_id'],['memberName','member_name'],
      ['department','department'],['amount','amount','num'],['month','month'],['paidOn','paid_on'],
      ['method','method','text','Cash'],['txnId','txn_id'],['recordedBy','recorded_by','json',null]] },
    offerings: { store: STORES.offerings, map: [['id','id'],['date','date'],['amount','amount','num'],
      ['serviceId','service_id'],['note','notes'],['recordedBy','recorded_by','json',null]] },
    thanksgiving: { store: STORES.thanksgiving, map: [['id','id'],['date','date'],['amount','amount','num'],
      ['memberId','member_id'],['giver','member_name'],['location','location'],['note','notes'],
      ['recordedBy','recorded_by','json',null]] },
    ministers: { store: STORES.ministers, newFirst: true, map: [['id','id'],['name','name'],['role','role'],
      ['note','bio'],['photo','photo'],['order','display_order','int']] },
    announcements: { store: STORES.announcements, newFirst: true, map: [['id','id'],['title','title'],['date','date'],['content','content']] },
    activity: { store: STORES.activity, table: 'activity_logs', optional: true, newFirst: true, map: [
      ['id','id'],['at','at'],['entity','entity'],['action','action'],['userId','user_id'],['userName','user_name'],['role','role'],['summary','summary'],['data','data','json',{}]
    ] },
    // guests / visitors recorded on the Attendance page
    guests: { store: STORES.guests, table: 'guests', optional: true, newFirst: true, map: [['id','id'],['serviceKey','service_key'],['date','date'],['name','name'],['phone','phone'],['place','place'],['invitedBy','invited_by'],['note','note']] },
    // account profiles (display name + photo), keyed by e-mail: { "name@x.com": { name, photo } }
    profiles: { store: STORES.profiles, table: 'user_profiles', optional: true, kind: 'map', map: [['id','id'],['name','name'],['photo','photo']],
      toItems: parsed => Object.keys(parsed || {}).filter(k => parsed[k] && typeof parsed[k] === 'object').map(k => Object.assign({ id: k }, parsed[k])),
      fromItems: items => { const o = {}; items.forEach(i => { const c = Object.assign({}, i); delete c.id; o[i.id] = c; }); return o; } },
    // attendance is stored locally as { "<serviceKey>": { "<memberId>": "present" | ... } }
    attendance: { store: STORES.attendance, kind: 'map', noExtra: true, map: [['id','id'],['records','records','json',{}]],
      post: row => { row.service_id = row.id; },
      toItems: parsed => Object.keys(parsed || {}).map(k => ({ id: k, records: parsed[k] })),
      fromItems: items => { const o = {}; items.forEach(i => { o[i.id] = i.records; }); return o; } }
  };
  Object.keys(COLLECTIONS).forEach(t => {
    const d = COLLECTIONS[t]; d.table = d.table || t;
    d.toItems = d.toItems || (p => (Array.isArray(p) ? p : []).filter(x => x && typeof x === 'object'));
    d.fromItems = d.fromItems || (items => items);
  });
  const STORE_TO_COLLECTION = {};
  Object.keys(COLLECTIONS).forEach(t => { STORE_TO_COLLECTION[COLLECTIONS[t].store] = t; });

  let useExtra = true; // flips to false automatically if the cloud tables have no "extra" column yet

  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h) + ':' + s.length; }

  function toRow(def, item) {
    const row = {}, mapped = {};
    def.map.forEach(([lk, col, type, dflt]) => {
      mapped[lk] = true;
      const v = item[lk];
      if (type === 'num') row[col] = Number(v || 0) || 0;
      else if (type === 'int') row[col] = parseInt(v, 10) || 0;
      else if (type === 'json') row[col] = (v === undefined || v === null) ? (dflt === undefined ? null : dflt) : v;
      else row[col] = (v === undefined || v === null || v === '') ? txt(null, dflt) : String(v);
    });
    row.id = String(item.id);
    if (def.post) def.post(row);
    if (useExtra && !def.noExtra) {
      const extra = {};
      Object.keys(item).forEach(k => { if (!mapped[k]) extra[k] = item[k]; });
      row.extra = extra;
    }
    return row;
  }
  function fromRow(def, row, base) {
    const obj = Object.assign({}, base || {}, (row.extra && typeof row.extra === 'object') ? row.extra : {});
    def.map.forEach(([lk, col, type, dflt]) => {
      const v = row[col];
      if (type === 'num') obj[lk] = (Number(v || 0) || 0).toFixed(2);
      else if (type === 'int') obj[lk] = parseInt(v, 10) || 0;
      else if (type === 'json') obj[lk] = (v === undefined || v === null) ? (dflt === undefined ? null : dflt) : v;
      else obj[lk] = (v === undefined || v === null) ? txt(null, dflt) : String(v);
    });
    return obj;
  }

  function readMeta() { const m = readJson(META_KEY, null); return (m && typeof m === 'object') ? m : {}; }
  function writeMeta(m) { try { rawSetItem(META_KEY, JSON.stringify(m)); } catch (_) {} }
  const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
  const isExtraError = e => /extra/i.test(String((e && (e.message || e.details)) || '')) && /(column|schema)/i.test(String((e && (e.message || e.details)) || ''));

  async function pushRows(def, rows) {
    for (const part of chunks(rows, def.chunk || 100)) {
      let payload = part;
      let { error } = await client.from(def.table).upsert(payload);
      if (error && useExtra && isExtraError(error)) {            // cloud tables not upgraded yet -> retry without "extra"
        useExtra = false;
        payload = part.map(r => { const c = Object.assign({}, r); delete c.extra; return c; });
        ({ error } = await client.from(def.table).upsert(payload));
      }
      if (error) throw error;
    }
  }

  async function syncCollection(name) {
    const def = COLLECTIONS[name];
    const meta = readMeta(); meta.synced = meta.synced || {};
    const raw = localStorage.getItem(def.store);
    let parsed = null; try { parsed = raw === null ? null : JSON.parse(raw); } catch (_) { parsed = null; }
    const S = (raw !== null && parsed !== null && meta.synced[name]) ? meta.synced[name] : null;   // last-synced hashes per id
    const localItems = def.toItems(parsed || (def.kind === 'map' ? {} : []));

    const localById = new Map();
    localItems.forEach(it => { if (it.id !== undefined && it.id !== null && String(it.id) !== '') localById.set(String(it.id), it); });

    const sel = await client.from(def.table).select('*');
    if (sel.error) throw sel.error;
    let cloudRows = sel.data || [];
    // These three exact rows were demo placeholders shipped by the old UI.
    // Remove them everywhere so a phone with an old local cache cannot resurrect them.
    if (def.table === 'members') {
      const placeholders = cloudRows.filter(row => /^NAC-000[1-3]$/.test(String(row.id || '')) && /^Member 00[1-3]$/.test(String(row.name || '')) && /@example\.net$/i.test(String(row.email || '')));
      if (placeholders.length) {
        const { error } = await client.from(def.table).delete().in('id', placeholders.map(row => row.id));
        if (error) throw error;
        const removed = new Set(placeholders.map(row => String(row.id)));
        cloudRows = cloudRows.filter(row => !removed.has(String(row.id)));
      }
    }
    const cloudById = new Map(cloudRows.map(r => [String(r.id), r]));

    const lh = new Map(), ch = new Map(), cItem = new Map();
    localById.forEach((it, id) => lh.set(id, hash(stable(toRow(def, it)))));
    cloudById.forEach((r, id) => { const it = fromRow(def, r, localById.get(id)); cItem.set(id, it); ch.set(id, hash(stable(toRow(def, it)))); });

    const cloudNames = new Map();
    if (def.uniqueBy) cloudById.forEach((r, id) => {
      const deletedHere = !localById.has(id) && S && S[id] !== undefined;          // user removed it on this device
      if (!deletedHere) cloudNames.set(String(r[def.uniqueBy] || '').trim().toLowerCase(), id);
    });

    const upserts = [], deletes = [], finalItems = new Map(), newSynced = {};
    const ids = new Set([...localById.keys(), ...cloudById.keys(), ...(S ? Object.keys(S) : [])]);
    ids.forEach(id => {
      const L = localById.get(id), hasC = cloudById.has(id), s = S ? S[id] : undefined;
      if (L && hasC) {
        if (lh.get(id) === ch.get(id)) { finalItems.set(id, L); newSynced[id] = lh.get(id); }
        else if (s === undefined) {
          // A local record can be a valid edit made before the first sync
          // completed. Do not replace it with an older cloud copy on login.
          // The local version is uploaded and becomes the new sync baseline.
          upserts.push(L); finalItems.set(id, L); newSynced[id] = lh.get(id);
        }
        else if (lh.get(id) !== s) { upserts.push(L); finalItems.set(id, L); newSynced[id] = lh.get(id); }     // changed here: keep + upload
        else { finalItems.set(id, cItem.get(id)); newSynced[id] = ch.get(id); }                                // changed elsewhere: adopt
      } else if (L && !hasC) {
        const dupName = def.uniqueBy && cloudNames.has(String(L[def.uniqueBy] || '').trim().toLowerCase());
        if (dupName) { /* same name already exists in cloud under another id: use the cloud one */ }
        else if (s !== undefined && lh.get(id) === s) { /* deleted on another device: remove here */ }
        else { upserts.push(L); finalItems.set(id, L); newSynced[id] = lh.get(id); }                          // new here: upload
      } else if (!L && hasC) {
        if (s !== undefined) deletes.push(id);                                                                  // deleted here: delete in cloud
        else { finalItems.set(id, cItem.get(id)); newSynced[id] = ch.get(id); }                                 // new elsewhere: adopt
      }
    });

    // Safety net: never wipe the cloud because this device's list came back empty.
    if (deletes.length >= 2 && localById.size === 0) {
      deletes.splice(0, deletes.length);
      cloudById.forEach((r, id) => { if (!finalItems.has(id)) { finalItems.set(id, cItem.get(id)); newSynced[id] = ch.get(id); } });
    }

    for (const part of chunks(deletes, 100)) {
      const { error } = await client.from(def.table).delete().in('id', part);
      if (error) throw error;
    }
    if (upserts.length) await pushRows(def, upserts.map(it => toRow(def, it)));

    // Build the new local list: keep this device's order, then add records that are new from other devices.
    const ordered = [];
    localItems.forEach(it => { const id = String(it.id); if (finalItems.has(id)) { ordered.push(finalItems.get(id)); finalItems.delete(id); } });
    const fresh = [];
    finalItems.forEach((it, id) => fresh.push({ it, at: String((cloudById.get(id) || {}).created_at || '') }));
    fresh.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
    const freshItems = fresh.map(x => x.it);
    const finalList = def.newFirst ? freshItems.reverse().concat(ordered) : ordered.concat(freshItems);

    const nextParsed = def.fromItems(finalList);
    const before = parsed === null ? null : JSON.stringify(parsed), after = JSON.stringify(nextParsed);
    let changed = false;
    if (before !== after && !(parsed === null && finalList.length === 0)) { rawSetItem(def.store, after); changed = true; }
    meta.synced[name] = newSynced; writeMeta(meta);
    return { changed };
  }

  async function syncSettings() {
    const meta = readMeta();
    const raw = localStorage.getItem(STORES.settings);
    let local = null; try { local = raw ? JSON.parse(raw) : null; } catch (_) {}
    const { data: row, error } = await client.from('church_settings').select('*').eq('key', 'general').maybeSingle();
    if (error) throw error;
    const cloud = row && row.value ? row.value : null;
    const lh = local ? hash(stable(local)) : null, chh = cloud ? hash(stable(cloud)) : null, s = meta.settingsHash;
    let changed = false;
    if (local && !cloud) { await upsertSettings(local); meta.settingsHash = lh; }
    else if (!local && cloud) { rawSetItem(STORES.settings, JSON.stringify(cloud)); meta.settingsHash = chh; changed = true; }
    else if (local && cloud) {
      if (lh === chh) meta.settingsHash = lh;
      else if (s === undefined || lh !== s) { await upsertSettings(local); meta.settingsHash = lh; }
      else { rawSetItem(STORES.settings, JSON.stringify(cloud)); meta.settingsHash = chh; changed = true; }
    }
    writeMeta(meta);
    return { changed };
  }
  async function upsertSettings(value) {
    const { error } = await client.from('church_settings').upsert({ key: 'general', value, updated_at: new Date().toISOString() });
    if (error) throw error;
  }

  // ---- run all syncs one after another (never two at once) ----
  let queue = Promise.resolve();
  let lastErrorShown = '';
  function syncAll() {
    queue = queue.then(runOnce, runOnce);
    return queue;
  }
  async function runOnce() {
    if (!client) return { ok: false, changed: false, errors: ['Supabase client not loaded'] };
    DB.isSyncing = true;
    let changed = false; const errors = [], changedStores = [];
    for (const name of Object.keys(COLLECTIONS)) {
      try { const r = await syncCollection(name); changed = changed || r.changed; if (r.changed) changedStores.push(COLLECTIONS[name].store); }
      catch (e) {
        const text = String((e && (e.message || e.details)) || e);
        if (COLLECTIONS[name].optional && /does not exist|schema cache|could not find the table|relation|PGRST205|42P01|404/i.test(text)) {
          console.info('[Supabase Sync] optional table not set up yet:', COLLECTIONS[name].table);
          if (name === 'activity') {
            const notice = document.getElementById('activity-notice');
            if (notice) notice.textContent = 'Activity Log cloud storage is not enabled yet. Run activity-log-migration.sql in Supabase SQL Editor; other records are syncing normally.';
          }
        }
        else errors.push(name + ': ' + text);
      }
    }
    try { const r = await syncSettings(); changed = changed || r.changed; if (r.changed) changedStores.push(STORES.settings); }
    catch (e) { errors.push('settings: ' + ((e && (e.message || e.details)) || e)); }
    DB.isSyncing = false;
    if (errors.length) {
      const msg = errors[0];
      DB.isConnected = false; DB.updateStatusBadge('error', msg);
      if (msg !== lastErrorShown && window.notify) {
        lastErrorShown = msg;
        window.notify('Saved on this device, but not yet in the cloud (' + msg + '). It will retry automatically.', 'error', 'Cloud sync problem');
      }
      console.warn('[Supabase Sync]', errors);
    } else {
      lastErrorShown = ''; DB.isConnected = true; DB.updateStatusBadge('connected');
    }
    return { ok: errors.length === 0, changed, changedStores, errors };
  }

  // ---- refresh adopted cloud data without reloading or changing the route ----
  const storeRenderers = new Set(), pendingRenderStores = new Set(), viewUpdateGuards = new Set();
  function registerStoreRenderer(storeKeys, callback) {
    if (!Array.isArray(storeKeys) || typeof callback !== 'function') return () => {};
    const entry = { keys: new Set(storeKeys), callback };
    storeRenderers.add(entry);
    return () => storeRenderers.delete(entry);
  }
  function safeToRefreshViews() {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;
    if (document.querySelector('dialog[open]')) return false;
    if (/-(new|edit)$/.test(location.hash)) return false;
    const settingsDirty = document.getElementById('settings-dirty');
    if (settingsDirty && !settingsDirty.hidden) return false;
    for (const predicate of viewUpdateGuards) { try { if (predicate()) return false; } catch (_) { return false; } }
    return true;
  }
  function flushViewUpdates() {
    if (!pendingRenderStores.size || !safeToRefreshViews()) return;
    const changedStores = [...pendingRenderStores];
    pendingRenderStores.clear();
    const x = window.scrollX || 0, y = window.scrollY || 0;
    storeRenderers.forEach(entry => {
      if (!changedStores.some(key => entry.keys.has(key))) return;
      try { entry.callback(changedStores); } catch (error) { console.warn('[Cloud view refresh]', error.message || 'A view could not update.'); }
    });
    window.dispatchEvent(new CustomEvent('church-data-change', { detail: { stores: changedStores } }));
    if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
  }
  function queueViewUpdates(stores) {
    stores.forEach(key => pendingRenderStores.add(key));
    flushViewUpdates();
  }
  function afterSync(res) {
    if (!res || !res.changed) return;
    queueViewUpdates(res.changedStores || []);
  }
  document.addEventListener('focusout', () => setTimeout(flushViewUpdates, 0));
  document.addEventListener('close', () => setTimeout(flushViewUpdates, 0), true);
  window.addEventListener('hashchange', () => setTimeout(flushViewUpdates, 0));
  window.addEventListener('storage', event => {
    if (event.key && (STORE_TO_COLLECTION[event.key] || event.key === STORES.settings)) queueViewUpdates([event.key]);
  });

  // ---- watch saves: any change to a synced store is uploaded shortly after ----
  let timer = null;
  function scheduleSync(ms) {
    // The sign-in page must not upload records or interrupt authentication.
    if (!document.getElementById('dashboard')) return;
    clearTimeout(timer);
    timer = setTimeout(() => { syncAll().then(r => afterSync(r)); }, ms || 700);
  }
  Storage.prototype.setItem = function (key, value) {
    nativeSetItem.call(this, key, value);
    try { if (this === window.localStorage && client && (STORE_TO_COLLECTION[key] || key === STORES.settings)) scheduleSync(); } catch (_) {}
  };

  // ---- start-up: sync once the page is ready, and again whenever the device comes back online / the tab is reopened ----
  document.addEventListener('DOMContentLoaded', async () => {
    if (!document.getElementById('dashboard')) return;
    DB.updateStatusBadge('connecting');
    const test = await DB.testConnection();
    if (!test.ok) {
      console.warn('[Supabase Setup Required]', test.error);
      DB.updateStatusBadge('error', test.error);
      if (window.notify) window.notify('Cloud database not reachable (' + test.error + '). Your changes are kept on this device and will upload automatically when it is reachable.', 'error', 'Cloud sync problem');
      return;
    }
    const res = await syncAll();
    afterSync(res);
  });
  document.addEventListener('DOMContentLoaded', () => { if (document.getElementById('dashboard')) { try { DB.flushRegistrationOutbox(); } catch (_) {} } });
  window.addEventListener('online', () => { scheduleSync(1500); if (document.getElementById('dashboard')) { try { DB.flushRegistrationOutbox(); } catch (_) {} } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(1500); });
  window.ChurchDB = DB;
})();
