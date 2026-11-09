/* Ministry dues: an admin records payments against members already registered to a department. */
    (() => {
      const STORE = 'church-ministry-dues-v1';
      const f = id => document.getElementById(id);
      const tabs = { church: f('church-dues-tab'), ministry: f('ministry-dues-tab') };
      const views = { church: f('church-dues-view'), ministry: f('ministry-dues-view') };
      const departmentNames = ['Choir', 'Lactating Mothers', 'Left Back Seat', "Men's Fellowship", 'Middle Seat', 'Right Back Seat', 'Sunday School', "The Minister's Wife", "Women's Fellowship", "Children's Fellowship", 'Youth Fellowship', 'Evangelism', 'Welfare'];
      let dues = [];
      try { const saved = JSON.parse(localStorage.getItem(STORE) || '[]'); if (Array.isArray(saved)) dues = saved; } catch (_) {}
      let editingId = null;
      const today = () => new Date().toISOString().slice(0, 10);
      const monthNow = () => today().slice(0, 7);
      const money = value => `GH₵${Number(value || 0).toFixed(2)}`;
      const isAdmin = () => window.ChurchAccess?.canRecordDues ? window.ChurchAccess.canRecordDues() : true;   /* admins and Account users may record dues */
      const members = () => { if (Array.isArray(window.churchMembers)) return window.churchMembers; try { const value = JSON.parse(localStorage.getItem('church-members-v1') || '[]'); return Array.isArray(value) ? value : []; } catch (_) { return []; } };
      const departments = () => { const names = new Set(departmentNames); try { const value = JSON.parse(localStorage.getItem('church-departments-v1') || '[]'); if (Array.isArray(value)) value.forEach(d => d?.name && names.add(d.name)); } catch (_) {} members().forEach(m => m.department && names.add(m.department)); dues.forEach(d => d.department && names.add(d.department)); return [...names].sort((a, b) => a.localeCompare(b)); };
      const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(dues)); window.dispatchEvent(new CustomEvent('dues-change')); } catch (_) { notify('Payments work for this session but could not be saved in browser storage.', 'error'); } };
      const currentMember = () => members().find(m => m.id === f('ministry-due-member').value);

      function fillDepartments() {
        const names = departments();
        ['ministry-due-department', 'ministry-record-department'].forEach(id => {
          const select = f(id), keep = select.value, first = select.options[0];
          [...select.options].slice(1).forEach(o => o.remove());
          names.forEach(name => select.add(new Option(name, name)));
          select.value = [...select.options].some(o => o.value === keep) ? keep : first.value;
        });
        fillMembers(); render();
      }
      function fillMembers() {
        const department = f('ministry-due-department').value, select = f('ministry-due-member'), keep = select.value;
        select.replaceChildren(new Option(department ? 'Choose a registered member' : 'Choose a department first', ''));
        const available = members().filter(m => department && window.memberDepartments(m).includes(department)).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        available.forEach(m => select.add(new Option(`${m.name} · ${m.id}`, m.id)));
        select.disabled = !department || !available.length;
        select.value = available.some(m => m.id === keep) ? keep : '';
        updateMemberSummary();
      }
      function updateMemberSummary() {
        const box = f('ministry-member-summary'), member = currentMember(); box.replaceChildren();
        if (!member) { const span = document.createElement('span'); span.textContent = 'Choose a department and registered member to view details.'; box.append(span); return; }
        const name = document.createElement('strong'); name.textContent = member.name; box.append(name);
        [['Member ID', member.id], ['Department', member.department || '—'], ['Phone', member.phone || 'Not provided'], ['Status', member.status || '—']].forEach(([label, value]) => { const span = document.createElement('span'); span.textContent = `${label}: ${value}`; box.append(span); });
      }
      function renderStats() {
        const selected = f('ministry-record-department').value, currentMonth = monthNow();
        const total = dues.reduce((sum, d) => sum + Number(d.amount || 0), 0), filtered = selected ? dues.filter(d => d.department === selected) : dues;
        const monthRows = dues.filter(d => d.month === currentMonth);
        f('ministry-total').textContent = money(total); f('ministry-payment-count').textContent = `${dues.length} ${dues.length === 1 ? 'payment' : 'payments'}`;
        f('ministry-department-total').textContent = money(filtered.reduce((sum, d) => sum + Number(d.amount || 0), 0)); f('ministry-department-count').textContent = selected || 'All departments';
        f('ministry-month-total').textContent = money(monthRows.reduce((sum, d) => sum + Number(d.amount || 0), 0)); f('ministry-month-count').textContent = `${monthRows.length} ${monthRows.length === 1 ? 'payment' : 'payments'}`;
      }
      function render() {
        const department = f('ministry-record-department').value, month = f('ministry-record-month').value, query = f('ministry-record-search').value.trim().toLowerCase();
        const visible = dues.filter(d => (!department || d.department === department) && (!month || d.month === month) && (!query || `${d.memberName} ${d.memberId} ${d.department} ${d.recordedBy?.name || ''} ${d.recordedBy?.email || ''}`.toLowerCase().includes(query)));
        const rows = f('ministry-due-rows'); rows.replaceChildren();
        if (!visible.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 9; td.style.cssText = 'text-align:center;color:var(--muted)'; td.textContent = 'No ministry payments recorded yet.'; tr.append(td); rows.append(tr); }
        visible.slice().sort((a, b) => `${b.paidOn}${b.id}`.localeCompare(`${a.paidOn}${a.id}`)).forEach(d => {
          const tr = document.createElement('tr'); tr.dataset.dueId = d.id;
          const cell = value => { const td = document.createElement('td'); td.textContent = value || '—'; return td; };
          const person = document.createElement('strong'); person.textContent = `${d.memberName} (${d.memberId})`;
          const memberCell = document.createElement('td'); memberCell.append(person); tr.append(memberCell, cell(d.department), cell(money(d.amount)), cell(d.paidOn), cell(d.month), cell(d.method + (d.momoTxn ? ` · ${d.momoTxn}` : '')), cell(d.note), cell(d.recordedBy ? `${d.recordedBy.name}${d.recordedBy.role === 'main-admin' ? ' (Main admin)' : ''}` : 'Not recorded'));
          const actions = document.createElement('div'); actions.className = 'row-actions'; const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.action = 'edit'; edit.textContent = 'Edit'; const del = document.createElement('button'); del.type = 'button'; del.dataset.action = 'delete'; del.className = 'delete'; del.textContent = 'Delete'; actions.append(edit, del); const actionCell = document.createElement('td'); if (window.ChurchAccess?.canManageDue ? window.ChurchAccess.canManageDue(d) : true) actionCell.append(actions); else actionCell.textContent = '—'; tr.append(actionCell); rows.append(tr);
        });
        f('ministry-record-count').textContent = `${visible.length} ${visible.length === 1 ? 'record' : 'records'}${visible.length !== dues.length ? ` of ${dues.length}` : ''}`; renderStats();
      }
      function showView(kind) {
        const ministry = kind === 'ministry'; views.church.hidden = ministry; views.ministry.hidden = !ministry; tabs.church.className = ministry ? 'outline-link' : 'primary-button'; tabs.ministry.className = ministry ? 'primary-button' : 'outline-link'; tabs.church.setAttribute('aria-selected', String(!ministry)); tabs.ministry.setAttribute('aria-selected', String(ministry));
        f('dues-page-title').textContent = ministry ? 'Ministry dues' : 'Church dues'; f('dues-page-description').textContent = ministry ? 'Record payments for members registered to each ministry department.' : 'General church dues recorded by the administrator in charge.'; f('church-due-record').hidden = false; f('church-due-record').textContent = ministry ? '＋ Record ministry due' : '＋ Record due'; if (ministry) { fillDepartments(); window.scrollTo(0, 0); }
      }
      function prepare(due) {
        editingId = due?.id || null; f('ministry-due-error').textContent = ''; f('ministry-due-department').value = due?.department || ''; fillMembers(); f('ministry-due-member').value = due?.memberId || ''; f('ministry-due-amount').value = due?.amount || ''; f('ministry-due-date').value = due?.paidOn || today(); f('ministry-due-month').value = due?.month || monthNow(); f('ministry-due-method').value = due?.method || 'Cash'; f('ministry-due-note').value = due?.note || ''; updateMemberSummary(); f('ministry-due-amount').focus();
      }
      tabs.church.addEventListener('click', () => showView('church')); tabs.ministry.addEventListener('click', () => showView('ministry')); f('church-due-record').addEventListener('click', () => { const ministry = !f('ministry-dues-view').hidden; showView(ministry ? 'ministry' : 'church'); const dialog = f(ministry ? 'ministry-due-dialog' : 'church-due-dialog'); if (dialog && !dialog.open) dialog.showModal(); setTimeout(() => f(ministry ? 'ministry-due-department' : 'church-due-member').focus(), 0); });
      f('ministry-due-department').addEventListener('change', fillMembers); f('ministry-due-member').addEventListener('change', updateMemberSummary);
      f('ministry-due-form').addEventListener('submit', event => { event.preventDefault(); f('ministry-due-error').textContent = ''; if (!isAdmin()) { f('ministry-due-error').textContent = 'Only an admin can record ministry dues.'; notify('Only an admin can record ministry dues.', 'error', 'Admin access needed'); return; } const member = currentMember(), amount = Number(f('ministry-due-amount').value); if (!member) { f('ministry-due-error').textContent = 'Choose a registered member from the selected department.'; return; } if (!(amount > 0)) { f('ministry-due-error').textContent = 'Enter an amount greater than zero.'; return; } const values = { memberId: member.id, memberName: member.name, department: member.department, amount: amount.toFixed(2), paidOn: f('ministry-due-date').value || today(), month: f('ministry-due-month').value || monthNow(), method: f('ministry-due-method').value, note: f('ministry-due-note').value.trim(), ...(window.MomoPay ? window.MomoPay.collect('ministry') : {}) }; if (editingId) { dues = dues.map(d => d.id === editingId ? { ...d, ...values, editedBy: window.ChurchAccess?.recorder?.() || null, editedAt: new Date().toISOString() } : d); notify(`${member.name}'s ministry due updated.`, 'success'); } else { dues.push({ id: `md-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date().toISOString(), recordedBy: window.ChurchAccess?.recorder?.() || null, ...values }); notify(`${member.name}'s ministry due of ${money(amount)} recorded.`, 'success'); } persist(); editingId = null; f('ministry-due-form').reset(); f('ministry-due-date').value = today(); f('ministry-due-month').value = monthNow(); f('ministry-due-member').disabled = true; f('ministry-member-summary').innerHTML = '<span>Choose a department and registered member to view details.</span>'; render(); });
      f('ministry-due-clear').addEventListener('click', () => { editingId = null; f('ministry-due-form').reset(); f('ministry-due-date').value = today(); f('ministry-due-month').value = monthNow(); fillMembers(); });
      ['ministry-record-department', 'ministry-record-month', 'ministry-record-search'].forEach(id => f(id).addEventListener('input', render)); f('ministry-record-reset').addEventListener('click', () => { f('ministry-record-department').value = ''; f('ministry-record-month').value = ''; f('ministry-record-search').value = ''; render(); });
      f('ministry-due-rows').addEventListener('click', event => { const button = event.target.closest('button[data-action]'), due = dues.find(d => d.id === button?.closest('tr')?.dataset.dueId); if (!due) return; if (window.ChurchAccess?.canManageDue && !window.ChurchAccess.canManageDue(due)) return; if (button.dataset.action === 'edit') { showView('ministry'); prepare(due); const dialog = f('ministry-due-dialog'); if (dialog && !dialog.open) dialog.showModal(); } if (button.dataset.action === 'delete' && isAdmin() && window.confirm(`Delete the ministry due recorded for ${due.memberName}?`)) { dues = dues.filter(d => d.id !== due.id); persist(); render(); notify('Ministry due deleted.', 'success'); } });
      window.addEventListener('members-change', () => { fillMembers(); render(); }); window.addEventListener('departments-change', fillDepartments); window.addEventListener('department-renamed', e => { dues = dues.map(d => d.department === e.detail.from ? { ...d, department: e.detail.to } : d); persist(); fillDepartments(); });
      function reloadMinistryDues() {
        try {
          const saved = JSON.parse(localStorage.getItem(STORE) || '[]');
          if (Array.isArray(saved)) { dues = saved; render(); }
        } catch (_) {}
      }
      window.addEventListener('dues-change', reloadMinistryDues);
      window.addEventListener('storage', e => { if (e.key === STORE) reloadMinistryDues(); });
      f('ministry-due-date').value = today(); f('ministry-due-month').value = monthNow(); fillDepartments(); showView('church');
    })();

/* Church dues: general payments recorded against any registered member. */
    (() => {
      const STORE = 'church-general-dues-v1', f = id => document.getElementById(id);
      let dues = [], editingId = null;
      try { const saved = JSON.parse(localStorage.getItem(STORE) || '[]'); if (Array.isArray(saved)) dues = saved; } catch (_) {}
      const today = () => new Date().toISOString().slice(0, 10), monthNow = () => today().slice(0, 7);
      const money = value => `GH₵${Number(value || 0).toFixed(2)}`;
      const members = () => { if (Array.isArray(window.churchMembers)) return window.churchMembers; try { const value = JSON.parse(localStorage.getItem('church-members-v1') || '[]'); return Array.isArray(value) ? value : []; } catch (_) { return []; } };
      const isAdmin = () => window.ChurchAccess?.canRecordDues ? window.ChurchAccess.canRecordDues() : true;   /* admins and Account users may record dues */
      const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(dues)); window.dispatchEvent(new CustomEvent('dues-change')); } catch (_) { notify('Payments work for this session but could not be saved in browser storage.', 'error'); } };
      const selectedMember = () => members().find(m => m.id === f('church-due-member').value);
      const allDepartmentNames = ['Choir', 'Lactating Mothers', 'Left Back Seat', "Men's Fellowship", 'Middle Seat', 'Right Back Seat', 'Sunday School', "The Minister's Wife", "Women's Fellowship", "Children's Fellowship", 'Youth Fellowship', 'Evangelism', 'Welfare'];
      function departmentNames() { const names = new Set(allDepartmentNames); try { const value = JSON.parse(localStorage.getItem('church-departments-v1') || '[]'); if (Array.isArray(value)) value.forEach(d => d?.name && names.add(d.name)); } catch (_) {} members().forEach(m => m.department && names.add(m.department)); dues.forEach(d => d.department && names.add(d.department)); return [...names].sort((a, b) => a.localeCompare(b)); }
      function fillDepartments() {
        ['church-due-department', 'church-record-department'].forEach(id => { const select = f(id), keep = select.value, first = select.options[0]; [...select.options].slice(1).forEach(o => o.remove()); departmentNames().forEach(name => select.add(new Option(name, name))); select.value = [...select.options].some(o => o.value === keep) ? keep : first.value; });
      }
      function fillMembers() {
        const department = f('church-due-department').value, select = f('church-due-member'), keep = select.value; select.replaceChildren(new Option('Choose a registered member', ''));
        members().filter(m => !department || window.memberDepartments(m).includes(department)).sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(m => select.add(new Option(`${m.name} · ${m.id}`, m.id)));
        select.value = [...select.options].some(o => o.value === keep) ? keep : ''; updateSummary();
      }
      function updateSummary() { const box = f('church-member-summary'), member = selectedMember(); box.replaceChildren(); if (!member) { const span = document.createElement('span'); span.textContent = 'Choose a registered member to view details.'; box.append(span); return; } const name = document.createElement('strong'); name.textContent = member.name; box.append(name); [['Member ID', member.id], ['Department', member.department || 'Not assigned'], ['Phone', member.phone || 'Not provided'], ['Status', member.status || '—']].forEach(([label, value]) => { const span = document.createElement('span'); span.textContent = `${label}: ${value}`; box.append(span); }); }
      function stats() { const current = monthNow(), monthRows = dues.filter(d => d.month === current); f('church-total').textContent = money(dues.reduce((sum, d) => sum + Number(d.amount || 0), 0)); f('church-payment-count').textContent = `${dues.length} ${dues.length === 1 ? 'payment' : 'payments'}`; f('church-month-total').textContent = money(monthRows.reduce((sum, d) => sum + Number(d.amount || 0), 0)); f('church-month-count').textContent = `${monthRows.length} ${monthRows.length === 1 ? 'payment' : 'payments'}`; f('church-member-count').textContent = new Set(dues.map(d => d.memberId)).size; }
      function render() {
        const department = f('church-record-department').value, month = f('church-record-month').value, query = f('church-record-search').value.trim().toLowerCase();
        const visible = dues.filter(d => (!department || d.department === department) && (!month || d.month === month) && (!query || `${d.memberName} ${d.memberId} ${d.department} ${d.recordedBy?.name || ''} ${d.recordedBy?.email || ''}`.toLowerCase().includes(query)));
        const rows = f('church-due-rows'); rows.replaceChildren();
        if (!visible.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 9; td.style.cssText = 'text-align:center;color:var(--muted)'; td.textContent = 'No church payments recorded yet.'; tr.append(td); rows.append(tr); }
        visible.slice().sort((a, b) => `${b.paidOn}${b.id}`.localeCompare(`${a.paidOn}${a.id}`)).forEach(d => { const tr = document.createElement('tr'); tr.dataset.dueId = d.id; const cell = value => { const td = document.createElement('td'); td.textContent = value || '—'; return td; }; const person = document.createElement('strong'); person.textContent = `${d.memberName} (${d.memberId})`; const memberCell = document.createElement('td'); memberCell.append(person); tr.append(memberCell, cell(d.department), cell(money(d.amount)), cell(d.paidOn), cell(d.month), cell(d.method + (d.momoTxn ? ` · ${d.momoTxn}` : '')), cell(d.note), cell(d.recordedBy ? `${d.recordedBy.name}${d.recordedBy.role === 'main-admin' ? ' (Main admin)' : ''}` : 'Not recorded')); const actions = document.createElement('div'); actions.className = 'row-actions'; const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.action = 'edit'; edit.textContent = 'Edit'; const del = document.createElement('button'); del.type = 'button'; del.dataset.action = 'delete'; del.className = 'delete'; del.textContent = 'Delete'; actions.append(edit, del); const actionCell = document.createElement('td'); if (window.ChurchAccess?.canManageDue ? window.ChurchAccess.canManageDue(d) : true) actionCell.append(actions); else actionCell.textContent = '—'; tr.append(actionCell); rows.append(tr); });
        f('church-record-count').textContent = `${visible.length} ${visible.length === 1 ? 'record' : 'records'}${visible.length !== dues.length ? ` of ${dues.length}` : ''}`; stats();
      }
      f('church-due-department').addEventListener('change', fillMembers); f('church-due-member').addEventListener('change', updateSummary);
      f('church-due-form').addEventListener('submit', event => { event.preventDefault(); f('church-due-error').textContent = ''; if (!isAdmin()) { f('church-due-error').textContent = 'Only an admin can record church dues.'; notify('Only an admin can record church dues.', 'error', 'Admin access needed'); return; } const member = selectedMember(), amount = Number(f('church-due-amount').value); if (!member) { f('church-due-error').textContent = 'Choose a registered member.'; return; } if (!(amount > 0)) { f('church-due-error').textContent = 'Enter an amount greater than zero.'; return; } const values = { memberId: member.id, memberName: member.name, department: (f('church-due-department').value && window.memberDepartments(member).includes(f('church-due-department').value)) ? f('church-due-department').value : (member.department || ''), amount: amount.toFixed(2), paidOn: f('church-due-date').value || today(), month: f('church-due-month').value || monthNow(), method: f('church-due-method').value, note: f('church-due-note').value.trim(), ...(window.MomoPay ? window.MomoPay.collect('church') : {}) }; if (editingId) { dues = dues.map(d => d.id === editingId ? { ...d, ...values, editedBy: window.ChurchAccess?.recorder?.() || null, editedAt: new Date().toISOString() } : d); notify(`${member.name}'s church due updated.`, 'success'); } else { dues.push({ id: `cd-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date().toISOString(), recordedBy: window.ChurchAccess?.recorder?.() || null, ...values }); notify(`${member.name}'s church due of ${money(amount)} recorded.`, 'success'); } persist(); editingId = null; f('church-due-form').reset(); f('church-due-date').value = today(); f('church-due-month').value = monthNow(); fillMembers(); render(); });
      f('church-due-clear').addEventListener('click', () => { editingId = null; f('church-due-error').textContent = ''; f('church-due-form').reset(); f('church-due-date').value = today(); f('church-due-month').value = monthNow(); fillMembers(); });
      ['church-record-department', 'church-record-month', 'church-record-search'].forEach(id => f(id).addEventListener('input', render)); f('church-record-reset').addEventListener('click', () => { f('church-record-department').value = ''; f('church-record-month').value = ''; f('church-record-search').value = ''; render(); });
      f('church-due-rows').addEventListener('click', event => { const button = event.target.closest('button[data-action]'), due = dues.find(d => d.id === button?.closest('tr')?.dataset.dueId); if (!due) return; if (window.ChurchAccess?.canManageDue && !window.ChurchAccess.canManageDue(due)) return; if (button.dataset.action === 'edit') { editingId = due.id; f('church-due-error').textContent = ''; f('church-due-department').value = due.department || ''; fillMembers(); f('church-due-member').value = due.memberId; updateSummary(); f('church-due-amount').value = due.amount; f('church-due-date').value = due.paidOn; f('church-due-month').value = due.month; f('church-due-method').value = due.method; f('church-due-note').value = due.note || ''; const dialog = f('church-due-dialog'); if (dialog && !dialog.open) dialog.showModal(); f('church-due-amount').focus(); } if (button.dataset.action === 'delete' && isAdmin() && window.confirm(`Delete the church due recorded for ${due.memberName}?`)) { dues = dues.filter(d => d.id !== due.id); persist(); render(); notify('Church due deleted.', 'success'); } });
      window.addEventListener('members-change', () => { fillDepartments(); fillMembers(); render(); }); window.addEventListener('department-renamed', e => { dues = dues.map(d => d.department === e.detail.from ? { ...d, department: e.detail.to } : d); persist(); fillDepartments(); render(); });
      function reloadChurchDues() {
        try {
          const saved = JSON.parse(localStorage.getItem(STORE) || '[]');
          if (Array.isArray(saved)) { dues = saved; render(); }
        } catch (_) {}
      }
      window.addEventListener('dues-change', reloadChurchDues);
      window.addEventListener('storage', e => { if (e.key === STORE) reloadChurchDues(); });
      f('church-due-date').value = today(); f('church-due-month').value = monthNow(); fillDepartments(); fillMembers(); render();
    })();

(() => {
      const dialog = document.getElementById('church-due-dialog');
      if (!dialog) return;
      document.getElementById('church-due-dialog-close')?.addEventListener('click', () => dialog.close());
      document.getElementById('church-due-cancel')?.addEventListener('click', () => dialog.close());
      document.getElementById('church-due-form')?.addEventListener('submit', () => setTimeout(() => { if (dialog.open && !document.getElementById('church-due-error')?.textContent.trim()) dialog.close(); }, 0));
      document.getElementById('church-due-rows')?.addEventListener('click', event => {
        if (!event.target.closest('button[data-action="edit"]')) return;
        setTimeout(() => { if (!dialog.open) dialog.showModal(); }, 0);
      });
    })();

(() => {
      const dialog = document.getElementById('ministry-due-dialog');
      if (!dialog) return;
      document.getElementById('ministry-due-dialog-close')?.addEventListener('click', () => dialog.close());
      document.getElementById('ministry-due-cancel')?.addEventListener('click', () => dialog.close());
      document.getElementById('ministry-due-form')?.addEventListener('submit', () => setTimeout(() => { if (dialog.open && !document.getElementById('ministry-due-error')?.textContent.trim()) dialog.close(); }, 0));
      document.getElementById('ministry-due-rows')?.addEventListener('click', event => {
        if (!event.target.closest('button[data-action="edit"]')) return;
        setTimeout(() => { if (!dialog.open) dialog.showModal(); }, 0);
      });
    })();

/* Dues recorded by admins: summary shown to the main admin on the dashboard. */
    (() => {
      const read = key => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
      const money = v => `GH₵${Number(v || 0).toFixed(2)}`;
      const row = (left, right, sub) => { const d = document.createElement('div'); d.className = 'dues-recorder-row'; const a = document.createElement('span'); a.textContent = left; if (sub) { const s = document.createElement('small'); s.textContent = sub; a.append(s); } const b = document.createElement('strong'); b.textContent = right; d.append(a, b); return d; };
      function render() {
        const list = document.getElementById('dash-dues-recorder-list'), latest = document.getElementById('dash-dues-latest');
        if (!list || !latest || !window.ChurchAccess?.isMainAdmin?.()) return;
        const month = new Date().toISOString().slice(0, 7);
        const all = [...read('church-general-dues-v1').map(d => ({ ...d, kind: 'Church' })), ...read('church-ministry-dues-v1').map(d => ({ ...d, kind: 'Ministry' }))];
        const groups = new Map();
        all.filter(d => (d.month || String(d.paidOn || '').slice(0, 7)) === month).forEach(d => {
          const key = d.recordedBy?.id || 'none', g = groups.get(key) || { name: d.recordedBy ? d.recordedBy.name : 'Not recorded', count: 0, total: 0 };
          g.count++; g.total += Number(d.amount || 0); groups.set(key, g);
        });
        list.replaceChildren(); latest.replaceChildren();
        if (!groups.size) { const p = document.createElement('p'); p.className = 'small-stat'; p.textContent = 'No dues recorded this month.'; list.append(p); }
        [...groups.values()].sort((a, b) => b.total - a.total).forEach(g => list.append(row(g.name, money(g.total), `${g.count} ${g.count === 1 ? 'payment' : 'payments'}`)));
        all.sort((a, b) => String(b.createdAt || b.paidOn).localeCompare(String(a.createdAt || a.paidOn))).slice(0, 5).forEach(d => latest.append(row(`${d.memberName} · ${d.kind} dues`, money(d.amount), `by ${d.recordedBy ? d.recordedBy.name : 'unknown'} · ${d.paidOn || ''}`)));
        if (!all.length) { const p = document.createElement('p'); p.className = 'small-stat'; p.textContent = 'Nothing recorded yet.'; latest.append(p); }
      }
      document.addEventListener('DOMContentLoaded', render);
      window.addEventListener('dues-change', render);
      window.addEventListener('storage', render);
    })();

/* Logs who recorded, changed or deleted a dues payment (Church dues and Ministry dues) to the Activity log. */
    (() => {
      const KEY = 'church-activity-v1', STORES = { church: ['church-general-dues-v1', 'Church dues'], ministry: ['church-ministry-dues-v1', 'Ministry dues'] };
      const readList = key => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
      const snap = {}; const take = () => { for (const k in STORES) snap[k] = new Map(readList(STORES[k][0]).map(d => [d.id, d])); };
      const log = entry => { try { const list = readList(KEY); list.push({ id: `a-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), entity: 'due', ...entry }); localStorage.setItem(KEY, JSON.stringify(list.slice(-500))); } catch (_) {} };
      const money = v => `GH₵${Number(v || 0).toFixed(2)}`;
      function onChange() {
        const who = window.ChurchAccess?.recorder?.() || {};
        for (const [kind, [key, label]] of Object.entries(STORES)) {
          const before = snap[kind] || new Map(), now = readList(key), ids = new Set();
          const describe = (d, verb) => ({ userId: who.id, userName: who.name, role: who.role, summary: `${verb} ${label.toLowerCase()} payment of ${money(d.amount)} for ${d.memberName || 'a member'}`, data: { kind: label, member: d.memberName, memberId: d.memberId, department: d.department, amount: d.amount, month: d.month, paidOn: d.paidOn, method: d.method } });
          now.forEach(d => { ids.add(d.id); if (!before.has(d.id)) log({ action: 'create', ...describe(d, 'Recorded') }); else if (JSON.stringify(before.get(d.id)) !== JSON.stringify(d)) log({ action: 'update', ...describe(d, 'Updated') }); });
          before.forEach((d, id) => { if (!ids.has(id)) log({ action: 'delete', ...describe(d, 'Deleted') }); });
        }
        take(); window.dispatchEvent(new CustomEvent('activity-change'));
      }
      take();
      window.addEventListener('dues-change', onChange);
    })();
    /* Short explanation under the Role field. */
    (() => {
      const sel = document.getElementById('user-role'), hint = document.getElementById('user-role-hint'); if (!sel || !hint) return;
      const TEXT = { member: 'Member accounts cannot sign in to the administration system.', admin: 'Can manage church records and record dues, but not users or settings.', account: 'Can only open Church dues and Ministry dues, record daily payments, and see their own activity logged.', 'main-admin': 'Full access to everything, including users and settings.' };
      const show = () => { hint.textContent = TEXT[sel.value] || ''; };
      sel.addEventListener('change', show); document.getElementById('user-add')?.addEventListener('click', () => setTimeout(show, 0)); document.getElementById('user-rows')?.addEventListener('click', () => setTimeout(show, 0)); show();
    })();
