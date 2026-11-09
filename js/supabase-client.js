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
    async pullAllFromCloud(silent = false) {
      if (!client || this.isSyncing) return false;
      this.isSyncing = true;
      try {
        // 1. Members
        const { data: members, error: mErr } = await client.from('members').select('*').order('id', { ascending: true });
        if (!mErr && Array.isArray(members) && members.length > 0) {
          const formatted = members.map(m => ({
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
          }));
          rawSetItem(STORES.members, JSON.stringify(formatted));
          window.churchMembers = formatted;
        }

        // 2. Departments
        const { data: depts, error: dErr } = await client.from('departments').select('*').order('name', { ascending: true });
        if (!dErr && Array.isArray(depts) && depts.length > 0) {
          rawSetItem(STORES.departments, JSON.stringify(depts));
          window.churchDepartments = depts;
        }

        // 3. Services
        const { data: services, error: sErr } = await client.from('services').select('*').order('date', { ascending: true });
        if (!sErr && Array.isArray(services) && services.length > 0) {
          rawSetItem(STORES.services, JSON.stringify(services));
          window.churchServices = services;
        }

        // 4. Church General Dues
        const { data: cDues, error: cdErr } = await client.from('church_dues').select('*').order('created_at', { ascending: false });
        if (!cdErr && Array.isArray(cDues)) {
          const list = cDues.map(d => ({
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
          }));
          rawSetItem(STORES.churchDues, JSON.stringify(list));
        }

        // 5. Ministry Dues
        const { data: mDues, error: mdErr } = await client.from('ministry_dues').select('*').order('created_at', { ascending: false });
        if (!mdErr && Array.isArray(mDues)) {
          const list = mDues.map(d => ({
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
          }));
          rawSetItem(STORES.ministryDues, JSON.stringify(list));
        }

        // 6. Offerings
        const { data: offerings, error: oErr } = await client.from('offerings').select('*').order('date', { ascending: false });
        if (!oErr && Array.isArray(offerings)) {
          const list = offerings.map(o => ({
            id: o.id,
            date: o.date,
            amount: Number(o.amount || 0),
            serviceId: o.service_id,
            notes: o.notes,
            recordedBy: o.recorded_by
          }));
          rawSetItem(STORES.offerings, JSON.stringify(list));
        }

        // 7. Thanksgiving
        const { data: thanks, error: tErr } = await client.from('thanksgiving').select('*').order('date', { ascending: false });
        if (!tErr && Array.isArray(thanks)) {
          const list = thanks.map(t => ({
            id: t.id,
            date: t.date,
            amount: Number(t.amount || 0),
            giver: t.giver || t.member_name || '',
            memberName: t.giver || t.member_name || '',
            location: t.location || '',
            note: t.note || t.notes || '',
            notes: t.note || t.notes || '',
            recordedBy: t.recorded_by || null
          }));
          rawSetItem(STORES.thanksgiving, JSON.stringify(list));
        }

        // 8. Attendance
        const { data: attendance, error: aErr } = await client.from('attendance').select('*');
        if (!aErr && Array.isArray(attendance)) {
          const map = {};
          attendance.forEach(row => {
            if (row.id && row.records) map[row.id] = row.records;
          });
          if (Object.keys(map).length > 0) rawSetItem(STORES.attendance, JSON.stringify(map));
        }

        // 9. Ministers
        const { data: ministers, error: minErr } = await client.from('ministers').select('*').order('display_order', { ascending: true });
        if (!minErr && Array.isArray(ministers) && ministers.length > 0) {
          const formattedMinisters = ministers.map(m => ({
            id: m.id,
            name: m.name,
            role: m.role || '',
            note: m.note || m.bio || '',
            photo: m.photo || '',
            order: Number(m.display_order ?? m.order) || 0
          }));
          rawSetItem(STORES.ministers, JSON.stringify(formattedMinisters));
          window.churchMinisters = formattedMinisters;
        }

        // 10. Announcements
        const { data: announcements, error: annErr } = await client.from('announcements').select('*').order('created_at', { ascending: false });
        if (!annErr && Array.isArray(announcements) && announcements.length > 0) {
          const formattedAnnouncements = announcements.map(a => ({
            id: a.id,
            title: a.title,
            content: a.content || '',
            status: a.status || 'draft',
            date: a.date || '',
            smsStatus: a.sms_status || a.smsStatus || 'not-sent',
            smsCount: Number(a.sms_count ?? a.smsCount) || 0,
            smsAt: a.sms_at || a.smsAt || null
          }));
          rawSetItem(STORES.announcements, JSON.stringify(formattedAnnouncements));
        }

        // 11. Settings
        const { data: settingsRow, error: setErr } = await client.from('church_settings').select('*').eq('key', 'general').maybeSingle();
        if (!setErr && settingsRow && settingsRow.value) {
          rawSetItem(STORES.settings, JSON.stringify(settingsRow.value));
        }

        // 12. Profiles / User Accounts
        const { data: profiles, error: pErr } = await client.from('profiles').select('*').order('created_at', { ascending: false });
        if (!pErr && Array.isArray(profiles) && profiles.length > 0) {
          const localUsers = readJson(STORES.users, []);
          const existingMap = new Map((Array.isArray(localUsers) ? localUsers : []).map(u => [String(u.email).toLowerCase(), u]));

          profiles.forEach(p => {
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
          rawSetItem(STORES.users, JSON.stringify(merged));
          window.dispatchEvent(new CustomEvent('users-change'));
        }

        this.isConnected = true;
        this.updateStatusBadge('connected');
        if (!silent && window.notify) {
          window.notify('Downloaded latest data from Supabase cloud.', 'success', 'Cloud Synchronized');
        }

        // Trigger UI event re-renders
        window.dispatchEvent(new CustomEvent('departments-change'));
        window.dispatchEvent(new CustomEvent('services-change'));
        window.dispatchEvent(new CustomEvent('dues-change'));
        window.dispatchEvent(new CustomEvent('offerings-change'));
        return true;
      } catch (err) {
        console.warn('[Supabase Sync Error]', err);
        this.updateStatusBadge('error');
        return false;
      } finally {
        this.isSyncing = false;
      }
    },

    // ----------------------------------------------------
    // PUSH LOCALSTORAGE DATA UP TO SUPABASE
    // ----------------------------------------------------
    async pushAllToCloud() {
      if (!client) {
        alert('Supabase client is not loaded.');
        return false;
      }
      const test = await this.testConnection();
      if (!test.ok) {
        alert('Could not connect to Supabase tables:\n\n' + test.error + '\n\nPlease ensure you ran "supabase-schema.sql" in your Supabase SQL Editor.');
        return false;
      }

      let count = 0;
      try {
        // Members
        const members = readJson(STORES.members, []);
        if (members.length) {
          const payload = members.map(m => ({
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
          const { error } = await client.from('members').upsert(payload);
          if (!error) count += payload.length;
        }

        // Departments
        const depts = readJson(STORES.departments, []);
        if (depts.length) {
          await client.from('departments').upsert(depts);
        }

        // Services
        const services = readJson(STORES.services, []);
        if (services.length) {
          await client.from('services').upsert(services);
        }

        // Church Dues
        const cDues = readJson(STORES.churchDues, []);
        if (cDues.length) {
          const payload = cDues.map(d => ({
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
        }

        // Ministry Dues
        const mDues = readJson(STORES.ministryDues, []);
        if (mDues.length) {
          const payload = mDues.map(d => ({
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
        }

        // Offerings
        const offerings = readJson(STORES.offerings, []);
        if (offerings.length) {
          const payload = offerings.map(o => ({
            id: o.id,
            date: o.date,
            amount: Number(o.amount || 0),
            service_id: o.serviceId || null,
            notes: o.notes || '',
            recorded_by: o.recordedBy || null
          }));
          await client.from('offerings').upsert(payload);
        }

        // Thanksgiving
        const thanks = readJson(STORES.thanksgiving, []);
        if (thanks.length) {
          const payload = thanks.map(t => ({
            id: t.id,
            date: t.date,
            amount: Number(t.amount || 0),
            member_name: t.giver || t.memberName || '',
            location: t.location || '',
            notes: t.note || t.notes || '',
            recorded_by: t.recordedBy || null
          }));
          await client.from('thanksgiving').upsert(payload);
        }

        // Attendance
        const attMap = readJson(STORES.attendance, {});
        if (attMap && typeof attMap === 'object' && Object.keys(attMap).length) {
          const payload = Object.entries(attMap).map(([key, records]) => ({
            id: key,
            service_date: key.split(' · ')[0] || '',
            records: records
          }));
          await client.from('attendance').upsert(payload);
        }

        // Ministers
        const ministers = readJson(STORES.ministers, []);
        if (ministers.length) {
          const payload = ministers.map(m => ({
            id: m.id,
            name: m.name,
            role: m.role || '',
            bio: m.note || m.bio || '',
            photo: m.photo || '',
            display_order: Number(m.order ?? m.display_order) || 0
          }));
          await client.from('ministers').upsert(payload);
        }

        // Announcements
        const ann = readJson(STORES.announcements, []);
        if (ann.length) {
          const payload = ann.map(a => ({
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
        }

        // Settings
        const settings = readJson(STORES.settings, null);
        if (settings) {
          await client.from('church_settings').upsert({
            key: 'general',
            value: settings,
            updated_at: new Date().toISOString()
          });
        }

        // User Accounts / Profiles
        const allUsers = readJson(STORES.users, []);
        if (allUsers.length) {
          const payload = allUsers.map(u => ({
            id: String(u.id),
            email: u.email,
            name: u.name || u.email.split('@')[0],
            role: u.role || 'member',
            status: u.status || 'Active'
          }));
          await client.from('profiles').upsert(payload);
        }

        window.notify && window.notify('All local records uploaded to Supabase successfully!', 'success', 'Upload Complete');
        this.updateStatusBadge('connected');
        return true;
      } catch (err) {
        alert('Upload failed: ' + err.message);
        return false;
      }
    },

    // ----------------------------------------------------
    // UI STATUS PILL
    // ----------------------------------------------------
    updateStatusBadge(status) {
      let pill = document.getElementById('supabase-status-pill');
      if (!pill) {
        const topbar = document.querySelector('.topbar-actions') || document.querySelector('.topbar');
        if (!topbar) return;
        pill = document.createElement('div');
        pill.id = 'supabase-status-pill';
        pill.className = 'supabase-pill';
        pill.addEventListener('click', () => {
          if (this.isConnected) {
            window.notify && window.notify('Connected to Supabase PostgreSQL: nsccmfevvkvjhvxrtmax.supabase.co', 'info', 'Cloud Database Active');
          } else {
            alert('Supabase Connection Notice:\n\nIf you see this warning, run the "supabase-schema.sql" file in your Supabase SQL Editor to initialize all cloud database tables.');
          }
        });
        topbar.prepend(pill);
      }

      if (status === 'connected') {
        pill.innerHTML = '<span class="status-dot green"></span> Supabase Cloud';
        pill.title = 'Connected to Supabase PostgreSQL database';
        pill.className = 'supabase-pill is-connected';
      } else if (status === 'error') {
        pill.innerHTML = '<span class="status-dot red"></span> Setup Cloud Tables';
        pill.title = 'Click for setup instructions. Schema needs to be run in Supabase SQL editor.';
        pill.className = 'supabase-pill is-warning';
      } else {
        pill.innerHTML = '<span class="status-dot amber"></span> Connecting...';
        pill.className = 'supabase-pill';
      }
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
    if (!client || DB.isSyncing) return;

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

  // Inject Styles for the Supabase Cloud badge
  const style = document.createElement('style');
  style.textContent = `
    .supabase-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      color: #244153;
      background: #eef6f9;
      border: 1px solid #d0e4ed;
      cursor: pointer;
      user-select: none;
      transition: all .2s ease;
      margin-right: 8px;
    }
    .supabase-pill:hover {
      background: #e1f0f5;
    }
    .supabase-pill .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .status-dot.green { background: #12b76a; box-shadow: 0 0 0 3px rgba(18,183,106,.2); }
    .status-dot.red { background: #f04438; box-shadow: 0 0 0 3px rgba(240,68,56,.2); }
    .status-dot.amber { background: #f79009; }
    html[data-theme="dark"] .supabase-pill {
      background: #172c36;
      border-color: #2b4957;
      color: #c9e2ee;
    }
  `;
  document.head.appendChild(style);

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', async () => {
    DB.updateStatusBadge('connecting');
    const test = await DB.testConnection();
    if (test.ok) {
      DB.updateStatusBadge('connected');
      // Pull latest changes from cloud
      await DB.pullAllFromCloud(true);
    } else {
      console.warn('[Supabase Setup Required]', test.error);
      DB.updateStatusBadge('error');
    }
  });

  window.ChurchDB = DB;
})();
