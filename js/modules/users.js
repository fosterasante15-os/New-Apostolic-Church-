(() => {
  const storageKey = 'church-reconstruction-users-v1', credentialsKey = 'church-credentials-v1', noticesKey = 'church-user-notices-v1', profilesKey = 'church-profiles-v1', activityKey = 'church-activity-v1';
  let users = [], hasSavedUsers = false;
  const readJson = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch (_) { return fallback; } };

  function logActivity(entry) {
    try {
      const list = readJson(activityKey, []); const arr = Array.isArray(list) ? list : [];
      arr.push({ id: `a-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), entity: 'user', ...entry });
      localStorage.setItem(activityKey, JSON.stringify(arr.slice(-500)));
    } catch (_) {}
  }


  const rows = document.getElementById('user-rows');
  const count = document.getElementById('user-count');
  const notice = document.getElementById('user-notice');
  const filterForm = document.getElementById('user-filter');
  const searchInput = document.getElementById('user-search');
  const roleFilter = document.getElementById('user-role-filter');
  const dialog = document.getElementById('user-dialog');
  const form = document.getElementById('user-form');
  const nameInput = document.getElementById('user-name');
  const emailInput = document.getElementById('user-email');
  const passwordInput = document.getElementById('user-password');
  const roleInput = document.getElementById('user-role');
  const statusInput = document.getElementById('user-status');
  const saveBtn = document.getElementById('user-save');
  const sessionSummary = document.getElementById('current-session-summary');
  let editingId = null, resetMode = false, approveMode = false;

  function activeSession() { try { return JSON.parse(sessionStorage.getItem('church-auth-v1') || 'null'); } catch (_) { return null; } }
  function isCurrentUser(user) { const current = activeSession(); return Boolean(current && current.id === user.id); }
  function renderSessionSummary() {
    const current = activeSession();
    if (!current) { sessionSummary.textContent = 'No administrator is signed in in this browser.'; return; }
    const roleName = current.role === 'main-admin' ? 'Main Admin' : current.role === 'admin' ? 'Admin' : current.role === 'account' ? 'Account' : 'Member';
    sessionSummary.textContent = `${current.name || current.email} · ${current.email} · ${roleName} · Signed in now`;
  }

  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(users)); }
    catch (_) { notice.textContent = 'Changes work for this session but could not be saved in browser storage.'; }
  }

  function syncNavBadge(pendingCount) {
    const navUsers = document.querySelector('.nav a[href="#users"]');
    if (!navUsers) return;
    let badge = navUsers.querySelector('.nav-badge');
    if (pendingCount > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-badge';
        navUsers.append(badge);
      }
      badge.textContent = String(pendingCount);
      badge.title = `${pendingCount} registration(s) pending approval`;
    } else if (badge) {
      badge.remove();
    }
  }

  function render() {
    const query = searchInput.value.trim().toLowerCase();
    const selectedRole = roleFilter.value;
    const pendingList = users.filter(u => String(u.status).toLowerCase() === 'pending');
    syncNavBadge(pendingList.length);

    let pendingBanner = document.getElementById('user-pending-banner');
    if (pendingList.length > 0) {
      if (!pendingBanner) {
        pendingBanner = document.createElement('div');
        pendingBanner.id = 'user-pending-banner';
        pendingBanner.className = 'pending-approval-banner';
        const usersSection = document.getElementById('users');
        const tableCard = usersSection?.querySelector('.table-card');
        if (tableCard) tableCard.before(pendingBanner);
      }
      pendingBanner.innerHTML = `<strong>🔔 Pending Approvals (${pendingList.length}):</strong> Review newly registered users below, select their role (Admin, Accountant, etc.), and approve their access.`;
      pendingBanner.hidden = false;
    } else if (pendingBanner) {
      pendingBanner.hidden = true;
    }

    const visible = users.filter(user =>
      (!query || [user.name, user.email, user.role === 'main-admin' ? 'main admin' : user.role, user.status].some(value => String(value || '').toLowerCase().includes(query))) &&
      (selectedRole === 'all' || user.role === selectedRole)
    );
    rows.replaceChildren();
    visible.forEach(user => {
      const isPending = String(user.status || '').toLowerCase() === 'pending';
      const tr = document.createElement('tr'); tr.dataset.userId = user.id;
      if (isPending) tr.style.backgroundColor = 'rgba(245, 158, 11, 0.05)';

      const email = document.createElement('td');
      if (user.name && user.name !== user.email) {
        email.innerHTML = `<span style="font-weight:600;display:block;">${user.name}</span><span style="font-size:12px;color:var(--muted);">${user.email}</span>`;
      } else {
        email.style.fontWeight = '600';
        email.textContent = user.email;
      }

      const role = document.createElement('td');
      role.textContent = ({ 'main-admin': 'Main admin', admin: 'Admin', account: 'Account', member: 'Member' })[user.role] || user.role;

      const statusCell = document.createElement('td');
      const badge = document.createElement('span');
      if (isPending) {
        badge.className = 'status pending';
        badge.textContent = 'Pending Approval';
      } else if (user.status.toLowerCase() === 'active') {
        badge.className = 'status';
        badge.textContent = 'Active';
      } else {
        badge.className = 'status inactive';
        badge.textContent = user.status;
      }
      statusCell.append(badge);

      const lastLogin = document.createElement('td');
      const parsedLogin = user.lastLogin && !['—', '-', 'Current session'].includes(String(user.lastLogin)) ? new Date(user.lastLogin) : null;
      lastLogin.textContent = isCurrentUser(user) ? 'Current session' : (parsedLogin && !Number.isNaN(parsedLogin.getTime()) ? parsedLogin.toLocaleString() : (isPending ? 'Awaiting approval' : '—'));

      const actions = document.createElement('td'); const actionGroup = document.createElement('div'); actionGroup.className = 'row-actions';

      if (isPending) {
        const approveBtn = document.createElement('button');
        approveBtn.type = 'button';
        approveBtn.dataset.action = 'approve';
        approveBtn.className = 'approve-button';
        approveBtn.textContent = 'Approve & Assign Role';
        actionGroup.append(approveBtn);

        const declineBtn = document.createElement('button');
        declineBtn.type = 'button';
        declineBtn.dataset.action = 'decline';
        declineBtn.className = 'delete';
        declineBtn.textContent = 'Decline';
        actionGroup.append(declineBtn);
      } else {
        const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.action = 'edit'; edit.textContent = 'Edit'; actionGroup.append(edit);
        const current = isCurrentUser(user);
        if ((user.role === 'admin' || user.role === 'account' || user.role === 'main-admin') && !current) { const reset = document.createElement('button'); reset.type = 'button'; reset.dataset.action = 'reset-password'; reset.textContent = 'Reset password'; actionGroup.append(reset); }
        if (!current) { const del = document.createElement('button'); del.type = 'button'; del.dataset.action = 'delete'; del.className = 'delete'; del.textContent = 'Delete'; actionGroup.append(del); }
      }

      actions.append(actionGroup); tr.append(email,role,statusCell,lastLogin,actions); rows.append(tr);
    });
    count.textContent = `${visible.length} ${visible.length === 1 ? 'record' : 'records'}${query ? ` · matching “${searchInput.value.trim()}”` : ''}${selectedRole === 'all' ? '' : ` · ${selectedRole}`}`;
    renderSessionSummary();
  }

  function openDialog(user = null, recovery = false, approve = false) {
    if (!window.ChurchAccess?.isMainAdmin()) {
      window.notify?.('Only the main admin can manage user accounts.', 'error', 'Main admin access needed');
      return;
    }
    editingId = user ? user.id : null;
    resetMode = Boolean(recovery && user);
    approveMode = Boolean(approve && user);

    const dialogTitle = document.getElementById('user-dialog-title');
    if (approveMode) {
      dialogTitle.textContent = 'Approve user & assign role';
      if (saveBtn) saveBtn.textContent = 'Approve & Activate';
    } else if (resetMode) {
      dialogTitle.textContent = 'Reset password and unlock account';
      if (saveBtn) saveBtn.textContent = 'Reset password';
    } else if (user) {
      dialogTitle.textContent = 'Edit user';
      if (saveBtn) saveBtn.textContent = 'Save user';
    } else {
      dialogTitle.textContent = 'Add user';
      if (saveBtn) saveBtn.textContent = 'Add new user';
    }

    nameInput.value = user?.name || '';
    emailInput.value = user?.email || '';
    passwordInput.value = '';
    roleInput.value = approveMode ? (user?.role && user.role !== 'member' ? user.role : 'admin') : (user?.role || 'admin');
    statusInput.value = (approveMode || resetMode) ? 'Active' : (user?.status || 'Active');

    if (approveMode) {
      passwordInput.placeholder = 'Password already set by user (leave blank to keep)';
      passwordInput.required = false;
      emailInput.readOnly = true;
    } else if (resetMode) {
      passwordInput.placeholder = 'Enter a new password (required)';
      passwordInput.required = true;
      emailInput.readOnly = false;
    } else {
      passwordInput.placeholder = user ? 'Leave blank to keep current' : 'At least 8 characters';
      passwordInput.required = !user;
      emailInput.readOnly = false;
    }

    dialog.showModal();
    if (approveMode) roleInput.focus();
    else if (!user) emailInput.focus();
    else passwordInput.focus();
  }

  document.getElementById('user-add').addEventListener('click', () => openDialog());
  document.getElementById('user-cancel').addEventListener('click', () => dialog.close());
  filterForm.addEventListener('submit', event => { event.preventDefault(); render(); });
  searchInput.addEventListener('input', render);
  roleFilter.addEventListener('change', render);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saveBtn.disabled) return;
    const email = emailInput.value.trim().toLowerCase();
    if (!email || !emailInput.checkValidity()) { emailInput.reportValidity(); return; }
    const duplicate = users.some(user => user.email.toLowerCase() === email && user.id !== editingId);
    if (duplicate) { window.alert('That email address is already in the local user list.'); return; }
    const password = passwordInput.value;
    if ((!editingId || resetMode) && !approveMode && password.length < 8) { passwordInput.setCustomValidity('Use at least 8 characters.'); passwordInput.reportValidity(); passwordInput.setCustomValidity(''); return; }
    if (editingId && password && password.length < 8) { passwordInput.setCustomValidity('Use at least 8 characters.'); passwordInput.reportValidity(); passwordInput.setCustomValidity(''); return; }
    if (!window.ChurchAccess?.isMainAdmin()) { window.notify?.('Only the main admin can manage user accounts.', 'error', 'Main admin access needed'); return; }
    if (editingId && users.find(user => user.id === editingId)?.role === 'main-admin' && roleInput.value !== 'main-admin') {
      window.alert('The main admin account must keep the Main admin role.');
      roleInput.value = 'main-admin';
      return;
    }

    const selectedRole = roleInput.value;
    const selectedStatus = statusInput.value;
    const roleLabel = ({ 'main-admin': 'Main admin', admin: 'Admin', account: 'Account / Accountant', member: 'Member' })[selectedRole] || selectedRole;

    const name = nameInput.value.trim() || email.split('@')[0];
    const values = { name, email, role: selectedRole, status: selectedStatus };
    if (approveMode) values.status = selectedStatus || 'Active';

    if (!editingId && !approveMode) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving to Supabase…';
      try {
        const result = await window.ChurchDB.createUserAccount({ name, email, password, role: selectedRole, status: selectedStatus });
        const created = result?.user;
        if (!created?.id) throw new Error('Supabase created no user record.');
        users.unshift(created);
        logActivity({ action: 'create', userId: created.id, userName: name, role: selectedRole, summary: `Main Admin created account for ${email}`, data: { email, name, role: selectedRole, status: selectedStatus } });
        persist(); render(); dialog.close();
        passwordInput.value = '';
        notice.textContent = `New user ${name} was added to Supabase successfully.`;
        const accessNote = selectedStatus === 'Active' && selectedRole !== 'member' ? 'They can sign in on any device.' : 'Administration sign-in requires Active status and an Admin, Account, or Main admin role.';
        window.notify?.(`New user ${name} (${email}) has been added to the system. ${accessNote}`, 'success', 'New user added');
      } catch (err) {
        notice.textContent = err.message || 'Supabase could not create the account.';
        window.notify?.(err.message || 'Supabase could not create the account.', 'error', 'Account not created');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Add new user';
      }
      return;
    }
    if (resetMode) {
      window.notify?.('Password resets must be completed through the Supabase Auth administrator flow; this page will not save a browser-only password.', 'info', 'Secure password reset');
      return;
    }

    /* Approval is saved online FIRST. If that fails nothing changes, so the person is never shown as approved while still blocked. */
    if (approveMode) {
      try { await window.ChurchDB.decideRegistration({ email, approve: true, role: selectedRole, decidedBy: activeSession()?.email }); }
      catch (err) { window.notify?.(`Could not save the approval online: ${err.message || err}`, 'error', 'Approval not saved'); return; }
    }

    if (editingId && !approveMode && window.ChurchDB?.client) {
      const { error } = await window.ChurchDB.client.from('profiles').update({ name, email, role: selectedRole, status: selectedStatus }).eq('id', editingId);
      if (error) { window.notify?.(`Could not save the user in Supabase: ${error.message || error}`, 'error', 'User not saved'); return; }
    }

    if (editingId) {
      users = users.map(user => user.id === editingId ? { ...user, ...values } : user);
      if (editingId === 'user-main-admin') {
        try {
          const sess = JSON.parse(sessionStorage.getItem('church-auth-v1') || '{}');
          sessionStorage.setItem('church-auth-v1', JSON.stringify({ ...sess, email }));
        } catch (_) {}
      }

      if (approveMode) {
        notice.textContent = `User ${email} approved with role "${roleLabel}".`;
        // Clear pending registration notices for main admin and add approval notice for candidate
        try {
          const notices = readJson(noticesKey, []);
          const nextNotices = Array.isArray(notices) ? notices.filter(n => !(n.type === 'registration_request' && (n.data?.candidateId === editingId || n.data?.email === email))) : [];
          nextNotices.push({
            id: `n-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            userId: editingId,
            type: 'approved',
            title: 'Account Approved!',
            message: `Your account registration has been approved by the Main Admin with the role "${roleLabel}". You can now sign in and access the system.`,
            at: new Date().toISOString()
          });
          localStorage.setItem(noticesKey, JSON.stringify(nextNotices.slice(-100)));
          window.dispatchEvent(new CustomEvent('user-notices-change'));
        } catch (_) {}

        logActivity({
          action: 'user-approved',
          userId: editingId,
          userName: email.split('@')[0],
          role: selectedRole,
          summary: `Main Admin approved ${email} with role "${roleLabel}"`,
          data: { email, role: selectedRole }
        });

        window.notify?.(`User ${email} approved as ${roleLabel}!`, 'success', 'User Approved');
      } else {
        notice.textContent = 'User profile updated in Supabase.';
      }
    } else {
      values.id = (crypto.randomUUID ? crypto.randomUUID() : `user-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      values.lastLogin = '—';
      users.unshift(values);
      notice.textContent = 'User added to this browser.';
    }

    if (password) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`church-v1|${values.id || editingId}|${password}`));
      const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
      let stored = {}; try { stored = JSON.parse(localStorage.getItem(credentialsKey) || '{}'); } catch (_) {}
      stored[values.id || editingId] = hash;
      try { localStorage.setItem(credentialsKey, JSON.stringify(stored)); } catch (_) {}

      if (!approveMode) {
        const targetId = values.id || editingId, targetEmail = (users.find(u => u.id === targetId)?.email) || email, wasReset = resetMode;
        try {
          const notices = JSON.parse(localStorage.getItem(noticesKey) || '[]');
          const list = Array.isArray(notices) ? notices : [];
          list.push({ id: `n-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, userId: targetId, type: 'password', title: wasReset ? 'Your password was reset' : 'Your password was changed', message: `${wasReset ? 'The main admin reset' : 'The main admin changed'} your password on ${new Date().toLocaleString()}. Use the new password the next time you sign in. If you did not expect this, contact the main admin.`, at: new Date().toISOString() });
          localStorage.setItem(noticesKey, JSON.stringify(list.slice(-100)));
          window.dispatchEvent(new CustomEvent('user-notices-change'));
        } catch (_) {}
        window.notify?.(`Password saved for ${targetEmail}. They will see a notification.`, 'success', wasReset ? 'Password reset' : 'Password changed');
      }
    }

    persist();
    render();
    resetMode = false;
    approveMode = false;
    dialog.close();
  });

  rows.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const tr = button.closest('tr');
    const user = users.find(entry => entry.id === tr?.dataset.userId);
    if (!user) return;
    if (!window.ChurchAccess?.isMainAdmin()) { window.notify?.('Only the main admin can manage user accounts.', 'error', 'Main admin access needed'); return; }

    if (button.dataset.action === 'approve') {
      openDialog(user, false, true);
    }
    if (button.dataset.action === 'decline') {
      if (window.confirm(`Decline and remove registration request for ${user.email}?`)) {
        try { await window.ChurchDB.decideRegistration({ email: user.email, approve: false, decidedBy: activeSession()?.email }); }
        catch (err) { if (!/No online account/i.test(String(err.message || err))) { window.notify?.(`Could not save the decision online: ${err.message || err}`, 'error', 'Decline not saved'); return; } }
        users = users.filter(entry => entry.id !== user.id);
        let stored = {}; try { stored = JSON.parse(localStorage.getItem(credentialsKey) || '{}'); } catch (_) {}
        delete stored[user.id];
        try { localStorage.setItem(credentialsKey, JSON.stringify(stored)); } catch (_) {}
        // Remove pending notices
        try {
          const notices = readJson(noticesKey, []);
          const filtered = Array.isArray(notices) ? notices.filter(n => !(n.data?.candidateId === user.id || n.data?.email === user.email)) : [];
          localStorage.setItem(noticesKey, JSON.stringify(filtered));
          window.dispatchEvent(new CustomEvent('user-notices-change'));
        } catch (_) {}
        logActivity({ action: 'user-registration-declined', userId: user.id, userName: user.email.split('@')[0], summary: `Main Admin declined registration for ${user.email}`, data: { email: user.email } });
        persist(); render();
        window.notify?.(`Registration request for ${user.email} declined.`, 'info', 'Registration Declined');
      }
    }
    if (button.dataset.action === 'edit') openDialog(user);
    if (button.dataset.action === 'reset-password' && (user.role === 'admin' || user.role === 'account' || user.role === 'main-admin')) openDialog(user, true);
    if (button.dataset.action === 'delete' && !user.current) {
      window.notify?.('Account deletion is disabled here because removing a profile does not revoke its Supabase Auth account. Use the secure Auth administrator flow.', 'info', 'Account not deleted');
    }
  });

  window.addEventListener('storage', e => {
    if (e.key === storageKey) {
      try {
        const val = JSON.parse(e.newValue);
        if (Array.isArray(val)) { users = val; render(); }
      } catch (_) {}
    }
  });

  async function loadCloudUsers() {
    const client = window.ChurchDB?.client;
    if (!client) return;
    try {
      const { data, error } = await client.from('profiles').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      const current = activeSession();
      users = (data || []).map(profile => ({
        id: profile.id,
        email: profile.email,
        name: profile.name || String(profile.email || '').split('@')[0],
        role: profile.role || 'member',
        status: profile.status || 'Active',
        lastLogin: profile.last_login || '—',
        photo: profile.photo_url || ''
      }));
      if (current?.id && !users.some(user => user.id === current.id)) users.unshift({ ...current, lastLogin: '—' });
      render();
    } catch (error) {
      notice.textContent = `Could not load users from Supabase: ${error.message || error}`;
    }
  }
  render();
  setTimeout(loadCloudUsers, 700);
  window.addEventListener('online', loadCloudUsers);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadCloudUsers(); });

  /* ---- Registration requests (online): the Main Admin receives them immediately, on any device ---- */
  const seenKey = 'church-seen-registrations-v1';
  const readSeen = () => { const v = readJson(seenKey, []); return Array.isArray(v) ? v : []; };
  function updateBadge() {
    const n = users.filter(user => String(user.status).toLowerCase() === 'pending').length;
    const link = document.querySelector('.nav a[href="#users"]'); if (!link) return;
    let badge = link.querySelector('.nav-badge');
    if (!n) { if (badge) badge.remove(); return; }
    if (!badge) { badge = document.createElement('span'); badge.className = 'nav-badge'; link.append(badge); }
    badge.textContent = String(n); badge.setAttribute('aria-label', `${n} registration${n === 1 ? '' : 's'} waiting for approval`);
  }
  function announce(request) {
    const me = activeSession(); if (!me?.id) return;
    const text = `${request.name || request.email} (${request.email}) has registered. Open Users to approve and assign a role.`;
    try {
      const list = readJson(noticesKey, []); const arr = Array.isArray(list) ? list : [];
      arr.unshift({ id: `n-reg-${request.id}`, userId: me.id, type: 'registration_request', title: 'New registration waiting for approval', message: text, at: request.created_at || new Date().toISOString(), data: { candidateId: request.user_id, email: request.email, name: request.name } });
      localStorage.setItem(noticesKey, JSON.stringify(arr.slice(0, 100)));
      window.dispatchEvent(new CustomEvent('user-notices-change'));
    } catch (_) {}
  }
  let pulling = false;
  async function pullRegistrations() {
    if (pulling || !window.ChurchAccess?.isMainAdmin() || !window.ChurchDB?.client) return;
    pulling = true;
    try {
      const requests = await window.ChurchDB.listRegistrationRequests();
      const seen = readSeen(); let changed = false;
      requests.forEach(request => {
        const email = String(request.email || '').toLowerCase();
        const existing = users.find(user => String(user.email).toLowerCase() === email);
        const pending = existing && String(existing.status).toLowerCase() === 'pending';
        if (request.status === 'Pending') {
          if (!existing) { users.unshift({ id: request.user_id || request.id, email, name: request.name || email.split('@')[0], role: 'member', status: 'Pending', lastLogin: '—', registeredAt: request.created_at, requestId: request.id }); changed = true; }
          if (!seen.includes(request.id)) { seen.push(request.id); announce(request); }
        } else {
          if (request.status === 'Approved' && pending) { existing.role = request.role || existing.role; existing.status = 'Active'; changed = true; }
          if (request.status === 'Declined' && pending) { users = users.filter(user => user !== existing); changed = true; }
          if (!seen.includes(request.id)) seen.push(request.id);
        }
      });
      try { localStorage.setItem(seenKey, JSON.stringify(seen.slice(-300))); } catch (_) {}
      if (changed) { persist(); render(); }
      updateBadge();
    } catch (err) { console.info('[Registrations]', err && err.message); }
    finally { pulling = false; }
  }
  window.pullRegistrations = pullRegistrations;
  updateBadge();
  setTimeout(pullRegistrations, 900);
  setInterval(pullRegistrations, 45000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullRegistrations(); });
  window.addEventListener('online', pullRegistrations);
  if (window.ChurchDB?.watchRegistrations) window.ChurchDB.watchRegistrations(pullRegistrations);     /* instant delivery */
})();
