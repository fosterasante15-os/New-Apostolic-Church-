/* Sunday services: add, edit, delete, search. The Attendance picker and dashboard panel use this same list. */
    (() => {
      const STORE = 'church-services-v1';
      const DEFAULTS = { description: 'Weekly worship service.', time: '09:00', venue: 'Main Auditorium' };
      let services = [];
      try { const saved = JSON.parse(localStorage.getItem(STORE)); if (Array.isArray(saved)) services = saved; } catch (_) {}
      const cleanServices = services.filter(service => !/^svc-seed-/.test(String(service.id || '')));
      if (cleanServices.length !== services.length) { services = cleanServices; try { localStorage.setItem(STORE, JSON.stringify(services)); } catch (_) {} }
      window.churchServices = services;
      let editingId = null, pendingEdit = null;

      const f = id => document.getElementById(id);
      const rows = f('service-rows'), count = f('service-count'), notice = f('service-notice'), search = f('service-search');
      const form = f('service-form'), err = f('service-form-error');
      const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(services)); window.churchServices = services; window.dispatchEvent(new CustomEvent('services-change')); } catch (_) { notice.textContent = 'Changes work for this session but could not be saved in browser storage.'; } };
      const sorted = () => [...services].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      const parts = d => d.split('-').map(Number);
      const isSunday = d => { const [y, m, day] = parts(d); return new Date(y, m - 1, day).getDay() === 0; };
      const dayName = d => { const [y, m, day] = parts(d); return new Date(y, m - 1, day).toLocaleDateString('en-GB', { weekday: 'long' }); };
      const todayStr = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
      function nextSunday() { const n = new Date(); n.setDate(n.getDate() + ((7 - n.getDay()) % 7)); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; }

      function render() {
        const q = (search?.value || '').trim().toLowerCase();
        const visible = sorted().filter(v => !q || [v.date, v.time, v.venue, v.description, 'sunday service'].some(x => (x || '').toLowerCase().includes(q)));
        rows.replaceChildren();
        visible.forEach(v => {
          const tr = document.createElement('tr'); tr.dataset.serviceId = v.id;
          const td = (...k) => { const c = document.createElement('td'); c.append(...k); return c; };
          const name = document.createElement('strong'); name.textContent = 'Sunday Service';
          const first = td(name);
          if (v.description) { const d = document.createElement('span'); d.className = 'service-desc'; d.textContent = v.description; first.append(d); }
          const actions = document.createElement('div'); actions.className = 'row-actions';
          const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.action = 'edit'; edit.textContent = 'Edit';
          const del = document.createElement('button'); del.type = 'button'; del.dataset.action = 'delete'; del.className = 'delete'; del.textContent = 'Delete';
          actions.append(edit, del);
          tr.append(first, td(v.date), td(v.time), td(v.venue), td(actions)); rows.append(tr);
        });
        count.textContent = `${visible.length} ${visible.length === 1 ? 'record' : 'records'}${visible.length !== services.length ? ` of ${services.length}` : ''}`;
        syncOthers();
      }

      /* Attendance picker + dashboard "Upcoming Sunday services" read from this list. */
      function syncOthers() {
        const sel = f('attendance-event');
        if (sel) {
          const keep = sel.value;
          sel.replaceChildren(...sorted().map(v => new Option(`${v.date} · Sunday Service`, `${v.date} · Sunday Service`)));
          if ([...sel.options].some(o => o.value === keep)) sel.value = keep; else if (sel.options.length) sel.selectedIndex = sel.options.length - 1;
        }
        const box = f('dashboard-services'); if (!box) return;
        const upcoming = sorted().filter(v => v.date >= todayStr()).slice(0, 3);
        box.replaceChildren();
        if (!upcoming.length) { const p = document.createElement('p'); p.className = 'quick-note'; p.textContent = 'No upcoming Sunday services. Add one from the Sunday service page.'; box.append(p); return; }
        upcoming.forEach(v => {
          const [y, m, d] = parts(v.date);
          const art = document.createElement('article'); art.className = 'service';
          const block = document.createElement('div'); block.className = 'date-block';
          const num = document.createElement('strong'); num.textContent = String(d);
          const mon = document.createElement('span'); mon.textContent = new Date(y, m - 1, d).toLocaleDateString('en-GB', { month: 'short' });
          block.append(num, mon);
          const info = document.createElement('div');
          const nm = document.createElement('div'); nm.className = 'service-name'; nm.textContent = 'Sunday Service';
          const meta = document.createElement('div'); meta.className = 'service-meta'; meta.textContent = `${v.date} · ${v.time} · ${v.venue}`;
          info.append(nm, meta); art.append(block, info); box.append(art);
        });
      }

      function prepareForm(svc) {
        editingId = svc ? svc.id : null; err.textContent = '';
        f('service-form-title').textContent = svc ? 'Edit Sunday service' : 'Add Sunday service';
        f('service-crumb').textContent = svc ? 'Edit' : 'New';
        f('service-save').textContent = 'Save Sunday service';
        f('service-desc').value = svc ? svc.description : DEFAULTS.description;
        f('service-date').value = svc ? svc.date : nextSunday();
        f('service-time').value = svc ? svc.time : DEFAULTS.time;
        f('service-venue').value = svc ? svc.venue : DEFAULTS.venue;
        window.scrollTo(0, 0); f('service-desc').focus({ preventScroll: true });
      }
      function onRoute() { if (location.hash === '#service-new') { prepareForm(pendingEdit); pendingEdit = null; } }
      window.addEventListener('hashchange', onRoute);

      f('service-add').addEventListener('click', () => { pendingEdit = null; if (location.hash === '#service-new') prepareForm(null); else location.hash = '#service-new'; });
      search?.addEventListener('input', render);

      form.addEventListener('submit', e => {
        e.preventDefault();
        const date = f('service-date').value, time = f('service-time').value, venue = f('service-venue').value.trim(), description = f('service-desc').value.trim();
        if (!date) { err.textContent = 'Please choose a date.'; f('service-date').focus(); return; }
        if (!isSunday(date)) { err.textContent = `${date} is a ${dayName(date)}. Please choose a Sunday.`; f('service-date').focus(); return; }
        if (!time) { err.textContent = 'Please set the time.'; f('service-time').focus(); return; }
        if (!venue) { err.textContent = 'Please enter the venue.'; f('service-venue').focus(); return; }
        if (services.some(v => v.date === date && v.time === time && v.id !== editingId)) { err.textContent = `A Sunday service is already scheduled on ${date} at ${time}.`; return; }
        if (editingId) {
          services = services.map(v => v.id === editingId ? { ...v, date, time, venue, description } : v);
          notice.textContent = `Sunday service on ${date} updated.`; notify(`Sunday service on ${date} updated.`, 'success');
        } else {
          services.push({ id: `svc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, date, time, venue, description });
          notice.textContent = `Sunday service on ${date} added.`; notify(`Sunday service on ${date} at ${time} added.`, 'success', 'Service added');
        }
        persist(); render(); location.hash = '#sunday-services';
      });

      rows.addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]'); if (!btn) return;
        const v = services.find(x => x.id === btn.closest('tr')?.dataset.serviceId); if (!v) return;
        if (btn.dataset.action === 'edit') { pendingEdit = v; location.hash = '#service-new'; }
        if (btn.dataset.action === 'delete' && window.confirm(`Delete the Sunday service on ${v.date} at ${v.time}?`)) {
          services = services.filter(x => x.id !== v.id); persist(); render(); notice.textContent = `Sunday service on ${v.date} deleted.`;
        }
      });
      render(); onRoute();
    })();
