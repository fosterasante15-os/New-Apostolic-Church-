/* Attendance: roster is built from every registered member (Members page), filtered by department and search. */
    (() => {
      const KEY = 'church-attendance-v1', MEMBERS = 'church-members-v1';
      const $ = id => document.getElementById(id);
      const body = $('attendance-rows'); if (!body) return;
      const eventSel = $('attendance-event'), calendarButton = $('attendance-calendar-button'), calendar = $('attendance-calendar'), deptSel = $('attendance-department'), search = $('attendance-search'), summary = $('attendance-summary');
      const STATUSES = ['present', 'late', 'absent', 'excused'];
      let draft = {}, draftKey = null;

      const readAll = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (_) { return {}; } };
      function members() {
        if (Array.isArray(window.churchMembers)) return window.churchMembers;
        try { const v = JSON.parse(localStorage.getItem(MEMBERS)); if (Array.isArray(v)) return v; } catch (_) {}
        return [];
      }
      const serviceKey = () => eventSel ? eventSel.value : '';
      function loadDraft() { draftKey = serviceKey(); draft = { ...(readAll()[draftKey] || {}) }; }
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
        summary.textContent = `${list.length} member${list.length === 1 ? '' : 's'} shown · Present ${c.present} · Late ${c.late} · Absent ${c.absent} · Excused ${c.excused}${saved}`;
      }

      function visible() {
        const dept = deptSel ? deptSel.value : 'All members', q = (search.value || '').trim().toLowerCase();
        return members().filter(m => (dept === 'All members' || window.memberDepartments(m).includes(dept)) && (!q || [m.name, m.id].some(v => (v || '').toLowerCase().includes(q))))
          .slice().sort((x, y) => (x.name || '').localeCompare(y.name || ''));
      }

      function render() {
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
            r.addEventListener('change', () => { draft[m.id] = st; updateSummary(visible()); });
            td.append(r); tr.append(td);
          });
          body.append(tr);
        });
        updateSummary(list);
      }

      function markAll(st) { visible().forEach(m => { draft[m.id] = st; }); render(); }
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
        try { localStorage.setItem(KEY, JSON.stringify(all)); window.dispatchEvent(new CustomEvent('attendance-change')); window.notify && window.notify(`Attendance saved for ${list.length} member${list.length === 1 ? '' : 's'}.`, 'success'); }
        catch (_) { window.notify && window.notify('Could not save in browser storage.', 'error'); }
        render();
      });
      if (eventSel) eventSel.addEventListener('change', () => { loadDraft(); render(); syncCalendarToService(); });
      if (deptSel) deptSel.addEventListener('change', render);
      search.addEventListener('input', render);
      window.addEventListener('members-change', () => { loadDraft(); render(); });
      window.addEventListener('attendance-change', () => { loadDraft(); render(); });
      window.addEventListener('services-change', () => { loadDraft(); render(); syncCalendarToService(); });
      loadDraft(); render(); syncCalendarToService();
    })();
