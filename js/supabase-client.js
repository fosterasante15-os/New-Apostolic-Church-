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
    users: 'church-reconstruction-users-v1'
  };

  const DB = {
    client,
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    isConnected: false,
    isSyncing: false,

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

    async getSession() {
      if (!client) return null;
      const { data } = await client.auth.getSession();
      return data?.session || null;
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
      this.isInternalWrite = true;
      try {
        // Parallel fetch of all cloud tables
        const [
          mRes, dRes, sRes, cdRes, mdRes, oRes, tRes, aRes, minRes, annRes, setRes, pRes
        ] = await Promise.allSettled([
          client.from('members').select('*').order('id', { ascending: true }),
          client.from('departments').select('*').order('name', { ascending: true }),
          client.from('services').select('*').order('date', { ascending: true }),
          client.from('church_dues').select('*').order('created_at', { ascending: false }),
          client.from('ministry_dues').select('*').order('created_at', { ascending: false }),
          client.from('offerings').select('*').order('date', { ascending: false }),
          client.from('thanksgiving').select('*').order('date', { ascending: false }),
          client.from('attendance').select('*'),
          client.from('ministers').select('*').order('display_order', { ascending: true }),
          client.from('announcements').select('*').order('created_at', { ascending: false }),
          client.from('church_settings').select('*').eq('key', 'general').maybeSingle(),
          client.from('profiles').select('*').order('created_at', { ascending: false })
        ]);

        // 1. MEMBERS (Reconcile Cloud + Local)
        {
          const local = readJson(STORES.members, []);
          const cloud = (mRes.status === 'fulfilled' && !mRes.value.error && Array.isArray(mRes.value.data)) ? mRes.value.data : [];
          const map = new Map();
          local.forEach(m => { if (m && m.id) map.set(m.id, m); });
          cloud.forEach(m => {
            if (m && m.id) {
              map.set(m.id, {
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
                photo: m.photo || ''
              });
            }
          });
          const merged = [...map.values()];
          if (merged.length > 0) {
            rawSetItem(STORES.members, JSON.stringify(merged));
            window.churchMembers = merged;
          }
          const cloudIds = new Set(cloud.map(c => c.id));
          const missing = local.filter(l => l && l.id && !cloudIds.has(l.id));
          if (missing.length > 0) {
            const payload = missing.map(m => ({
              id: m.id,
              name: m.name,
              email: m.email || '',
              phone: m.phone || '',
              dob: m.dob || '',
              place: m.place || '',
              department: m.department || '',
              departments: Array.isArray(m.departments) ? m.departments : [],
              joined: m.joined || '',
              status: m.status || 'Active',
              photo: m.photo || ''
            }));
            client.from('members').upsert(payload).catch(e => console.warn('[Auto-reconcile members]', e));
          }
        }

        // 2. DEPARTMENTS (Reconcile Cloud + Local)
        {
          const local = readJson(STORES.departments, []);
          const cloud = (dRes.status === 'fulfilled' && !dRes.value.error && Array.isArray(dRes.value.data)) ? dRes.value.data : [];
          const map = new Map();
          local.forEach(d => { if (d && (d.id || d.name)) map.set(d.id || d.name, d); });
          cloud.forEach(d => { if (d && (d.id || d.name)) map.set(d.id || d.name, d); });
          const merged = [...map.values()];
          if (merged.length > 0) {
            rawSetItem(STORES.departments, JSON.stringify(merged));
            window.churchDepartments = merged;
          }
          const cloudIds = new Set(cloud.map(c => c.id || c.name));
          const missing = local.filter(l => l && !cloudIds.has(l.id || l.name));
          if (missing.length > 0) {
            client.from('departments').upsert(missing).catch(e => console.warn('[Auto-reconcile departments]', e));
          }
        }

        // 3. SERVICES (Reconcile Cloud + Local)
        {
          const local = readJson(STORES.services, []);
          const cloud = (sRes.status === 'fulfilled' && !sRes.value.error && Array.isArray(sRes.value.data)) ? sRes.value.data : [];
          const map = new Map();
          local.forEach(s => { if (s && s.id) map.set(s.id, s); });
          cloud.forEach(s => { if (s && s.id) map.set(s.id, s); });
          const merged = [...map.values()];
          if (merged.length > 0) {
            rawSetItem(STORES.services, JSON.stringify(merged));
            window.churchServices = merged;
          }
          const cloudIds = new Set(cloud.map(c => c.id));
          const missing = local.filter(l => l && l.id && !cloudIds.has(l.id));
          if (missing.length > 0) {
            client.from('services').upsert(missing).catch(e => console.warn('[Auto-reconcile services]', e));
          }
        }

        // 4. CHURCH GENERAL DUES (Reconcile Cloud + Local)
        {
          const local = readJson(STORES.churchDues, []);
          const cloud = (cdRes.status === 'fulfilled' && !cdRes.value.error && Array.isArray(cdRes.value.data)) ? cdRes.value.data : [];
          const map = new Map();
          local.forEach(d => { if (d && d.id) map.set(d.id, d); });
          cloud.forEach(d => {
            if (d && d.id) {
              map.set(d.id, {
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
          const merged = [...map.values()];
          if (merged.length > 0) rawSetItem(STORES.churchDues, JSON.stringify(merged));
          const cloudIds = new Set(cloud.map(c => c.id));
          const missing = local.filter(l => l && l.id && !cloudIds.has(l.id));
          if (missing.length > 0) {
            const payload = missing.map(d => ({
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
            client.from('church_dues').upsert(payload).catch(e => console.warn('[Auto-reconcile church_dues]', e));
          }
        }

        // 5. MINISTRY DUES (Reconcile Cloud + Local)
        {
          const local = readJson(STORES.ministryDues, []);
          const cloud = (mdRes.status === 'fulfilled' && !mdRes.value.error && Array.isArray(mdRes.value.data)) ? mdRes.value.data : [];
          const map = new Map();
          local.forEach(d => { if (d && d.id) map.set(d.id, d); });
          cloud.forEach(d => {
            if (d && d.id) {
              map.set(d.id, {
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
          const merged = [...map.values()];
          if (merged.length > 0) rawSetItem(STORES.ministryDues, JSON.stringify(merged));
          const cloudIds = new Set(cloud.map(c => c.id));
          const missing = local.filter(l => l && l.id && !cloudIds.has(l.id));
          if (missing.length > 0) {
            const payload = missing.map(d => ({
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
            client.from('ministry_dues').upsert(payload).catch(e => console.warn('[Auto-reconcile ministry_dues]', e));
          }
        }

        // 6. OFFERINGS (Reconcile Cloud + Local)
        {
          const local = readJson(STORES.offerings, []);
          const cloud = (oRes.status === 'fulfilled' && !oRes.value.error && Array.isArray(oRes.value.data)) ? oRes.value.data : [];
          const map = new Map();
          local.forEach(o => { if (o && o.id) map.set(o.id, o); });
          cloud.forEach(o => {
            if (o && o.id) {
              map.set(o.id, {
                id: o.id,
                date: o.date,
                amount: Number(o.amount || 0),
                serviceId: o.service_id,
                notes: o.notes,
                recordedBy: o.recorded_by
              });
            }
          });
          const merged = [...map.values()];
          if (merged.length > 0) rawSetItem(STORES.offerings, JSON.stringify(merged));
          const cloudIds = new Set(cloud.map(c => c.id));
          const missing = local.filter(l => l && l.id && !cloudIds.has(l.id));
          if (missing.length > 0) {
            const payload = missing.map(o => ({
              id: o.id,
              date: o.date,
              amount: Number(o.amount || 0),
              service_id: o.serviceId || null,
              notes: o.notes || '',
              recorded_by: o.recordedBy || null
            }));
            client.from('offerings').upsert(payload).catch(e => console.warn('[Auto-reconcile offerings]', e));
          }
        }

        // 7. THANKSGIVING (Reconcile Cloud + Local)
        {
          const local = readJson(STORES.thanksgiving, []);
          const cloud = (tRes.status === 'fulfilled' && !tRes.value.error && Array.isArray(tRes.value.data)) ? tRes.value.data : [];
          const map = new Map();
          local.forEach(t => { if (t && t.id) map.set(t.id, t); });
          cloud.forEach(t => {
            if (t && t.id) {
              map.set(t.id, {
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
          const merged = [...map.values()];
          if (merged.length > 0) rawSetItem(STORES.thanksgiving, JSON.stringify(merged));
          const cloudIds = new Set(cloud.map(c => c.id));
          const missing = local.filter(l => l && l.id && !cloudIds.has(l.id));
          if (missing.length > 0) {
            const payload = missing.map(t => ({
              id: t.id,
              date: t.date,
              amount: Number(t.amount || 0),
              member_name: t.giver || t.memberName || '',
              location: t.location || '',
              notes: t.note || t.notes || '',
              recorded_by: t.recordedBy || null
            }));
            client.from('thanksgiving').upsert(payload).catch(e => console.warn('[Auto-reconcile thanksgiving]', e));
          }
        }

        // 8. ATTENDANCE (Reconcile Cloud + Local)
        {
          const local = readJson(STORES.attendance, {});
          const cloud = (aRes.status === 'fulfilled' && !aRes.value.error && Array.isArray(aRes.value.data)) ? aRes.value.data : [];
          const merged = { ...local };
          cloud.forEach(row => {
            if (row && row.id && row.records) merged[row.id] = row.records;
          });
          rawSetItem(STORES.attendance, JSON.stringify(merged));
          const cloudIds = new Set(cloud.map(c => c.id));
          const missingEntries = Object.entries(local).filter(([k]) => !cloudIds.has(k));
          if (missingEntries.length > 0) {
            const payload = missingEntries.map(([k, records]) => ({
              id: k,
              service_date: k.split(' · ')[0] || '',
              records: records
            }));
            client.from('attendance').upsert(payload).catch(e => console.warn('[Auto-reconcile attendance]', e));
          }
        }

        // 9. MINISTERS (Reconcile Cloud + Local)
        {
          const local = readJson(STORES.ministers, []);
          const cloud = (minRes.status === 'fulfilled' && !minRes.value.error && Array.isArray(minRes.value.data)) ? minRes.value.data : [];
          const map = new Map();
          local.forEach(m => { if (m && m.id) map.set(m.id, m); });
          cloud.forEach(m => {
            if (m && m.id) {
              map.set(m.id, {
                id: m.id,
                name: m.name,
                role: m.role || '',
                note: m.note || m.bio || '',
                photo: m.photo || '',
                order: Number(m.display_order ?? m.order) || 0
              });
            }
          });
          const merged = [...map.values()];
          if (merged.length > 0) {
            rawSetItem(STORES.ministers, JSON.stringify(merged));
            window.churchMinisters = merged;
          }
          const cloudIds = new Set(cloud.map(c => c.id));
          const missing = local.filter(l => l && l.id && !cloudIds.has(l.id));
          if (missing.length > 0) {
            const payload = missing.map(m => ({
              id: m.id,
              name: m.name,
              role: m.role || '',
              bio: m.note || m.bio || '',
              photo: m.photo || '',
              display_order: Number(m.order ?? m.display_order) || 0
            }));
            client.from('ministers').upsert(payload).catch(e => console.warn('[Auto-reconcile ministers]', e));
          }
        }

        // 10. ANNOUNCEMENTS (Reconcile Cloud + Local)
        {
          const local = readJson(STORES.announcements, []);
          const cloud = (annRes.status === 'fulfilled' && !annRes.value.error && Array.isArray(annRes.value.data)) ? annRes.value.data : [];
          const map = new Map();
          local.forEach(a => { if (a && a.id) map.set(a.id, a); });
          cloud.forEach(a => {
            if (a && a.id) {
              map.set(a.id, {
                id: a.id,
                title: a.title,
                content: a.content || '',
                status: a.status || 'draft',
                date: a.date || '',
                smsStatus: a.sms_status || a.smsStatus || 'not-sent',
                smsCount: Number(a.sms_count ?? a.smsCount) || 0,
                smsAt: a.sms_at || a.smsAt || null
              });
            }
          });
          const merged = [...map.values()];
          if (merged.length > 0) rawSetItem(STORES.announcements, JSON.stringify(merged));
          const cloudIds = new Set(cloud.map(c => c.id));
          const missing = local.filter(l => l && l.id && !cloudIds.has(l.id));
          if (missing.length > 0) {
            const payload = missing.map(a => ({
              id: a.id,
              title: a.title,
              content: a.content || '',
              status: a.status || 'draft',
              date: a.date || '',
              sms_status: a.smsStatus || a.sms_status || 'not-sent',
              sms_count: Number(a.smsCount ?? a.sms_count) || 0,
              sms_at: a.smsAt || a.sms_at || null
            }));
            client.from('announcements').upsert(payload).catch(e => console.warn('[Auto-reconcile announcements]', e));
          }
        }

        // 11. SETTINGS (Reconcile Cloud + Local)
        if (setRes.status === 'fulfilled' && !setRes.value.error && setRes.value.data && setRes.value.data.value) {
          rawSetItem(STORES.settings, JSON.stringify(setRes.value.data.value));
        }

        // 12. PROFILES / USERS (Reconcile Cloud + Local)
        {
          const localUsers = readJson(STORES.users, []);
          const cloudUsers = (pRes.status === 'fulfilled' && !pRes.value.error && Array.isArray(pRes.value.data)) ? pRes.value.data : [];
          const existingMap = new Map(localUsers.map(u => [String(u.email).toLowerCase(), u]));
          cloudUsers.forEach(p => {
            const emailKey = String(p.email || '').toLowerCase();
            const existing = existingMap.get(emailKey);
            existingMap.set(emailKey, {
              id: p.id,
              email: p.email,
              name: p.name || existing?.name || p.email.split('@')[0],
              role: p.role || existing?.role || 'member',
              status: p.status || existing?.status || 'Pending',
              lastLogin: p.last_login || existing?.lastLogin || '—',
              isCloud: true
            });
          });
          const merged = [...existingMap.values()];
          if (merged.length > 0) rawSetItem(STORES.users, JSON.stringify(merged));
        }

        this.isConnected = true;

        if (!silent && window.notify) {
          window.notify('Synchronized with Supabase cloud database.', 'success', 'Cloud Synchronized');
        }

        // Dispatch events so every page module immediately reflects cloud data
        window.dispatchEvent(new CustomEvent('members-change', { detail: readJson(STORES.members, []) }));
        window.dispatchEvent(new CustomEvent('departments-change', { detail: readJson(STORES.departments, []) }));
        window.dispatchEvent(new CustomEvent('services-change', { detail: readJson(STORES.services, []) }));
        window.dispatchEvent(new CustomEvent('dues-change'));
        window.dispatchEvent(new CustomEvent('offerings-change'));
        window.dispatchEvent(new CustomEvent('ministers-change'));
        window.dispatchEvent(new CustomEvent('announcements-change'));
        window.dispatchEvent(new CustomEvent('attendance-change'));
        window.dispatchEvent(new CustomEvent('users-change'));
        window.dispatchEvent(new CustomEvent('church-profile-change'));

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
        alert('Supabase client is not loaded.');
        return false;
      }
      return this.pullAllFromCloud(false);
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

  // Auto-sync debounce map
  const syncDebounce = {};
  function scheduleSync(table, fn) {
    clearTimeout(syncDebounce[table]);
    syncDebounce[table] = setTimeout(fn, 400);
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
        scheduleSync('members', async () => {
          const payload = parsed.map(m => ({
            id: m.id,
            name: m.name,
            email: m.email || '',
            phone: m.phone || '',
            dob: m.dob || '',
            place: m.place || '',
            department: m.department || '',
            departments: Array.isArray(m.departments) ? m.departments : [],
            joined: m.joined || '',
            status: m.status || 'Active',
            photo: m.photo || ''
          }));
          await client.from('members').upsert(payload);
        });
      } else if (key === STORES.departments && Array.isArray(parsed)) {
        scheduleSync('departments', async () => {
          await client.from('departments').upsert(parsed);
        });
      } else if (key === STORES.services && Array.isArray(parsed)) {
        scheduleSync('services', async () => {
          await client.from('services').upsert(parsed);
        });
      } else if (key === STORES.churchDues && Array.isArray(parsed)) {
        scheduleSync('church_dues', async () => {
          const payload = parsed.map(d => ({
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
          await client.from('church_dues').upsert(payload);
        });
      } else if (key === STORES.ministryDues && Array.isArray(parsed)) {
        scheduleSync('ministry_dues', async () => {
          const payload = parsed.map(d => ({
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
          await client.from('ministry_dues').upsert(payload);
        });
      } else if (key === STORES.offerings && Array.isArray(parsed)) {
        scheduleSync('offerings', async () => {
          const payload = parsed.map(o => ({
            id: o.id,
            date: o.date,
            amount: Number(o.amount || 0),
            service_id: o.serviceId || null,
            notes: o.notes || '',
            recorded_by: o.recordedBy || null
          }));
          await client.from('offerings').upsert(payload);
        });
      } else if (key === STORES.thanksgiving && Array.isArray(parsed)) {
        scheduleSync('thanksgiving', async () => {
          const payload = parsed.map(t => ({
            id: t.id,
            date: t.date,
            amount: Number(t.amount || 0),
            member_name: t.giver || t.memberName || '',
            location: t.location || '',
            notes: t.note || t.notes || '',
            recorded_by: t.recordedBy || null
          }));
          await client.from('thanksgiving').upsert(payload);
        });
      } else if (key === STORES.attendance && parsed && typeof parsed === 'object') {
        scheduleSync('attendance', async () => {
          const payload = Object.entries(parsed).map(([k, records]) => ({
            id: k,
            service_date: k.split(' · ')[0] || '',
            records: records
          }));
          if (payload.length) await client.from('attendance').upsert(payload);
        });
      } else if (key === STORES.ministers && Array.isArray(parsed)) {
        scheduleSync('ministers', async () => {
          const payload = parsed.map(m => ({
            id: m.id,
            name: m.name,
            role: m.role || '',
            bio: m.note || m.bio || '',
            photo: m.photo || '',
            display_order: Number(m.order ?? m.display_order) || 0
          }));
          await client.from('ministers').upsert(payload);
        });
      } else if (key === STORES.announcements && Array.isArray(parsed)) {
        scheduleSync('announcements', async () => {
          const payload = parsed.map(a => ({
            id: a.id,
            title: a.title,
            content: a.content || '',
            status: a.status || 'draft',
            date: a.date || '',
            sms_status: a.smsStatus || a.sms_status || 'not-sent',
            sms_count: Number(a.smsCount ?? a.sms_count) || 0,
            sms_at: a.smsAt || a.sms_at || null
          }));
          await client.from('announcements').upsert(payload);
        });
      } else if (key === STORES.settings && parsed) {
        scheduleSync('settings', async () => {
          await client.from('church_settings').upsert({
            key: 'general',
            value: parsed,
            updated_at: new Date().toISOString()
          });
        });
      } else if (key === STORES.users && Array.isArray(parsed)) {
        scheduleSync('profiles', async () => {
          const payload = parsed.map(u => ({
            id: String(u.id),
            email: u.email,
            name: u.name || u.email.split('@')[0],
            role: u.role || 'member',
            status: u.status || 'Active'
          }));
          await client.from('profiles').upsert(payload);
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
    }
  });

  // Re-sync whenever the user switches back to the tab or browser reconnects
  window.addEventListener('focus', () => { if (DB.isConnected) DB.pullAllFromCloud(true); });
  window.addEventListener('online', () => { if (DB.isConnected) DB.pullAllFromCloud(true); });
  // Background interval sync every 25 seconds
  setInterval(() => { if (DB.isConnected) DB.pullAllFromCloud(true); }, 25000);

  window.ChurchDB = DB;
})();
