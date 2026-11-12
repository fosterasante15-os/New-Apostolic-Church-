/* Attendance: roster is built from every registered member (Members page), filtered by department and search. */
    (() => {
      const KEY = 'church-attendance-v1', MEMBERS = 'church-members-v1';
      const $ = id => document.getElementById(id);
      const body = $('attendance-rows'); if (!body) return;
      const eventSel = $('attendance-event'), calendarButton = $('attendance-calendar-button'), calendar = $('attendance-calendar'), deptSel = $('attendance-department'), search = $('attendance-search'), summary = $('attendance-summary');
      const STATUSES = ['present', 'late', 'absent', 'excused'];
      let draft = {}, draftKey = null;
      const draftChanges = new Set();

      const readAll = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (_) { return {}; } };
      const readMembers = () => { try { const v = JSON.parse(localStorage.getItem(MEMBERS)); return Array.isArray(v) ? v.filter(m => m && typeof m === 'object' && !Array.isArray(m)) : []; } catch (_) { return []; } };
      function members() {
        let list = [];
        if (Array.isArray(window.churchMembers)) list = window.churchMembers;
        else list = readMembers();
        return list.filter(m => m.status !== 'Gone Soul');          /* Gone Souls are not on the attendance roster */
      }
      const serviceKey = () => eventSel ? eventSel.value : '';
      function loadDraft() { draftKey = serviceKey(); const value = readAll()[draftKey]; draft = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}; draftChanges.clear(); }
      function mergeDraftFromCloud() {
        if (serviceKey() !== draftKey) { loadDraft(); return; }
        const saved = readAll()[draftKey];
        const next = saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...saved } : {};
        draftChanges.forEach(id => { if (draft[id]) next[id] = draft[id]; });
        draft = next;
      }
      const statusOf = id => draft[id] || 'present';
      function syncCalendarToService() {
        if (calendar) calendar.value = (serviceKey().split(' · ')[0] || '');
      }
      function chooseServiceForDate(date) {
        if (!date || !eventSel) return;
        const option = [...eventSel.options].find(candidate => candidate.value.startsWith(`${date} · `));
        if (!option) {
          window.notify && window.notify(`No Sunday service is scheduled for ${date}. Add a service first, then return to Attendance.`, 'error', 'No service found');
          return;
        }
        eventSel.value = option.value; loadDraft(); render(); window.notify && window.notify(`Roster loaded for ${date}.`, 'info');
      }

      function updateSummary(list) {
        const c = { present: 0, late: 0, absent: 0, excused: 0 };
        list.forEach(m => { c[statusOf(m.id)]++; });
        const saved = readAll()[draftKey] ? ' · saved before' : '';
        const gn = guestsFor(draftKey).length;
        summary.textContent = `${list.length} member${list.length === 1 ? '' : 's'} shown · Present ${c.present} · Late ${c.late} · Absent ${c.absent} · Excused ${c.excused} · Guests ${gn}${saved}`;
      }

      function visible() {
        const dept = deptSel ? deptSel.value : 'All members', q = (search.value || '').trim().toLowerCase();
        return members().filter(m => (dept === 'All members' || window.memberDepartments(m).includes(dept)) && (!q || [m.name, m.id].some(v => (v || '').toLowerCase().includes(q))))
          .slice().sort((x, y) => (x.name || '').localeCompare(y.name || ''));
      }

      function render() {
        renderGuests();
        if (serviceKey() !== draftKey) loadDraft();
        const list = visible(); body.replaceChildren();
        if (!list.length) {
          const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 5; td.style.padding = '22px'; td.className = 'quick-note';
          td.textContent = members().length ? 'No members match this department or search.' : 'No members registered yet. Add members on the Members page and they will appear here.';
          tr.append(td); body.append(tr); updateSummary(list); return;
        }
        list.forEach(m => {
          const tr = document.createElement('tr'); tr.dataset.memberId = m.id;
          const first = document.createElement('td'), name = document.createElement('strong'); name.textContent = m.name || m.id;
          const meta = document.createElement('div'); meta.className = 'quick-note'; meta.style.marginTop = '2px';
          meta.textContent = [m.id, m.department, m.status && m.status !== 'Active' ? m.status : ''].filter(Boolean).join(' · ');
          first.append(name, meta); tr.append(first);
          STATUSES.forEach(st => {
            const td = document.createElement('td'); td.style.textAlign = 'center';
            const r = document.createElement('input'); r.type = 'radio'; r.name = `attendance-${m.id}`; r.value = st;
            r.checked = statusOf(m.id) === st; r.setAttribute('aria-label', `${st[0].toUpperCase() + st.slice(1)}: ${m.name || m.id}`);
            r.addEventListener('change', () => { draft[m.id] = st; draftChanges.add(m.id); updateSummary(visible()); });
            td.append(r); tr.append(td);
          });
          body.append(tr);
        });
        updateSummary(list);
      }

      function markAll(st) { visible().forEach(m => { draft[m.id] = st; draftChanges.add(m.id); }); render(); }
      $('attendance-all-present').addEventListener('click', () => markAll('present'));
      $('attendance-all-absent').addEventListener('click', () => markAll('absent'));
      calendarButton?.addEventListener('click', () => {
        syncCalendarToService();
        try { if (calendar?.showPicker) calendar.showPicker(); else calendar?.focus(); }
        catch (_) { calendar?.focus(); }
      });
      calendar?.addEventListener('change', () => chooseServiceForDate(calendar.value));
      $('attendance-load').addEventListener('click', () => { loadDraft(); render(); syncCalendarToService(); window.notify && window.notify('Roster loaded.', 'info'); });
      $('attendance-save').addEventListener('click', () => {
        const list = visible(); if (!list.length) { window.notify && window.notify('There are no members to save.', 'error'); return; }
        const all = readAll(), rec = { ...(all[draftKey] || {}) };
        list.forEach(m => { rec[m.id] = statusOf(m.id); });
        all[draftKey] = rec;
        try { localStorage.setItem(KEY, JSON.stringify(all)); list.forEach(m => draftChanges.delete(m.id)); window.dispatchEvent(new CustomEvent('attendance-change')); window.notify && window.notify(`Attendance saved for ${list.length} member${list.length === 1 ? '' : 's'}.`, 'success'); }
        catch (_) { window.notify && window.notify('Could not save in browser storage.', 'error'); }
        render();
      });

      /* ---- Guests / visitors: recorded for each Sunday, kept in their own list ---- */
      const GKEY = 'church-guests-v1';
      const guestRows = $('guest-rows'), guestSummary = $('guest-summary'), guestDialog = $('guest-dialog'), guestForm = $('guest-form');
      let guestShowAll = false, guestEditing = null;
      const readGuests = () => { try { const v = JSON.parse(localStorage.getItem(GKEY)); return Array.isArray(v) ? v.filter(g => g && typeof g === 'object' && !Array.isArray(g)) : []; } catch (_) { return []; } };
      const writeGuests = list => { try { localStorage.setItem(GKEY, JSON.stringify(list)); return true; } catch (_) { window.notify && window.notify('Could not save in browser storage.', 'error'); return false; } };
      function guestsFor(key) { return readGuests().filter(g => g.serviceKey === key); }
      const dateOf = key => String(key || '').split(' · ')[0];
      const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

      function renderGuests() {
        if (!guestRows) return;
        const key = serviceKey(), all = readGuests();
        const list = (guestShowAll ? all : all.filter(g => g.serviceKey === key)).slice()
          .sort((x, y) => guestShowAll ? ((y.date || '').localeCompare(x.date || '') || (x.name || '').localeCompare(y.name || '')) : (x.name || '').localeCompare(y.name || ''));
        guestRows.replaceChildren();
        $('guest-date-th').hidden = !guestShowAll;
        $('guest-toggle-all').textContent = guestShowAll ? 'This Sunday only' : 'All Sundays';
        guestSummary.textContent = guestShowAll
          ? `${plural(all.length, 'guest')} recorded across ${plural(new Set(all.map(g => g.date)).size, 'Sunday')}`
          : `${plural(list.length, 'guest')} on ${dateOf(key) || 'this Sunday'}`;
        if (!list.length) {
          const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = guestShowAll ? 6 : 5; td.className = 'quick-note'; td.style.padding = '20px';
          td.textContent = guestShowAll ? 'No guests have been recorded yet.' : 'No guests recorded for this Sunday yet. Tap “Add guest” when someone visits.';
          tr.append(td); guestRows.append(tr); return;
        }
        list.forEach(g => {
          const tr = document.createElement('tr'); tr.dataset.guestId = g.id;
          const first = document.createElement('td'), strong = document.createElement('strong'); strong.textContent = g.name || '—'; first.append(strong);
          if (g.note) { const n = document.createElement('div'); n.className = 'quick-note'; n.style.marginTop = '2px'; n.textContent = g.note; first.append(n); }
          const cells = [first];
          [g.phone, g.place, g.invitedBy].forEach(v => { const td = document.createElement('td'); td.textContent = v || '—'; cells.push(td); });
          if (guestShowAll) { const td = document.createElement('td'); td.textContent = g.date || '—'; cells.push(td); }
          const actions = document.createElement('td'), group = document.createElement('div'); group.className = 'row-actions';
          const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.guestAction = 'edit'; edit.textContent = 'Edit';
          const del = document.createElement('button'); del.type = 'button'; del.dataset.guestAction = 'delete'; del.className = 'delete'; del.textContent = 'Remove';
          group.append(edit, del); actions.append(group); cells.push(actions);
          tr.append(...cells); guestRows.append(tr);
        });
      }

      function openGuest(g) {
        guestEditing = g || null;
        $('guest-dialog-title').textContent = g ? 'Edit guest' : 'Add guest';
        $('guest-service-label').textContent = `Sunday service: ${g ? g.serviceKey : serviceKey()}`;
        $('guest-name').value = g ? g.name || '' : ''; $('guest-phone').value = g ? g.phone || '' : '';
        $('guest-place').value = g ? g.place || '' : ''; $('guest-invited').value = g ? g.invitedBy || '' : ''; $('guest-note').value = g ? g.note || '' : '';
        if (guestDialog.showModal) guestDialog.showModal(); else guestDialog.setAttribute('open', '');
        $('guest-name').focus();
      }

      $('guest-add')?.addEventListener('click', () => openGuest(null));
      $('guest-cancel')?.addEventListener('click', () => guestDialog.close());
      $('guest-toggle-all')?.addEventListener('click', () => { guestShowAll = !guestShowAll; renderGuests(); });
      guestForm?.addEventListener('submit', event => {
        event.preventDefault();
        const name = $('guest-name').value.trim();
        if (!name) { $('guest-name').focus(); return; }
        const values = { name, phone: $('guest-phone').value.trim(), place: $('guest-place').value.trim(), invitedBy: $('guest-invited').value.trim(), note: $('guest-note').value.trim() };
        const all = readGuests();
        let next;
        if (guestEditing) next = all.map(g => g.id === guestEditing.id ? { ...g, ...values } : g);
        else {
          const key = serviceKey();
          next = [{ id: `g-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, serviceKey: key, date: dateOf(key), ...values, createdAt: new Date().toISOString() }, ...all];
        }
        if (!writeGuests(next)) return;
        guestDialog.close(); render();
        window.notify && window.notify(guestEditing ? `${name} updated.` : `${name} added as a guest.`, 'success', 'Guest saved');
      });
      guestRows?.addEventListener('click', event => {
        const button = event.target.closest('button[data-guest-action]'); if (!button) return;
        const g = readGuests().find(x => x.id === button.closest('tr')?.dataset.guestId); if (!g) return;
        if (button.dataset.guestAction === 'edit') openGuest(g);
        if (button.dataset.guestAction === 'delete' && window.confirm(`Remove ${g.name} from the guest list?`)) { writeGuests(readGuests().filter(x => x.id !== g.id)); render(); }
      });

      if (eventSel) eventSel.addEventListener('change', () => { loadDraft(); render(); syncCalendarToService(); });
      if (deptSel) deptSel.addEventListener('change', render);
      search.addEventListener('input', render);
      window.addEventListener('members-change', render);
      window.addEventListener('services-change', () => { mergeDraftFromCloud(); render(); syncCalendarToService(); });
      window.ChurchDB?.onStoresChanged?.([KEY, MEMBERS, GKEY], () => {
        window.churchMembers = readMembers();
        mergeDraftFromCloud();
        render();
      });
      loadDraft(); render(); syncCalendarToService();
    })();
