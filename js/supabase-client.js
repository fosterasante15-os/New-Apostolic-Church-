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
    activity: 'church-activity-v1',
    users: 'church-reconstruction-users-v1',
    userProfiles: 'church-profiles-v1'
  };

  const TOMBSTONE_KEY = 'church-tombstones-v1';
  const TOMBSTONE_META_KEY = 'church-tombstone-meta-v1';
  const UNSYNCED_KEY = 'church-unsynced-v1';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function purgeStaleSupabaseTokens() {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && /^sb-.*-auth-token$/.test(k)) {
          localStorage.removeItem(k);
        }
      }
    } catch (_) {}
  }

  // On startup, inspect any cached sb-*-auth-token and remove if malformed or already expired without a valid cloud session
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && /^sb-.*-auth-token$/.test(k)) {
        const raw = localStorage.getItem(k);
        const parsed = raw ? JSON.parse(raw) : null;
        const exp = parsed?.expires_at || parsed?.currentSession?.expires_at;
        if (!parsed || (exp && Number(exp) * (Number(exp) < 1e12 ? 1000 : 1) <= Date.now())) {
          const sessRaw = sessionStorage.getItem('church-auth-v1');
          const sess = sessRaw ? JSON.parse(sessRaw) : null;
          if (!sess || !sess.isCloud) {
            localStorage.removeItem(k);
          }
        }
      }
    }
  } catch (_) {
    purgeStaleSupabaseTokens();
  }

  async function withRetry(operation, options = {}) {
    const retries = Number.isInteger(options.retries) ? options.retries : 2;
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 8000;
    const delayMs = Number.isFinite(options.delayMs) && options.delayMs >= 0 ? options.delayMs : 60;
    let lastError = null;
    let lastResult = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      let timerId = null;
      try {
        const timeoutPromise = new Promise((_, reject) => {
          timerId = setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
        });
        const res = await Promise.race([Promise.resolve().then(() => operation()), timeoutPromise]);
        if (timerId) clearTimeout(timerId);
        lastResult = res;
        if (res && res.error) {
          const msg = String(res.error.message || res.error || '');
          const code = String(res.error.code || '');
          const status = Number(res.error.status || res.status || 0);
          const isAuthExpired = status === 401 || code === 'PGRST301' || /jwt expired|invalid jwt|refresh_token_not_found/i.test(msg);
          if (isAuthExpired) {
            purgeStaleSupabaseTokens();
            try { await client?.auth?.signOut?.(); } catch (_) {}
            if (attempt < retries) {
              await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
              continue;
            }
          }
          const isTransient = status === 408 || status === 429 || status >= 500 || /network|fetch|timeout|timed out|connection|offline/i.test(msg);
          if (isTransient && attempt < retries) {
            await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
            continue;
          }
        }
        return res;
      } catch (err) {
        if (timerId) clearTimeout(timerId);
        lastError = err;
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
          continue;
        }
      }
    }
    if (lastResult !== null) return lastResult;
    throw lastError || new Error('Network request failed after retries.');
  }

  function markUnsynced(table, ids) {
    if (!table) return;
    try {
      const all = readJson(UNSYNCED_KEY, {});
      const list = new Set(Array.isArray(all[table]) ? all[table] : []);
      (Array.isArray(ids) ? ids : [ids]).filter(Boolean).forEach(id => list.add(String(id)));
      all[table] = [...list];
      rawSetItem(UNSYNCED_KEY, JSON.stringify(all));
    } catch (_) {}
  }

  function clearUnsynced(table, ids) {
    if (!table) return;
    try {
      const all = readJson(UNSYNCED_KEY, {});
      if (!Array.isArray(all[table])) return;
      if (!ids) {
        delete all[table];
      } else {
        const removeSet = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
        all[table] = all[table].filter(id => !removeSet.has(String(id)));
        if (!all[table].length) delete all[table];
      }
      rawSetItem(UNSYNCED_KEY, JSON.stringify(all));
    } catch (_) {}
  }

  function buildMembersPayload(list, tSet) {
    return (Array.isArray(list) ? list : []).filter(m => m && m.id && !tSet.has(m.id)).map(m => ({
      id: m.id,
      name: m.name,
      email: m.email || '',
      phone: m.phone || '',
      dob: m.dob || '',
      place: m.place || '',
      department: m.department || '',
      departments: Array.isArray(m.departments) ? m.departments : (m.department ? [m.department] : []),
      joined: m.joined || '',
      status: m.status || 'Active',
      photo: m.photo || '',
      updated_at: m.updated_at || new Date().toISOString()
    }));
  }

  function buildMinistersPayload(list, tSet) {
    return (Array.isArray(list) ? list : []).filter(m => m && m.id && !tSet.has(m.id)).map(m => ({
      id: m.id,
      name: m.name,
      role: m.role || '',
      bio: m.note || m.bio || '',
      photo: m.photo || '',
      display_order: Number(m.order ?? m.display_order) || 0
    }));
  }

  async function upsertAnnouncementsToCloud(list, tSet) {
    const valid = (Array.isArray(list) ? list : []).filter(a => a && a.id && !tSet.has(a.id));
    if (!valid.length) return { error: null };
    const primaryPayload = valid.map(a => ({
      id: a.id,
      title: a.title,
      content: a.content || '',
      category: a.status || a.category || 'draft',
      date: a.date || '',
      audience: JSON.stringify({
        status: a.status || 'draft',
        smsStatus: a.smsStatus || a.sms_status || 'not-sent',
        smsCount: Number(a.smsCount ?? a.sms_count) || 0,
        smsAt: a.smsAt || a.sms_at || null
      })
    }));
    const res = await withRetry(() => client.from('announcements').upsert(primaryPayload));
    if (res?.error && /column .* does not exist|PGRST204/i.test(String(res.error.message || res.error.code || ''))) {
      const fallbackPayload = valid.map(a => ({
        id: a.id,
        title: a.title,
        content: a.content || '',
        status: a.status || 'draft',
        date: a.date || '',
        sms_status: a.smsStatus || a.sms_status || 'not-sent',
        sms_count: Number(a.smsCount ?? a.sms_count) || 0,
        sms_at: a.smsAt || a.sms_at || null
      }));
      return await withRetry(() => client.from('announcements').upsert(fallbackPayload));
    }
    return res;
  }

  async function syncUserProfilesToCloud(userProfilesObj, usersArr) {
    if (!client) return;
    const safeProfiles = (userProfilesObj && typeof userProfilesObj === 'object' && !Array.isArray(userProfilesObj))
      ? { ...userProfilesObj }
      : {};
    const users = Array.isArray(usersArr) ? usersArr : readJson(STORES.users, []);
    const latestTombstones = readJson(TOMBSTONE_KEY, {});
    const tSet = new Set(latestTombstones.profiles || []);
    const uuidPayload = [];

    if (Array.isArray(users)) {
      users.forEach(u => {
        if (!u || (!u.id && !u.email)) return;
        if (tSet.has(String(u.id)) || tSet.has(u.email)) return;
        const emailKey = String(u.email || '').toLowerCase();
        const byId = u.id ? safeProfiles[u.id] : null;
        const byEmail = emailKey ? safeProfiles[emailKey] : null;
        const resolvedName = byId?.name || byEmail?.name || u.name || (emailKey ? emailKey.split('@')[0] : 'User');
        const resolvedPhoto = byId?.photo || byEmail?.photo || u.photo || '';
        if (resolvedPhoto || resolvedName) {
          const entry = { name: resolvedName, photo: resolvedPhoto, email: emailKey };
          if (u.id) safeProfiles[u.id] = { ...(safeProfiles[u.id] || {}), ...entry };
          if (emailKey) safeProfiles[emailKey] = { ...(safeProfiles[emailKey] || {}), ...entry };
        }
        if (u.id && UUID_RE.test(String(u.id)) && u.isCloud) {
          uuidPayload.push({
            id: String(u.id),
            email: u.email,
            name: resolvedName,
            role: u.role || 'member',
            status: u.status || 'Active',
            photo_url: resolvedPhoto
          });
        }
      });
    }

    // 1. Always persist full userProfiles map (including local/main admins) in church_settings ('user_profiles')
    const setRes = await withRetry(() => client.from('church_settings').upsert({
      key: 'user_profiles',
      value: safeProfiles,
      updated_at: new Date().toISOString()
    }));
    if (!setRes?.error) {
      clearUnsynced('user_profiles');
    }

    // 2. Also sync valid cloud UUID users to public.profiles
    if (uuidPayload.length > 0) {
      const pRes = await withRetry(() => client.from('profiles').upsert(uuidPayload));
      if (pRes?.error && /photo_url|PGRST204/i.test(String(pRes.error.message || pRes.error.code || ''))) {
        const stripped = uuidPayload.map(({ photo_url, ...rest }) => rest);
        await withRetry(() => client.from('profiles').upsert(stripped));
      }
    }
  }

  const DB = {
    client,
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    isConnected: false,
    isSyncing: false,
    withRetry,

    // ----------------------------------------------------
    // AUTHENTICATION
    // ----------------------------------------------------
    async signIn(email, password) {
      if (!client) throw new Error('Supabase client is not available.');
      const res = await withRetry(() => client.auth.signInWithPassword({ email, password }));
      if (res.error) throw res.error;
      return res.data;
    },

    async signUp(email, password, metadata = {}) {
      if (!client) throw new Error('Supabase client is not available.');
      const res = await withRetry(() => client.auth.signUp({
        email,
        password,
        options: {
          data: metadata
        }
      }));
      if (res.error) throw res.error;
      return res.data;
    },

    async signOut() {
      if (!client) return;
      try { await client.auth.signOut(); } catch (_) {}
      purgeStaleSupabaseTokens();
    },

    async getSession() {
      if (!client) return null;
      const purgeStaleAuthTokens = () => {
        try { sessionStorage.removeItem('church-auth-v1'); } catch (_) {}
        purgeStaleSupabaseTokens();
      };
      try {
        const res = await withRetry(() => client.auth.getSession(), { retries: 1, timeoutMs: 5000 });
        if (res?.error) {
          const msg = String(res.error.message || '');
          if (/refresh_token|refresh token|expired|invalid|jwt/i.test(msg)) {
            purgeStaleAuthTokens();
            try { await client.auth.signOut(); } catch (_) {}
          }
          return null;
        }
        const session = res?.data?.session || null;
        if (!session) return null;
        if (session.expires_at) {
          const expMs = typeof session.expires_at === 'number' && session.expires_at < 1e12
            ? session.expires_at * 1000
            : Number(new Date(session.expires_at).getTime());
          if (!Number.isNaN(expMs) && expMs <= Date.now()) {
            if (typeof client.auth.refreshSession === 'function') {
              try {
                const refreshed = await client.auth.refreshSession();
                if (!refreshed?.error && refreshed?.data?.session) {
                  return refreshed.data.session;
                }
              } catch (_) {}
            }
            purgeStaleAuthTokens();
            try { await client.auth.signOut(); } catch (_) {}
            return null;
          }
        }
        return session;
      } catch (_) {
        purgeStaleAuthTokens();
        try { await client.auth.signOut(); } catch (_) {}
        return null;
      }
    },

    // ----------------------------------------------------
    // DELETIONS & TOMBSTONES
    // ----------------------------------------------------
    unmarkTombstone(table, id) {
      if (!table || !id) return;
      try {
        const tombstones = readJson(TOMBSTONE_KEY, {});
        if (Array.isArray(tombstones[table])) {
          const next = tombstones[table].filter(x => x !== id);
          if (next.length !== tombstones[table].length) {
            tombstones[table] = next;
            rawSetItem(TOMBSTONE_KEY, JSON.stringify(tombstones));
          }
        }
        const meta = readJson(TOMBSTONE_META_KEY, {});
        if (meta && meta[table] && typeof meta[table] === 'object' && id in meta[table]) {
          delete meta[table][id];
          rawSetItem(TOMBSTONE_META_KEY, JSON.stringify(meta));
        }
      } catch (_) {}
    },

    async deleteItem(table, id) {
      if (!id) return false;
      try {
        const tombstones = readJson(TOMBSTONE_KEY, {});
        tombstones[table] = Array.isArray(tombstones[table]) ? tombstones[table] : [];
        if (!tombstones[table].includes(id)) {
          tombstones[table].push(id);
          rawSetItem(TOMBSTONE_KEY, JSON.stringify(tombstones));
        }
        const meta = readJson(TOMBSTONE_META_KEY, {});
        meta[table] = (meta[table] && typeof meta[table] === 'object') ? meta[table] : {};
        meta[table][id] = Date.now();
        rawSetItem(TOMBSTONE_META_KEY, JSON.stringify(meta));
        clearUnsynced(table, id);
      } catch (_) {}

      if (client) {
        try {
          const res = await withRetry(() => client.from(table).delete().eq('id', id));
          const error = res?.error;
          if (error) console.warn(`[Supabase Delete Warning] ${table} (${id}):`, error.message);
          return !error;
        } catch (err) {
          console.warn(`[Supabase Delete Error] ${table} (${id}):`, err);
          return false;
        }
      }
      return true;
    },

    // ----------------------------------------------------
    // TEST CONNECTION
    // ----------------------------------------------------
    async testConnection() {
      if (!client) return { ok: false, error: 'Supabase client not loaded' };
      try {
        const res = await withRetry(() => client.from('members').select('id').limit(1), { retries: 2, timeoutMs: 6000 });
        const { data, error } = res || {};
        if (error) {
          this.isConnected = false;
          return { ok: false, error: error.message || String(error) };
        }
        this.isConnected = true;
        return { ok: true, data };
      } catch (err) {
        this.isConnected = false;
        return { ok: false, error: err.message || 'Network error' };
      }
    },

    // ----------------------------------------------------
    // PULL CLOUD DATA INTO LOCALSTORAGE
    // ----------------------------------------------------
    isPulling: false,
    isInternalWrite: false,

    // ----------------------------------------------------
    // BIDIRECTIONAL CLOUD SYNC & RECONCILIATION
    // ----------------------------------------------------
    async pullAllFromCloud(silent = false) {
      if (!client || this.isPulling) return false;
      this.isPulling = true;
      try {
        // Flush any pending local debounced writes AND wait for in-flight upserts so cloud has latest state before pulling
        await flushPendingSyncs();

        // Snapshot local IDs before the async network fetch so we can detect mid-pull local additions
        const snapshotIds = (storeKey) => {
          const arr = readJson(storeKey, []);
          return new Set((Array.isArray(arr) ? arr : []).map(x => x?.id || x?.name).filter(Boolean));
        };
        const prePullIds = {
          members: snapshotIds(STORES.members),
          departments: snapshotIds(STORES.departments),
          services: snapshotIds(STORES.services),
          churchDues: snapshotIds(STORES.churchDues),
          ministryDues: snapshotIds(STORES.ministryDues),
          offerings: snapshotIds(STORES.offerings),
          thanksgiving: snapshotIds(STORES.thanksgiving),
          ministers: snapshotIds(STORES.ministers),
          announcements: snapshotIds(STORES.announcements)
        };
        const unsyncedAll = readJson(UNSYNCED_KEY, {});
        const preserveMidPull = (storeKey, tableKey, clean, tSet, preSet) => {
          const localNow = readJson(storeKey, []);
          if (!Array.isArray(localNow)) return [];
          const unsyncedSet = new Set(Array.isArray(unsyncedAll[tableKey]) ? unsyncedAll[tableKey].map(String) : []);
          const seen = new Set(clean.map(x => x?.id || x?.name).filter(Boolean));
          const preserved = [];
          localNow.forEach(item => {
            const key = item?.id || item?.name;
            if (!key || seen.has(key) || tSet.has(key)) return;
            if (!preSet.has(key) || unsyncedSet.has(String(key))) {
              seen.add(key);
              clean.push(item);
              preserved.push(item);
            }
          });
          return preserved;
        };

        // Parallel fetch of all cloud tables with retry/timeout protection
        const [
          mRes, dRes, sRes, cdRes, mdRes, oRes, tRes, aRes, minRes, annRes, setRes, upRes, pRes
        ] = await Promise.allSettled([
          withRetry(() => client.from('members').select('*').order('id', { ascending: true })),
          withRetry(() => client.from('departments').select('*').order('name', { ascending: true })),
          withRetry(() => client.from('services').select('*').order('date', { ascending: true })),
          withRetry(() => client.from('church_dues').select('*').order('created_at', { ascending: false })),
          withRetry(() => client.from('ministry_dues').select('*').order('created_at', { ascending: false })),
          withRetry(() => client.from('offerings').select('*').order('date', { ascending: false })),
          withRetry(() => client.from('thanksgiving').select('*').order('date', { ascending: false })),
          withRetry(() => client.from('attendance').select('*')),
          withRetry(() => client.from('ministers').select('*').order('display_order', { ascending: true })),
          withRetry(() => client.from('announcements').select('*').order('created_at', { ascending: false })),
          withRetry(() => client.from('church_settings').select('*').eq('key', 'general').maybeSingle()),
          withRetry(() => client.from('church_settings').select('*').eq('key', 'user_profiles').maybeSingle()),
          withRetry(() => client.from('profiles').select('*').order('created_at', { ascending: false }))
        ]);

        const tombstones = readJson(TOMBSTONE_KEY, {});
        const tombstoneMeta = readJson(TOMBSTONE_META_KEY, {});
        const isRecreatedInCloud = (table, item) => {
          if (!item || !item.id) return false;
          const deletedAt = tombstoneMeta?.[table]?.[item.id];
          const stamp = item.updated_at || item.created_at;
          const updatedAtMs = stamp ? Date.parse(stamp) : NaN;
          if (deletedAt && !Number.isNaN(updatedAtMs) && updatedAtMs > deletedAt + 1000) {
            return true;
          }
          if (!deletedAt && ((typeof item.photo === 'string' && item.photo.startsWith('data:image/')) || !Number.isNaN(updatedAtMs))) {
            return true;
          }
          return false;
        };

        const backgroundPushTasks = [];
        this.isInternalWrite = true;

        // 1. MEMBERS
        if (mRes.status === 'fulfilled' && mRes.value && !mRes.value.error && Array.isArray(mRes.value.data)) {
          const tSet = new Set(tombstones.members || []);
          const localNow = readJson(STORES.members, []);
          const localMap = new Map((Array.isArray(localNow) ? localNow : []).filter(m => m && m.id).map(m => [m.id, m]));
          const toDelete = [];
          const toPushMembers = [];
          const clean = [];
          const seenIds = new Set();

          mRes.value.data.forEach(m => {
            if (!m || !m.id) return;
            if (tSet.has(m.id)) {
              if (isRecreatedInCloud('members', m)) {
                this.unmarkTombstone('members', m.id);
                tSet.delete(m.id);
              } else {
                toDelete.push(m.id);
                return;
              }
            }
            const localItem = localMap.get(m.id);
            const cloudPhoto = m.photo || '';
            const localPhoto = localItem?.photo || '';
            const localNewer = localItem?.updated_at && m.updated_at && Date.parse(localItem.updated_at) > Date.parse(m.updated_at);
            const resolvedPhoto = (localNewer && localPhoto) ? localPhoto : (cloudPhoto || localPhoto || '');
            seenIds.add(m.id);
            const mergedMember = {
              id: m.id,
              name: (localNewer && localItem?.name) ? localItem.name : m.name,
              email: m.email || localItem?.email || '',
              phone: m.phone || localItem?.phone || '',
              dob: m.dob || localItem?.dob || '',
              notes: m.notes || localItem?.notes || '',
              place: m.place || localItem?.place || '',
              department: m.department || localItem?.department || '',
              departments: Array.isArray(m.departments) && m.departments.length
                ? m.departments
                : (m.department ? String(m.department).split(/\s*,\s*/).filter(Boolean) : (Array.isArray(localItem?.departments) ? localItem.departments : [])),
              joined: m.joined || localItem?.joined || '',
              status: m.status || localItem?.status || 'Active',
              photo: resolvedPhoto,
              updated_at: (localNewer && localItem?.updated_at) ? localItem.updated_at : (m.updated_at || localItem?.updated_at || '')
            };
            clean.push(mergedMember);
            if (resolvedPhoto && resolvedPhoto !== cloudPhoto) {
              toPushMembers.push(mergedMember);
            }
          });

          // Preserve any local members created mid-pull or marked unsynced
          const preserved = preserveMidPull(STORES.members, 'members', clean, tSet, prePullIds.members);
          preserved.forEach(item => toPushMembers.push(item));

          if (toDelete.length > 0) {
            client.from('members').delete().in('id', toDelete).catch(() => {});
          }
          if (toPushMembers.length > 0) {
            const payload = buildMembersPayload(toPushMembers, tSet);
            if (payload.length) {
              backgroundPushTasks.push(withRetry(() => client.from('members').upsert(payload)).then(r => {
                if (!r?.error) clearUnsynced('members', payload.map(x => x.id));
              }).catch(() => {}));
            }
          }
          rawSetItem(STORES.members, JSON.stringify(clean));
          window.churchMembers = clean;
        }

        // 2. DEPARTMENTS
        if (dRes.status === 'fulfilled' && dRes.value && !dRes.value.error && Array.isArray(dRes.value.data)) {
          const tSet = new Set(tombstones.departments || []);
          const toDelete = [];
          const clean = [];
          dRes.value.data.forEach(d => {
            if (!d || !(d.id || d.name)) return;
            const key = d.id || d.name;
            if (tSet.has(key) || (d.name && tSet.has(d.name))) {
              toDelete.push(key);
            } else {
              clean.push({
                id: d.id,
                name: d.name,
                description: d.description || ''
              });
            }
          });
          preserveMidPull(STORES.departments, 'departments', clean, tSet, prePullIds.departments);
          if (toDelete.length > 0) {
            client.from('departments').delete().in('id', toDelete).catch(() => {});
          }
          rawSetItem(STORES.departments, JSON.stringify(clean));
          window.churchDepartments = clean;
        }

        // 3. SERVICES
        if (sRes.status === 'fulfilled' && sRes.value && !sRes.value.error && Array.isArray(sRes.value.data)) {
          const tSet = new Set(tombstones.services || []);
          const toDelete = [];
          const clean = [];
          sRes.value.data.forEach(s => {
            if (!s || !s.id) return;
            if (tSet.has(s.id)) {
              toDelete.push(s.id);
            } else {
              clean.push({
                id: s.id,
                date: s.date,
                time: s.time || '09:00',
                venue: s.venue || 'Main Auditorium',
                description: s.description || ''
              });
            }
          });
          preserveMidPull(STORES.services, 'services', clean, tSet, prePullIds.services);
          if (toDelete.length > 0) {
            client.from('services').delete().in('id', toDelete).catch(() => {});
          }
          rawSetItem(STORES.services, JSON.stringify(clean));
          window.churchServices = clean;
        }

        // 4. CHURCH GENERAL DUES
        if (cdRes.status === 'fulfilled' && cdRes.value && !cdRes.value.error && Array.isArray(cdRes.value.data)) {
          const tSet = new Set(tombstones.church_dues || []);
          const toDelete = [];
          const clean = [];
          cdRes.value.data.forEach(d => {
            if (!d || !d.id) return;
            if (tSet.has(d.id)) {
              toDelete.push(d.id);
            } else {
              clean.push({
                id: d.id,
                memberId: d.member_id,
                memberName: d.member_name,
                department: d.department,
                amount: Number(d.amount || 0),
                month: d.month,
                paidOn: d.paid_on,
                method: d.method,
                txnId: d.txn_id,
                recordedBy: d.recorded_by
              });
            }
          });
          preserveMidPull(STORES.churchDues, 'church_dues', clean, tSet, prePullIds.churchDues);
          if (toDelete.length > 0) {
            client.from('church_dues').delete().in('id', toDelete).catch(() => {});
          }
          rawSetItem(STORES.churchDues, JSON.stringify(clean));
        }

        // 5. MINISTRY DUES
        if (mdRes.status === 'fulfilled' && mdRes.value && !mdRes.value.error && Array.isArray(mdRes.value.data)) {
          const tSet = new Set(tombstones.ministry_dues || []);
          const toDelete = [];
          const clean = [];
          mdRes.value.data.forEach(d => {
            if (!d || !d.id) return;
            if (tSet.has(d.id)) {
              toDelete.push(d.id);
            } else {
              clean.push({
                id: d.id,
                memberId: d.member_id,
                memberName: d.member_name,
                department: d.department,
                amount: Number(d.amount || 0),
                month: d.month,
                paidOn: d.paid_on,
                method: d.method,
                txnId: d.txn_id,
                recordedBy: d.recorded_by
              });
            }
          });
          preserveMidPull(STORES.ministryDues, 'ministry_dues', clean, tSet, prePullIds.ministryDues);
          if (toDelete.length > 0) {
            client.from('ministry_dues').delete().in('id', toDelete).catch(() => {});
          }
          rawSetItem(STORES.ministryDues, JSON.stringify(clean));
        }

        // 6. OFFERINGS
        if (oRes.status === 'fulfilled' && oRes.value && !oRes.value.error && Array.isArray(oRes.value.data)) {
          const tSet = new Set(tombstones.offerings || []);
          const toDelete = [];
          const clean = [];
          oRes.value.data.forEach(o => {
            if (!o || !o.id) return;
            if (tSet.has(o.id)) {
              toDelete.push(o.id);
            } else {
              clean.push({
                id: o.id,
                date: o.date,
                amount: Number(o.amount || 0),
                serviceId: o.service_id,
                notes: o.notes || '',
                note: o.notes || '',
                recordedBy: o.recorded_by
              });
            }
          });
          preserveMidPull(STORES.offerings, 'offerings', clean, tSet, prePullIds.offerings);
          if (toDelete.length > 0) {
            client.from('offerings').delete().in('id', toDelete).catch(() => {});
          }
          rawSetItem(STORES.offerings, JSON.stringify(clean));
        }

        // 7. THANKSGIVING
        if (tRes.status === 'fulfilled' && tRes.value && !tRes.value.error && Array.isArray(tRes.value.data)) {
          const tSet = new Set(tombstones.thanksgiving || []);
          const toDelete = [];
          const clean = [];
          tRes.value.data.forEach(t => {
            if (!t || !t.id) return;
            if (tSet.has(t.id)) {
              toDelete.push(t.id);
            } else {
              clean.push({
                id: t.id,
                date: t.date,
                amount: Number(t.amount || 0),
                giver: t.giver || t.member_name || '',
                memberName: t.giver || t.member_name || '',
                location: t.location || '',
                note: t.note || t.notes || '',
                notes: t.note || t.notes || '',
                recordedBy: t.recorded_by || null
              });
            }
          });
          preserveMidPull(STORES.thanksgiving, 'thanksgiving', clean, tSet, prePullIds.thanksgiving);
          if (toDelete.length > 0) {
            client.from('thanksgiving').delete().in('id', toDelete).catch(() => {});
          }
          rawSetItem(STORES.thanksgiving, JSON.stringify(clean));
        }

        // 8. ATTENDANCE
        if (aRes.status === 'fulfilled' && aRes.value && !aRes.value.error && Array.isArray(aRes.value.data)) {
          const tSet = new Set(tombstones.attendance || []);
          const merged = {};
          aRes.value.data.forEach(row => {
            if (row && row.id && !tSet.has(row.id)) {
              merged[row.id] = row.records && typeof row.records === 'object' && !Array.isArray(row.records) ? row.records : {};
            }
          });
          rawSetItem(STORES.attendance, JSON.stringify(merged));
        }

        // 9. MINISTERS
        if (minRes.status === 'fulfilled' && minRes.value && !minRes.value.error && Array.isArray(minRes.value.data)) {
          const tSet = new Set(tombstones.ministers || []);
          const localNow = readJson(STORES.ministers, []);
          const localMap = new Map((Array.isArray(localNow) ? localNow : []).filter(m => m && m.id).map(m => [m.id, m]));
          const toDelete = [];
          const toPushMinisters = [];
          const clean = [];
          const seenIds = new Set();

          minRes.value.data.forEach(m => {
            if (!m || !m.id) return;
            if (tSet.has(m.id)) {
              if (isRecreatedInCloud('ministers', m)) {
                this.unmarkTombstone('ministers', m.id);
                tSet.delete(m.id);
              } else {
                toDelete.push(m.id);
                return;
              }
            }
            const localItem = localMap.get(m.id);
            const cloudPhoto = m.photo || '';
            const localPhoto = localItem?.photo || '';
            const localNewer = localItem?.updated_at && m.updated_at && Date.parse(localItem.updated_at) > Date.parse(m.updated_at);
            const resolvedPhoto = (localNewer && localPhoto) ? localPhoto : (cloudPhoto || localPhoto || '');
            seenIds.add(m.id);
            const mergedMinister = {
              id: m.id,
              name: (localNewer && localItem?.name) ? localItem.name : m.name,
              role: m.role || localItem?.role || '',
              note: m.note || m.bio || localItem?.note || '',
              photo: resolvedPhoto,
              order: Number(m.display_order ?? m.order ?? localItem?.order) || 0,
              updated_at: m.updated_at || localItem?.updated_at || ''
            };
            clean.push(mergedMinister);
            if (resolvedPhoto && resolvedPhoto !== cloudPhoto) {
              toPushMinisters.push(mergedMinister);
            }
          });

          // Preserve local ministers created mid-pull, marked unsynced, or when cloud table is empty but laptop has ministers
          const preserved = preserveMidPull(STORES.ministers, 'ministers', clean, tSet, prePullIds.ministers);
          preserved.forEach(item => toPushMinisters.push(item));

          if (minRes.value.data.length === 0 && Array.isArray(localNow) && localNow.length > 0) {
            const seen = new Set(clean.map(x => x?.id).filter(Boolean));
            localNow.forEach(item => {
              if (item && item.id && !tSet.has(item.id) && !seen.has(item.id)) {
                seen.add(item.id);
                clean.push(item);
                toPushMinisters.push(item);
              }
            });
          }

          if (toDelete.length > 0) {
            client.from('ministers').delete().in('id', toDelete).catch(() => {});
          }
          if (toPushMinisters.length > 0) {
            const payload = buildMinistersPayload(toPushMinisters, tSet);
            if (payload.length) {
              backgroundPushTasks.push(withRetry(() => client.from('ministers').upsert(payload)).then(r => {
                if (!r?.error) clearUnsynced('ministers', payload.map(x => x.id));
              }).catch(() => {}));
            }
          }
          rawSetItem(STORES.ministers, JSON.stringify(clean));
          window.churchMinisters = clean;
        }

        // 10. ANNOUNCEMENTS
        if (annRes.status === 'fulfilled' && annRes.value && !annRes.value.error && Array.isArray(annRes.value.data)) {
          const tSet = new Set(tombstones.announcements || []);
          const toDelete = [];
          const clean = [];
          annRes.value.data.forEach(a => {
            if (!a || !a.id) return;
            if (tSet.has(a.id)) {
              toDelete.push(a.id);
            } else {
              let meta = {};
              if (typeof a.audience === 'string' && a.audience.trim().startsWith('{')) {
                try { meta = JSON.parse(a.audience) || {}; } catch (_) {}
              }
              clean.push({
                id: a.id,
                title: a.title,
                content: a.content || '',
                status: a.status || meta.status || a.category || 'draft',
                date: a.date || '',
                smsStatus: a.sms_status || a.smsStatus || meta.smsStatus || 'not-sent',
                smsCount: Number(a.sms_count ?? a.smsCount ?? meta.smsCount) || 0,
                smsAt: a.sms_at || a.smsAt || meta.smsAt || null
              });
            }
          });
          preserveMidPull(STORES.announcements, 'announcements', clean, tSet, prePullIds.announcements);
          if (toDelete.length > 0) {
            client.from('announcements').delete().in('id', toDelete).catch(() => {});
          }
          rawSetItem(STORES.announcements, JSON.stringify(clean));
        }

        // 11. SETTINGS
        if (setRes.status === 'fulfilled' && setRes.value && !setRes.value.error) {
          const cloudSettings = setRes.value.data?.value;
          const localSettings = readJson(STORES.settings, null);
          if (cloudSettings && typeof cloudSettings === 'object') {
            let needsPush = false;
            if (!cloudSettings.logo && localSettings?.logo) {
              cloudSettings.logo = localSettings.logo;
              needsPush = true;
            }
            rawSetItem(STORES.settings, JSON.stringify(cloudSettings));
            if (needsPush) {
              backgroundPushTasks.push(withRetry(() => client.from('church_settings').upsert({
                key: 'general',
                value: cloudSettings,
                updated_at: new Date().toISOString()
              })).catch(() => {}));
            }
          } else if (!setRes.value.data && localSettings && typeof localSettings === 'object') {
            // Cloud has no 'general' settings row yet, but laptop has local settings/logo — push to cloud
            backgroundPushTasks.push(withRetry(() => client.from('church_settings').upsert({
              key: 'general',
              value: localSettings,
              updated_at: new Date().toISOString()
            })).catch(() => {}));
          }
        }

        // 12. PROFILES / USERS & USER AVATAR PROFILES
        const localUsers = readJson(STORES.users, []);
        const existingMap = new Map((Array.isArray(localUsers) ? localUsers : []).filter(u => u && u.email).map(u => [String(u.email).toLowerCase(), u]));
        const localProfiles = readJson(STORES.userProfiles, {});
        const safeProfiles = (localProfiles && typeof localProfiles === 'object' && !Array.isArray(localProfiles)) ? { ...localProfiles } : {};
        let cloudUserProfiles = null;

        if (upRes.status === 'fulfilled' && upRes.value && !upRes.value.error && upRes.value.data && upRes.value.data.value) {
          const val = upRes.value.data.value;
          const keyMatches = !upRes.value.data.key || upRes.value.data.key === 'user_profiles';
          if (keyMatches && val && typeof val === 'object' && !Array.isArray(val) && !('values' in val && 'logo' in val)) {
            cloudUserProfiles = val;
            Object.entries(val).forEach(([k, prof]) => {
              if (!prof || typeof prof !== 'object') return;
              const prev = safeProfiles[k] && typeof safeProfiles[k] === 'object' ? safeProfiles[k] : {};
              safeProfiles[k] = {
                ...prev,
                ...prof,
                name: prof.name || prev.name || '',
                photo: prof.photo || prev.photo || '',
                email: prof.email || prev.email || ''
              };
            });
          }
        }

        if (pRes.status === 'fulfilled' && pRes.value && !pRes.value.error && Array.isArray(pRes.value.data)) {
          const tSet = new Set(tombstones.profiles || []);
          pRes.value.data.forEach(p => {
            if (!p || tSet.has(p.id) || tSet.has(p.email)) return;
            const emailKey = String(p.email || '').toLowerCase();
            const existing = existingMap.get(emailKey);
            const resolvedName = p.name || safeProfiles[p.id]?.name || (emailKey ? safeProfiles[emailKey]?.name : '') || existing?.name || String(p.email || '').split('@')[0];
            const resolvedPhoto = p.photo_url || p.photo || safeProfiles[p.id]?.photo || (emailKey ? safeProfiles[emailKey]?.photo : '') || existing?.photo || '';
            existingMap.set(emailKey, {
              id: p.id,
              email: p.email,
              name: resolvedName,
              role: p.role || existing?.role || 'member',
              status: p.status || existing?.status || 'Pending',
              lastLogin: p.last_login || existing?.lastLogin || '—',
              photo: resolvedPhoto,
              isCloud: true
            });
            if (resolvedPhoto || p.name) {
              const profEntry = { name: resolvedName, photo: resolvedPhoto, email: emailKey };
              if (p.id) safeProfiles[p.id] = { ...(safeProfiles[p.id] || {}), ...profEntry };
              if (emailKey) safeProfiles[emailKey] = { ...(safeProfiles[emailKey] || {}), ...profEntry };
            }
          });
        }

        // Cross-link safeProfiles with localUsers so id and email keys both carry photo & name
        existingMap.forEach((u, emailKey) => {
          const byId = u.id ? safeProfiles[u.id] : null;
          const byEmail = emailKey ? safeProfiles[emailKey] : null;
          const photo = byId?.photo || byEmail?.photo || u.photo || '';
          const name = byId?.name || byEmail?.name || u.name || '';
          if (photo && !u.photo) u.photo = photo;
          if (photo || byId || byEmail) {
            const merged = { name: name || u.name || '', photo, email: emailKey };
            if (u.id) safeProfiles[u.id] = { ...(safeProfiles[u.id] || {}), ...merged };
            if (emailKey) safeProfiles[emailKey] = { ...(safeProfiles[emailKey] || {}), ...merged };
          }
        });

        rawSetItem(STORES.users, JSON.stringify([...existingMap.values()]));
        rawSetItem(STORES.userProfiles, JSON.stringify(safeProfiles));

        // If local userProfiles has photos not yet stored in cloudUserProfiles, push them to cloud
        const hasLocalProfilePhotos = Object.values(safeProfiles).some(p => p && typeof p === 'object' && p.photo);
        const cloudMissingProfilePhoto = hasLocalProfilePhotos && (!cloudUserProfiles || Object.entries(safeProfiles).some(([k, p]) => p?.photo && cloudUserProfiles[k]?.photo !== p.photo));
        if (cloudMissingProfilePhoto) {
          backgroundPushTasks.push(syncUserProfilesToCloud(safeProfiles, [...existingMap.values()]).catch(() => {}));
        }

        this.isConnected = true;

        if (!silent && window.notify) {
          window.notify('Synchronized with Supabase cloud database.', 'success', 'Cloud Synchronized');
        }

        // Dispatch events so every page module immediately reflects cloud data
        window.dispatchEvent(new CustomEvent('members-change', { detail: readJson(STORES.members, []) }));
        window.dispatchEvent(new CustomEvent('departments-change', { detail: readJson(STORES.departments, []).map(d => d?.name || d).filter(Boolean) }));
        window.dispatchEvent(new CustomEvent('services-change', { detail: readJson(STORES.services, []) }));
        window.dispatchEvent(new CustomEvent('dues-change'));
        window.dispatchEvent(new CustomEvent('offerings-change'));
        window.dispatchEvent(new CustomEvent('ministers-change'));
        window.dispatchEvent(new CustomEvent('announcements-change'));
        window.dispatchEvent(new CustomEvent('attendance-change'));
        window.dispatchEvent(new CustomEvent('users-change'));
        window.dispatchEvent(new CustomEvent('profiles-change'));
        window.dispatchEvent(new CustomEvent('church-profile-change'));

        if (backgroundPushTasks.length) {
          Promise.allSettled(backgroundPushTasks).catch(() => {});
        }

        return true;
      } catch (err) {
        console.warn('[Supabase Sync Error]', err);
        return false;
      } finally {
        this.isPulling = false;
        this.isInternalWrite = false;
      }
    },

    // Manual bulk push if requested
    async pushAllToCloud() {
      if (!client) {
        if (typeof window.notify === 'function') window.notify('Supabase client is not loaded.', 'error');
        return false;
      }
      this.isSyncing = true;
      try {
        await flushPendingSyncs();
        const tombstones = readJson(TOMBSTONE_KEY, {});
        const tasks = [];

        const members = readJson(STORES.members, []);
        if (Array.isArray(members) && members.length) {
          const payload = buildMembersPayload(members, new Set(tombstones.members || []));
          if (payload.length) tasks.push(withRetry(() => client.from('members').upsert(payload)));
        }

        const departments = readJson(STORES.departments, []);
        if (Array.isArray(departments) && departments.length) {
          const tSet = new Set(tombstones.departments || []);
          const payload = departments.filter(d => d && (d.id || d.name) && !tSet.has(d.id) && !tSet.has(d.name)).map(d => ({
            id: d.id || d.name,
            name: d.name,
            description: d.description || ''
          }));
          if (payload.length) tasks.push(withRetry(() => client.from('departments').upsert(payload)));
        }

        const services = readJson(STORES.services, []);
        if (Array.isArray(services) && services.length) {
          const tSet = new Set(tombstones.services || []);
          const payload = services.filter(s => s && s.id && !tSet.has(s.id)).map(s => ({
            id: s.id,
            date: s.date,
            time: s.time || '09:00',
            venue: s.venue || 'Main Auditorium',
            description: s.description || ''
          }));
          if (payload.length) tasks.push(withRetry(() => client.from('services').upsert(payload)));
        }

        const ministers = readJson(STORES.ministers, []);
        if (Array.isArray(ministers) && ministers.length) {
          const payload = buildMinistersPayload(ministers, new Set(tombstones.ministers || []));
          if (payload.length) tasks.push(withRetry(() => client.from('ministers').upsert(payload)));
        }

        const announcements = readJson(STORES.announcements, []);
        if (Array.isArray(announcements) && announcements.length) {
          tasks.push(upsertAnnouncementsToCloud(announcements, new Set(tombstones.announcements || [])));
        }

        const settings = readJson(STORES.settings, null);
        if (settings && typeof settings === 'object') {
          tasks.push(withRetry(() => client.from('church_settings').upsert({
            key: 'general',
            value: settings,
            updated_at: new Date().toISOString()
          })));
        }

        const userProfiles = readJson(STORES.userProfiles, null);
        if (userProfiles && typeof userProfiles === 'object' && !Array.isArray(userProfiles) && Object.keys(userProfiles).length) {
          tasks.push(syncUserProfilesToCloud(userProfiles, readJson(STORES.users, [])));
        }

        if (tasks.length) await Promise.allSettled(tasks);
        return await this.pullAllFromCloud(false);
      } catch (err) {
        console.warn('[Supabase Push Error]', err);
        return false;
      } finally {
        this.isSyncing = false;
      }
    },

    updateStatusBadge(status) {
      const pill = document.getElementById('supabase-status-pill');
      if (pill) pill.remove();
    }
  };

  function readJson(k, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      return v ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  // Preserve native localStorage.setItem for internal use
  const rawSetItem = Storage.prototype.setItem.bind(window.localStorage);

  // Auto-sync debounce map + pending task callbacks + in-flight promises
  const syncDebounce = {};
  const syncPendingFns = {};
  const syncInFlight = {};

  function runSyncTask(table, task) {
    if (typeof task !== 'function') return Promise.resolve();
    const p = Promise.resolve().then(() => task()).catch(() => {}).finally(() => {
      if (syncInFlight[table] === p) {
        delete syncInFlight[table];
      }
    });
    syncInFlight[table] = p;
    return p;
  }

  function scheduleSync(table, fn) {
    clearTimeout(syncDebounce[table]);
    syncPendingFns[table] = fn;
    syncDebounce[table] = setTimeout(() => {
      delete syncDebounce[table];
      const task = syncPendingFns[table];
      delete syncPendingFns[table];
      if (task) {
        runSyncTask(table, task);
      }
    }, 400);
  }

  async function flushPendingSyncs() {
    const tables = Object.keys(syncPendingFns);
    for (const table of tables) {
      clearTimeout(syncDebounce[table]);
      delete syncDebounce[table];
      const fn = syncPendingFns[table];
      delete syncPendingFns[table];
      if (typeof fn === 'function') {
        runSyncTask(table, fn);
      }
    }
    const inFlightList = Object.values(syncInFlight);
    if (inFlightList.length) {
      await Promise.allSettled(inFlightList);
    }
  }

  // Intercept localStorage.setItem to auto-sync modifications into Supabase
  const originalSetItem = window.localStorage.setItem;
  window.localStorage.setItem = function (key, value) {
    originalSetItem.call(window.localStorage, key, value);
    if (!client || DB.isInternalWrite) return;

    // Check if key is one of our synchronized data stores
    try {
      const parsed = JSON.parse(value);

      if (key === STORES.members && Array.isArray(parsed)) {
        markUnsynced('members', parsed.map(m => m?.id).filter(Boolean));
        scheduleSync('members', async () => {
          const latestTombstones = readJson(TOMBSTONE_KEY, {});
          const payload = buildMembersPayload(parsed, new Set(latestTombstones.members || []));
          if (payload.length > 0) {
            const res = await withRetry(() => client.from('members').upsert(payload));
            if (!res?.error) clearUnsynced('members', payload.map(m => m.id));
          }
        });
      } else if (key === STORES.departments && Array.isArray(parsed)) {
        markUnsynced('departments', parsed.map(d => d?.id || d?.name).filter(Boolean));
        scheduleSync('departments', async () => {
          const latestTombstones = readJson(TOMBSTONE_KEY, {});
          const tSet = new Set(latestTombstones.departments || []);
          const payload = parsed.filter(d => d && (d.id || d.name) && !tSet.has(d.id) && !tSet.has(d.name)).map(d => ({
            id: d.id || d.name,
            name: d.name,
            description: d.description || ''
          }));
          if (payload.length > 0) {
            const res = await withRetry(() => client.from('departments').upsert(payload));
            if (!res?.error) clearUnsynced('departments', payload.map(d => d.id));
          }
        });
      } else if (key === STORES.services && Array.isArray(parsed)) {
        markUnsynced('services', parsed.map(s => s?.id).filter(Boolean));
        scheduleSync('services', async () => {
          const latestTombstones = readJson(TOMBSTONE_KEY, {});
          const tSet = new Set(latestTombstones.services || []);
          const payload = parsed.filter(s => s && s.id && !tSet.has(s.id)).map(s => ({
            id: s.id,
            date: s.date,
            time: s.time || '09:00',
            venue: s.venue || 'Main Auditorium',
            description: s.description || ''
          }));
          if (payload.length > 0) {
            const res = await withRetry(() => client.from('services').upsert(payload));
            if (!res?.error) clearUnsynced('services', payload.map(s => s.id));
          }
        });
      } else if (key === STORES.churchDues && Array.isArray(parsed)) {
        markUnsynced('church_dues', parsed.map(d => d?.id).filter(Boolean));
        scheduleSync('church_dues', async () => {
          const latestTombstones = readJson(TOMBSTONE_KEY, {});
          const tSet = new Set(latestTombstones.church_dues || []);
          const payload = parsed.filter(d => d && d.id && !tSet.has(d.id)).map(d => ({
            id: d.id,
            member_id: d.memberId || null,
            member_name: d.memberName || '',
            department: d.department || 'General',
            amount: Number(d.amount || 0),
            month: d.month || '',
            paid_on: d.paidOn || '',
            method: d.method || 'Cash',
            txn_id: d.txnId || '',
            recorded_by: d.recordedBy || null
          }));
          if (payload.length > 0) {
            const res = await withRetry(() => client.from('church_dues').upsert(payload));
            if (!res?.error) clearUnsynced('church_dues', payload.map(d => d.id));
          }
        });
      } else if (key === STORES.ministryDues && Array.isArray(parsed)) {
        markUnsynced('ministry_dues', parsed.map(d => d?.id).filter(Boolean));
        scheduleSync('ministry_dues', async () => {
          const latestTombstones = readJson(TOMBSTONE_KEY, {});
          const tSet = new Set(latestTombstones.ministry_dues || []);
          const payload = parsed.filter(d => d && d.id && !tSet.has(d.id)).map(d => ({
            id: d.id,
            member_id: d.memberId || null,
            member_name: d.memberName || '',
            department: d.department || '',
            amount: Number(d.amount || 0),
            month: d.month || '',
            paid_on: d.paidOn || '',
            method: d.method || 'Cash',
            txn_id: d.txnId || '',
            recorded_by: d.recordedBy || null
          }));
          if (payload.length > 0) {
            const res = await withRetry(() => client.from('ministry_dues').upsert(payload));
            if (!res?.error) clearUnsynced('ministry_dues', payload.map(d => d.id));
          }
        });
      } else if (key === STORES.offerings && Array.isArray(parsed)) {
        markUnsynced('offerings', parsed.map(o => o?.id).filter(Boolean));
        scheduleSync('offerings', async () => {
          const latestTombstones = readJson(TOMBSTONE_KEY, {});
          const tSet = new Set(latestTombstones.offerings || []);
          const payload = parsed.filter(o => o && o.id && !tSet.has(o.id)).map(o => ({
            id: o.id,
            date: o.date,
            amount: Number(o.amount || 0),
            service_id: o.serviceId || null,
            notes: o.notes || o.note || '',
            recorded_by: o.recordedBy || null
          }));
          if (payload.length > 0) {
            const res = await withRetry(() => client.from('offerings').upsert(payload));
            if (!res?.error) clearUnsynced('offerings', payload.map(o => o.id));
          }
        });
      } else if (key === STORES.thanksgiving && Array.isArray(parsed)) {
        markUnsynced('thanksgiving', parsed.map(t => t?.id).filter(Boolean));
        scheduleSync('thanksgiving', async () => {
          const latestTombstones = readJson(TOMBSTONE_KEY, {});
          const tSet = new Set(latestTombstones.thanksgiving || []);
          const payload = parsed.filter(t => t && t.id && !tSet.has(t.id)).map(t => ({
            id: t.id,
            date: t.date,
            amount: Number(t.amount || 0),
            member_name: t.giver || t.memberName || '',
            location: t.location || '',
            notes: t.note || t.notes || '',
            recorded_by: t.recordedBy || null
          }));
          if (payload.length > 0) {
            const res = await withRetry(() => client.from('thanksgiving').upsert(payload));
            if (!res?.error) clearUnsynced('thanksgiving', payload.map(t => t.id));
          }
        });
      } else if (key === STORES.attendance && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        markUnsynced('attendance', Object.keys(parsed));
        scheduleSync('attendance', async () => {
          const latestTombstones = readJson(TOMBSTONE_KEY, {});
          const tSet = new Set(latestTombstones.attendance || []);
          const payload = Object.entries(parsed).filter(([k]) => !tSet.has(k)).map(([k, records]) => ({
            id: k,
            service_date: k.split(' · ')[0] || '',
            records: records
          }));
          if (payload.length) {
            const res = await withRetry(() => client.from('attendance').upsert(payload));
            if (!res?.error) clearUnsynced('attendance', payload.map(a => a.id));
          }
        });
      } else if (key === STORES.ministers && Array.isArray(parsed)) {
        markUnsynced('ministers', parsed.map(m => m?.id).filter(Boolean));
        scheduleSync('ministers', async () => {
          const latestTombstones = readJson(TOMBSTONE_KEY, {});
          const payload = buildMinistersPayload(parsed, new Set(latestTombstones.ministers || []));
          if (payload.length > 0) {
            const res = await withRetry(() => client.from('ministers').upsert(payload));
            if (!res?.error) clearUnsynced('ministers', payload.map(m => m.id));
          }
        });
      } else if (key === STORES.announcements && Array.isArray(parsed)) {
        markUnsynced('announcements', parsed.map(a => a?.id).filter(Boolean));
        scheduleSync('announcements', async () => {
          const latestTombstones = readJson(TOMBSTONE_KEY, {});
          const tSet = new Set(latestTombstones.announcements || []);
          const res = await upsertAnnouncementsToCloud(parsed, tSet);
          if (!res?.error) clearUnsynced('announcements', parsed.map(a => a?.id).filter(Boolean));
        });
      } else if (key === STORES.settings && parsed) {
        markUnsynced('settings', ['general']);
        scheduleSync('settings', async () => {
          const res = await withRetry(() => client.from('church_settings').upsert({
            key: 'general',
            value: parsed,
            updated_at: new Date().toISOString()
          }));
          if (!res?.error) clearUnsynced('settings', ['general']);
        });
      } else if (key === STORES.users && Array.isArray(parsed)) {
        markUnsynced('user_profiles', ['users']);
        scheduleSync('profiles', async () => {
          await syncUserProfilesToCloud(readJson(STORES.userProfiles, {}), parsed);
        });
      } else if (key === STORES.userProfiles && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        markUnsynced('user_profiles', Object.keys(parsed));
        scheduleSync('user_profiles', async () => {
          await syncUserProfilesToCloud(parsed, readJson(STORES.users, []));
        });
      }
    } catch (_) {}
  };

  // Initialize on page load & continuous synchronization
  document.addEventListener('DOMContentLoaded', async () => {
    const test = await DB.testConnection();
    if (test.ok) {
      await DB.pullAllFromCloud(true);
    } else {
      console.warn('[Supabase Setup Required]', test.error);
      await DB.pullAllFromCloud(true);
    }
  });

  // Re-sync whenever the user switches back to the tab, restores from bfcache, or browser reconnects
  window.addEventListener('focus', () => { DB.pullAllFromCloud(true); });
  window.addEventListener('online', () => { DB.pullAllFromCloud(true); });
  window.addEventListener('pageshow', () => { DB.pullAllFromCloud(true); });
  window.addEventListener('pagehide', () => { flushPendingSyncs(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushPendingSyncs();
    } else if (document.visibilityState === 'visible') {
      DB.pullAllFromCloud(true);
    }
  });
  // Background interval sync every 25 seconds
  setInterval(() => {
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      DB.pullAllFromCloud(true);
    }
  }, 25000);

  window.ChurchDB = DB;
})();
