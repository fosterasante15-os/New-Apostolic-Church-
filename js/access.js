(() => {
      const STORAGE_KEY = 'church-auth-v1';
      const MAIN_ADMIN = { id: 'user-main-admin', name: 'Main Admin', email: 'fosterasante15@gmail.com', role: 'main-admin', status: 'Active' };
      let session;
      try { session = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) { session = null; }
      if (!window.ChurchDB?.isValidAppSession?.(session)) {
        try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) {}
        const target = 'index.html' + location.search + location.hash;
        location.replace('login.html?from=' + encodeURIComponent(target));
        return;
      }
      session = { ...session, role: String(session.role).trim().toLowerCase(), status: 'Active' };
      if (String(session.role).toLowerCase() === 'main-admin' && (!session.name || session.name === 'Admin')) session.name = MAIN_ADMIN.name;
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch (_) {}

      const role = () => String(session?.role || '').toLowerCase();
      const isMainAdmin = () => role() === 'main-admin' || session?.isMainAdmin === true;
      const isAdmin = () => isMainAdmin() || role() === 'admin';
      const isMember = () => role() === 'member';
      const isAccount = () => role() === 'account';                 /* dues-only accounts officer */
      const canRecordDues = () => isAdmin() || isAccount();
      const maintenanceEnabled = () => {
        try { const saved = JSON.parse(localStorage.getItem('church-reconstruction-settings-v1') || 'null'); return Boolean(saved?.values?.maintenanceMode); }
        catch (_) { return false; }
      };
      const setName = name => { session.name = String(name || '').trim() || session.name; try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch (_) {} };
      const recorder = () => ({ id: session.id || '', name: session.name || String(session.email || '').split('@')[0] || 'Admin', email: session.email || '', role: role() });
      const canManageDue = due => isMainAdmin() || (canRecordDues() && !!due?.recordedBy?.id && due.recordedBy.id === session.id);
      window.memberDepartments = m => Array.isArray(m?.departments) && m.departments.length ? m.departments.filter(Boolean) : (m?.department ? String(m.department).split(/\s*,\s*/).filter(Boolean) : []);
      window.ChurchAccess = { getSession: () => ({ ...session }), isMainAdmin, isAdmin, isMember, isMaintenanceMode: maintenanceEnabled, recorder, canManageDue, setName, isAccount, canRecordDues };

      function applyAccess() {
        const owner = isMainAdmin();
        const regularAdmin = role() === 'admin' && !owner;
        const member = isMember();
        const locked = member;
        const lock = document.getElementById('access-lock');
        document.body.classList.toggle('access-locked', locked);
        if (lock) {
          lock.hidden = !locked;
          document.getElementById('access-lock-title').textContent = maintenanceEnabled() ? 'System under maintenance' : 'Administrator access only';
          document.getElementById('access-lock-message').textContent = maintenanceEnabled()
            ? 'The system is temporarily unavailable to member accounts. An administrator can still sign in and continue managing the church system.'
            : 'This administration account is available only to authorized administrators. Please use an approved administrator account.';
        }
        const ownerOnlyRoutes = ['#users', '#settings'];
        const adminRestrictedRoutes = ['#offering-thanksgiving', '#sunday-services', '#announcements', '#report-services', '#report-dues'];
        const memberRestrictedRoutes = ['#members', '#departments', '#church-dues', '#offering-thanksgiving', '#attendance', '#sunday-services', '#announcements', '#ministers', '#users', '#activity', '#settings', '#reports', '#report-members', '#report-attendance', '#report-services', '#report-dues'];
        const account = isAccount();
        document.body.classList.toggle('role-account', account);
        const accountAllowed = ['#church-dues'];                       /* the Dues page holds both Church dues and Ministry dues */
        const accountHidden = account ? [...new Set([...[...document.querySelectorAll('.nav a')].map(a => a.getAttribute('href')), '#dashboard'])].filter(h => h && h.startsWith('#') && !accountAllowed.includes(h)) : [];
        if (account && !accountAllowed.includes(location.hash)) {
          const quiet = !location.hash || location.hash === '#dashboard';
          location.hash = '#church-dues';
          if (!quiet) window.notify?.('Account users can only open Church dues and Ministry dues.', 'error', 'Access restricted');
        }
        const hiddenRoutes = [...(!owner ? ownerOnlyRoutes : []), ...(regularAdmin ? adminRestrictedRoutes : []), ...(member ? memberRestrictedRoutes : []), ...accountHidden];
        document.querySelectorAll('.nav a').forEach(link => {
          link.hidden = hiddenRoutes.includes(link.getAttribute('href'));
        });
        document.querySelectorAll('a[href]').forEach(link => {
          if (hiddenRoutes.includes(link.getAttribute('href'))) link.hidden = true;
        });
        if (regularAdmin) {
          ['offering-thanksgiving', 'sunday-services', 'announcements', 'report-services', 'report-dues'].forEach(id => {
            document.getElementById(id)?.setAttribute('hidden', '');
          });
          ['dash-offering-card-container', 'dash-services-card', 'offerings', 'dues', 'services'].forEach(id => {
            document.getElementById(id)?.setAttribute('hidden', '');
          });
        }
        const restrictedRoutes = [...(!owner ? ownerOnlyRoutes : []), ...(regularAdmin ? adminRestrictedRoutes : []), ...(member ? memberRestrictedRoutes : [])];
        if (!account && restrictedRoutes.includes(location.hash)) {
          location.hash = '#dashboard';
          const message = member
            ? 'Member accounts cannot access this administration system.'
            : regularAdmin
            ? 'This area is restricted to the main admin.'
            : 'Only the main admin can access user and system settings.';
          window.notify?.(message, 'error', 'Access restricted');
        }
      }
      document.addEventListener('DOMContentLoaded', applyAccess);
      window.addEventListener('hashchange', applyAccess);
      window.addEventListener('maintenance-change', applyAccess);
    })();

document.addEventListener('DOMContentLoaded', () => {
      const greeting = document.getElementById('user-greeting');
      if (!greeting) return;
      try {
        const session = JSON.parse(sessionStorage.getItem('church-auth-v1') || '{}');
        const rawName = String(session.name || session.email || '').trim();
        const firstName = (rawName.split(/\s+/)[0] || 'there').replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ'’-]/g, '');
        const hour = new Date().getHours();
        const period = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
        greeting.textContent = `Good ${period}, ${firstName || 'there'}`;
      } catch (_) { greeting.textContent = 'Church Management System'; }
    });
