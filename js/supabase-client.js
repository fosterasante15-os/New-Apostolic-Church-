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
    // DELETIONS & TOMBSTONES
    // ----------------------------------------------------
    async deleteItem(table, id) {
      if (!id) return false;
      try {
        const tombstones = readJson('church-tombstones-v1', {});
        tombstones[table] = tombstones[table] || [];
        if (!tombstones[table].includes(id)) {
          tombstones[table].push(id);
          rawSetItem('church-tombstones-v1', JSON.stringify(tombstones));
        }
      } catch (_) {}

      if (client) {
        try {
          const { error } = await client.from(table).delete().eq('id', id);
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

        const tombstones = readJson('church-tombstones-v1', {});

        // 1. MEMBERS
        if (mRes.status === 'fulfilled' && !mRes.value.error && Array.isArray(mRes.value.data)) {
          const tSet = new Set(tombstones.members || []);
          const toDelete = [];
          const clean = [];
          mRes.value.data.forEach(m => {
            if (!m || !m.id) return;
            if (tSet.has(m.id)) {
              toDelete.push(m.id);
            } else {
              clean.push({
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
          if (toDelete.length > 0) {
            client.from('members').delete().in('id', toDelete).catch(() => {});
          }
          rawSetItem(STORES.members, JSON.stringify(clean));
          window.churchMembers = clean;
        }

        // 2. DEPARTMENTS
        if (dRes.status === 'fulfilled' && !dRes.value.error && Array.isArray(dRes.value.data)) {
          const tSet = new Set(tombstones.departments || []);
          const toDelete = [];
          const clean = [];
          dRes.value.data.forEach(d => {
            if (!d || !(d.id || d.name)) return;
            const key = d.id || d.name;
            if (tSet.has(key)) {
              toDelete.push(key);
            } else {
              clean.push({
                id: d.id,
                name: d.name,
                description: d.description || ''
              });
            }
          });
          if (toDelete.length > 0) {
            client.from('departments').delete().in('id', toDelete).catch(() => {});
          }
          rawSetItem(STORES.departments, JSON.stringify(clean));
          window.churchDepartments = clean;
        }

        // 3. SERVICES
        if (sRes.status === 'fulfilled' && !sRes.value.error && Array.isArray(sRes.value.data)) {
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
          if (toDelete.length > 0) {
            client.from('services').delete().in('id', toDelete).catch(() => {});
          }
          rawSetItem(STORES.services, JSON.stringify(clean));
          window.churchServices = clean;
        }

        // 4. CHURCH GENERAL DUES
        if (cdRes.status === 'fulfilled' && !cdRes.value.error && Array.isArray(cdRes.value.data)) {
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
          if (toDelete.length > 0) {
            client.from('church_dues').delete().in('id', toDelete).catch(() => {});
          }
          rawSetItem(STORES.churchDues, JSON.stringify(clean));
        }

        // 5. MINISTRY DUES
        if (mdRes.status === 'fulfilled' && !mdRes.value.error && Array.isArray(mdRes.value.data)) {
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
          if (toDelete.length > 0) {
            client.from('ministry_dues').delete().in('id', toDelete).catch(() => {});
          }
          rawSetItem(STORES.ministryDues, JSON.stringify(clean));
        }

        // 6. OFFERINGS
        if (oRes.status === 'fulfilled' && !oRes.value.error && Array.isArray(oRes.value.data)) {
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
          if (toDelete.length > 0) {
            client.from('offerings').delete().in('id', toDelete).catch(() => {});
          }
          rawSetItem(STORES.offerings, JSON.stringify(clean));
        }

        // 7. THANKSGIVING
        if (tRes.status === 'fulfilled' && !tRes.value.error && Array.isArray(tRes.value.data)) {
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
          if (toDelete.length > 0) {
            client.from('thanksgiving').delete().in('id', toDelete).catch(() => {});
          }
          rawSetItem(STORES.thanksgiving, JSON.stringify(clean));
        }

        // 8. ATTENDANCE
        if (aRes.status === 'fulfilled' && !aRes.value.error && Array.isArray(aRes.value.data)) {
          const tSet = new Set(tombstones.attendance || []);
          const merged = {};
          aRes.value.data.forEach(row => {
            if (row && row.id && !tSet.has(row.id)) {
              merged[row.id] = row.records || {};
            }
          });
          rawSetItem(STORES.attendance, JSON.stringify(merged));
        }

        // 9. MINISTERS
        if (minRes.status === 'fulfilled' && !minRes.value.error && Array.isArray(minRes.value.data)) {
          const tSet = new Set(tombstones.ministers || []);
          const toDelete = [];
          const clean = [];
          minRes.value.data.forEach(m => {
            if (!m || !m.id) return;
            if (tSet.has(m.id)) {
              toDelete.push(m.id);
            } else {
              clean.push({
                id: m.id,
                name: m.name,
                role: m.role || '',
                note: m.note || m.bio || '',
                photo: m.photo || '',
                order: Number(m.display_order ?? m.order) || 0
              });
            }
          });
          if (toDelete.length > 0) {
            client.from('ministers').delete().in('id', toDelete).catch(() => {});
          }
          rawSetItem(STORES.ministers, JSON.stringify(clean));
          window.churchMinisters = clean;
        }

        // 10. ANNOUNCEMENTS
        if (annRes.status === 'fulfilled' && !annRes.value.error && Array.isArray(annRes.value.data)) {
          const tSet = new Set(tombstones.announcements || []);
          const toDelete = [];
          const clean = [];
          annRes.value.data.forEach(a => {
            if (!a || !a.id) return;
            if (tSet.has(a.id)) {
              toDelete.push(a.id);
            } else {
              clean.push({
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
          if (toDelete.length > 0) {
            client.from('announcements').delete().in('id', toDelete).catch(() => {});
          }
          rawSetItem(STORES.announcements, JSON.stringify(clean));
        }

        // 11. SETTINGS
        if (setRes.status === 'fulfilled' && !setRes.value.error && setRes.value.data && setRes.value.data.value) {
          rawSetItem(STORES.settings, JSON.stringify(setRes.value.data.value));
        }

        // 12. PROFILES / USERS
        if (pRes.status === 'fulfilled' && !pRes.value.error && Array.isArray(pRes.value.data)) {
          const localUsers = readJson(STORES.users, []);
          const existingMap = new Map(localUsers.map(u => [String(u.email).toLowerCase(), u]));
          const tSet = new Set(tombstones.profiles || []);
          pRes.value.data.forEach(p => {
            if (!p || tSet.has(p.id) || tSet.has(p.email)) return;
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
          rawSetItem(STORES.users, JSON.stringify([...existingMap.values()]));
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
      const tombstones = readJson('church-tombstones-v1', {});

      if (key === STORES.members && Array.isArray(parsed)) {
        scheduleSync('members', async () => {
          const tSet = new Set(tombstones.members || []);
          const payload = parsed.filter(m => m && m.id && !tSet.has(m.id)).map(m => ({
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
          if (payload.length > 0) await client.from('members').upsert(payload);
        });
      } else if (key === STORES.departments && Array.isArray(parsed)) {
        scheduleSync('departments', async () => {
          const tSet = new Set(tombstones.departments || []);
          const payload = parsed.filter(d => d && !tSet.has(d.id) && !tSet.has(d.name));
          if (payload.length > 0) await client.from('departments').upsert(payload);
        });
      } else if (key === STORES.services && Array.isArray(parsed)) {
        scheduleSync('services', async () => {
          const tSet = new Set(tombstones.services || []);
          const payload = parsed.filter(s => s && s.id && !tSet.has(s.id));
          if (payload.length > 0) await client.from('services').upsert(payload);
        });
      } else if (key === STORES.churchDues && Array.isArray(parsed)) {
        scheduleSync('church_dues', async () => {
          const tSet = new Set(tombstones.church_dues || []);
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
          if (payload.length > 0) await client.from('church_dues').upsert(payload);
        });
      } else if (key === STORES.ministryDues && Array.isArray(parsed)) {
        scheduleSync('ministry_dues', async () => {
          const tSet = new Set(tombstones.ministry_dues || []);
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
          if (payload.length > 0) await client.from('ministry_dues').upsert(payload);
        });
      } else if (key === STORES.offerings && Array.isArray(parsed)) {
        scheduleSync('offerings', async () => {
          const tSet = new Set(tombstones.offerings || []);
          const payload = parsed.filter(o => o && o.id && !tSet.has(o.id)).map(o => ({
            id: o.id,
            date: o.date,
            amount: Number(o.amount || 0),
            service_id: o.serviceId || null,
            notes: o.notes || '',
            recorded_by: o.recordedBy || null
          }));
          if (payload.length > 0) await client.from('offerings').upsert(payload);
        });
      } else if (key === STORES.thanksgiving && Array.isArray(parsed)) {
        scheduleSync('thanksgiving', async () => {
          const tSet = new Set(tombstones.thanksgiving || []);
          const payload = parsed.filter(t => t && t.id && !tSet.has(t.id)).map(t => ({
            id: t.id,
            date: t.date,
            amount: Number(t.amount || 0),
            member_name: t.giver || t.memberName || '',
            location: t.location || '',
            notes: t.note || t.notes || '',
            recorded_by: t.recordedBy || null
          }));
          if (payload.length > 0) await client.from('thanksgiving').upsert(payload);
        });
      } else if (key === STORES.attendance && parsed && typeof parsed === 'object') {
        scheduleSync('attendance', async () => {
          const tSet = new Set(tombstones.attendance || []);
          const payload = Object.entries(parsed).filter(([k]) => !tSet.has(k)).map(([k, records]) => ({
            id: k,
            service_date: k.split(' · ')[0] || '',
            records: records
          }));
          if (payload.length) await client.from('attendance').upsert(payload);
        });
      } else if (key === STORES.ministers && Array.isArray(parsed)) {
        scheduleSync('ministers', async () => {
          const tSet = new Set(tombstones.ministers || []);
          const payload = parsed.filter(m => m && m.id && !tSet.has(m.id)).map(m => ({
            id: m.id,
            name: m.name,
            role: m.role || '',
            bio: m.note || m.bio || '',
            photo: m.photo || '',
            display_order: Number(m.order ?? m.display_order) || 0
          }));
          if (payload.length > 0) await client.from('ministers').upsert(payload);
        });
      } else if (key === STORES.announcements && Array.isArray(parsed)) {
        scheduleSync('announcements', async () => {
          const tSet = new Set(tombstones.announcements || []);
          const payload = parsed.filter(a => a && a.id && !tSet.has(a.id)).map(a => ({
            id: a.id,
            title: a.title,
            content: a.content || '',
            status: a.status || 'draft',
            date: a.date || '',
            sms_status: a.smsStatus || a.sms_status || 'not-sent',
            sms_count: Number(a.smsCount ?? a.sms_count) || 0,
            sms_at: a.smsAt || a.sms_at || null
          }));
          if (payload.length > 0) await client.from('announcements').upsert(payload);
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
          const tSet = new Set(tombstones.profiles || []);
          const payload = parsed.filter(u => u && !tSet.has(String(u.id)) && !tSet.has(u.email)).map(u => ({
            id: String(u.id),
            email: u.email,
            name: u.name || u.email.split('@')[0],
            role: u.role || 'member',
            status: u.status || 'Active'
          }));
          if (payload.length > 0) await client.from('profiles').upsert(payload);
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
