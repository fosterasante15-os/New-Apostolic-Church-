/* Real activity entries (sign-ins and dues recorded by admins / Account users) are shown first in the Activity log. */
    (() => {
      const KEY = 'church-activity-v1', body = document.getElementById('activity-rows'), userSelect = document.querySelector('#activity-filter select[name="user"]');
      if (!body) return;
      const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
      const ROLE = { 'main-admin': 'Main admin', admin: 'Admin', account: 'Account', member: 'Member' };
      const ACTION = { create: ['Create', 'published'], update: ['Update', 'published'], delete: ['Delete', 'draft'], login: ['Login', 'published'], 'login-failed': ['Failed login', 'draft'] };
      const ENTITY = { due: 'Dues', user: 'User' };
      const day = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      function render() {
        body.querySelectorAll('tr[data-live]').forEach(r => r.remove());
        const entries = read().slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
        const frag = document.createDocumentFragment(), seen = new Set([...(userSelect?.options || [])].map(o => o.value));
        entries.forEach(e => {
          const when = new Date(e.at); if (isNaN(when)) return;
          const [label, tone] = ACTION[e.action] || [e.action, 'published'];
          const tr = document.createElement('tr'); tr.dataset.live = '1'; tr.dataset.date = day(when); tr.dataset.user = e.userId || 'unknown'; tr.dataset.action = e.action; tr.dataset.entity = e.entity || 'user';
          const td = text => { const c = document.createElement('td'); c.textContent = text; return c; };
          const status = document.createElement('td'), pill = document.createElement('span'); pill.className = `announcement-status ${tone}`; pill.textContent = label; status.append(pill);
          const det = document.createElement('td'), d = document.createElement('details'), sm = document.createElement('summary'), code = document.createElement('code');
          sm.textContent = 'View details'; code.textContent = JSON.stringify({ event: e.action, summary: e.summary || '', ...(e.data || {}) }); d.append(sm, code); det.append(d);
          tr.append(td(when.toLocaleString()), td(`${e.userName || 'Unknown'}${e.role ? ` (${ROLE[e.role] || e.role})` : ''}`), status, td(ENTITY[e.entity] || e.entity), det);
          frag.append(tr);
          if (userSelect && e.userId && !seen.has(e.userId)) { seen.add(e.userId); const o = document.createElement('option'); o.value = e.userId; o.textContent = e.userName || e.userId; userSelect.append(o); }
        });
        body.prepend(frag);
        window.dispatchEvent(new CustomEvent('activity-refresh'));
      }
      render();
      window.addEventListener('hashchange', () => { if (location.hash === '#activity') render(); });
      window.addEventListener('activity-change', render);
      window.addEventListener('storage', e => { if (e.key === KEY) render(); });
    })();

(() => {
      const form = document.getElementById('activity-filter');
      const getRows = () => [...document.querySelectorAll('#activity-rows tr')];
      const count = document.getElementById('activity-count');
      const notice = document.getElementById('activity-notice');
      if (!form || !count || !notice) return;
      function applyFilters() {
        const entity = form.elements.entity.value;
        const action = form.elements.action.value;
        const user = form.elements.user.value;
        const from = form.elements.dateFrom.value;
        const to = form.elements.dateTo.value;
        let visible = 0;
        getRows().forEach(row => {
          const date = row.dataset.date;
          const show = (entity === 'all' || row.dataset.entity === entity) &&
            (action === 'all' || row.dataset.action === action) &&
            (user === 'all' || row.dataset.user === user) &&
            (!from || date >= from) && (!to || date <= to);
          row.hidden = !show;
          if (show) visible++;
        });
        count.textContent = `${visible} ${visible === 1 ? 'record' : 'records'} shown`;
      }
      form.addEventListener('submit', event => { event.preventDefault(); applyFilters(); notice.textContent = 'Filters applied to the live Supabase activity log.'; });
      form.addEventListener('change', applyFilters);
      form.addEventListener('reset', () => { setTimeout(() => { applyFilters(); notice.textContent = 'Filters cleared.'; }, 0); });
      document.getElementById('activity-export').addEventListener('click', () => {
        const csvCell = value => `"${String(value).replaceAll('"','""')}"`;
        const header = ['When','User','Action','Entity','Details'];
        const data = getRows().filter(row => !row.hidden).map(row => [...row.querySelectorAll('td')].map((cell,index) => index === 4 ? cell.querySelector('code')?.textContent || '' : cell.innerText.trim()));
        const csv = [header,...data].map(record => record.map(csvCell).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}));
        const link = document.createElement('a');
        link.href = url; link.download = 'church-activity-log.csv';
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
        notice.textContent = `${data.length} filtered live event${data.length === 1 ? '' : 's'} exported as CSV.`;
      });
      window.addEventListener('activity-refresh', applyFilters);
      applyFilters();
    })();
