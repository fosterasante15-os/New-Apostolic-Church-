/* Offering and thanksgiving: Sunday offering + thanksgiving records, month overview, dashboard figures. */
    (() => {
      const SK = 'church-offerings-v1', TK = 'church-thanksgiving-v1', $ = id => document.getElementById(id);
      const load = key => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
      const pad = n => String(n).padStart(2, '0');
      const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const todayStr = () => ymd(new Date()), monthNow = () => todayStr().slice(0, 7);
      const lastSunday = () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return ymd(d); };
      const parts = s => String(s).split('-').map(Number);
      const isSunday = s => { const [y, m, d] = parts(s); return new Date(y, m - 1, d).getDay() === 0; };
      const money = v => `GH₵${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const sum = rows => rows.reduce((t, r) => t + Number(r.amount || 0), 0);
      const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
      const monthLabel = m => { const [y, mo] = parts(m); return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
      const prettyDate = s => { const [y, m, d] = parts(s); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); };
      const inMonth = (rows, m) => rows.filter(r => String(r.date || '').slice(0, 7) === m);
      const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
      const notify = (m, t, title) => { if (typeof window.notify === 'function') window.notify(m, t, title); };
      const isAdmin = () => window.ChurchAccess?.isAdmin ? window.ChurchAccess.isAdmin() : true;
      const newId = prefix => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      let offerings = load(SK), thanks = load(TK), sEdit = null, tEdit = null, shown = monthNow();
      const persist = () => { try { localStorage.setItem(SK, JSON.stringify(offerings)); localStorage.setItem(TK, JSON.stringify(thanks)); } catch (_) { notify('Records work for this session but could not be saved in browser storage.', 'error'); } };

      function dashboard() {
        const m = monthNow(), o = inMonth(offerings, m), t = inMonth(thanks, m);
        set('dash-offering-card', money(sum(o))); set('dash-offering-money', money(sum(o)));
        set('dash-offering-sundays', `${plural(new Set(o.map(r => r.date)).size, 'Sunday')} recorded`);
        set('dash-thanks-amount', money(sum(t))); set('dash-thanks-note', `${plural(t.filter(r => r.location).length, 'record')} with location`);
        set('dash-offering-records', String(o.length));
      }
      function row(cells, id) {
        const tr = document.createElement('tr'); tr.dataset.id = id;
        cells.forEach(v => { const td = document.createElement('td'); td.textContent = v || '—'; tr.append(td); });
        const td = document.createElement('td'), box = document.createElement('div'); box.className = 'row-actions';
        [['edit', 'Edit'], ['delete', 'Delete']].forEach(([a, label]) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.action = a; b.textContent = label; if (a === 'delete') b.className = 'delete'; box.append(b); });
        td.append(box); tr.append(td); return tr;
      }
      function empty(body, cols, text) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = cols; td.style.cssText = 'text-align:center;color:var(--muted)'; td.textContent = text; tr.append(td); body.append(tr); }
      function render() {
        const o = inMonth(offerings, shown), t = inMonth(thanks, shown), label = monthLabel(shown), when = shown === monthNow() ? 'this month' : `in ${label}`;
        set('ot-month-label', label);
        set('ot-offering-total', money(sum(o))); set('ot-offering-note', `${plural(new Set(o.map(r => r.date)).size, 'Sunday')} recorded ${when}`);
        set('ot-thanks-total', money(sum(t))); set('ot-thanks-note', `${plural(t.filter(r => r.location).length, 'record')} with location`);
        set('ot-month-total', money(sum(o))); set('ot-month-total-note', `Sunday offering for ${label}`);
        const sb = $('ot-s-rows'); sb.replaceChildren();
        if (!o.length) empty(sb, 4, `No Sunday offering recorded for ${label}.`);
        o.slice().sort((a, b) => `${b.date}${b.id}`.localeCompare(`${a.date}${a.id}`)).forEach(r => sb.append(row([prettyDate(r.date), money(r.amount), r.note], r.id)));
        set('ot-s-count', `${plural(o.length, 'record')} in ${label}`);
        const tb = $('ot-t-rows'); tb.replaceChildren();
        if (!t.length) empty(tb, 6, `No thanksgiving recorded for ${label}.`);
        t.slice().sort((a, b) => `${b.date}${b.id}`.localeCompare(`${a.date}${a.id}`)).forEach(r => tb.append(row([prettyDate(r.date), r.giver || 'Anonymous', r.location, money(r.amount), r.note], r.id)));
        set('ot-t-count', `${plural(t.length, 'record')} in ${label}`);
        dashboard();
      }
      function showTab(name) {
        [['overview', 'ot-tab-overview'], ['sunday', 'ot-tab-sunday'], ['thanks', 'ot-tab-thanks']].forEach(([key, id]) => {
          const on = key === name; $(`ot-view-${key}`).hidden = !on; const b = $(id); b.className = on ? 'primary-button' : 'outline-link'; b.setAttribute('aria-selected', String(on));
        });
      }
      function resetSunday() { sEdit = null; $('ot-s-form').reset(); $('ot-s-date').value = lastSunday(); $('ot-s-error').textContent = ''; $('ot-s-save').textContent = '＋ Save Sunday offering'; $('ot-s-cancel').hidden = true; }
      function resetThanks() { tEdit = null; $('ot-t-form').reset(); $('ot-t-date').value = todayStr(); $('ot-t-error').textContent = ''; $('ot-t-save').textContent = '＋ Save thanksgiving'; $('ot-t-cancel').hidden = true; }
      function applyMonth() { const v = $('ot-month').value; if (!v) { notify('Choose a month to show.', 'error'); return; } shown = v; render(); }

      ['overview', 'sunday', 'thanks'].forEach(name => $(`ot-tab-${name}`).addEventListener('click', () => showTab(name)));
      $('ot-go-sunday').addEventListener('click', () => showTab('sunday')); $('ot-go-thanks').addEventListener('click', () => showTab('thanks'));
      $('ot-show-month').addEventListener('click', applyMonth); $('ot-month').addEventListener('change', applyMonth);
      $('ot-s-cancel').addEventListener('click', resetSunday); $('ot-t-cancel').addEventListener('click', resetThanks);

      $('ot-s-form').addEventListener('submit', event => {
        event.preventDefault(); const err = $('ot-s-error'); err.textContent = '';
        if (!isAdmin()) { err.textContent = 'Only an admin can record offerings.'; notify(err.textContent, 'error', 'Admin access needed'); return; }
        const date = $('ot-s-date').value, amount = Number($('ot-s-amount').value);
        if (!date) { err.textContent = 'Choose the Sunday date.'; return; }
        if (!isSunday(date)) { err.textContent = 'That date is not a Sunday. Choose a Sunday.'; return; }
        if (!(amount > 0)) { err.textContent = 'Enter an amount greater than zero.'; return; }
        const values = { date, amount: amount.toFixed(2), note: $('ot-s-note').value.trim() };
        if (sEdit) { offerings = offerings.map(r => r.id === sEdit ? { ...r, ...values } : r); notify('Sunday offering updated.', 'success'); }
        else { offerings.push({ id: newId('so'), createdAt: new Date().toISOString(), ...values }); notify(`Sunday offering of ${money(amount)} recorded.`, 'success'); }
        persist(); resetSunday(); shown = date.slice(0, 7); $('ot-month').value = shown; render();
      });
      $('ot-t-form').addEventListener('submit', event => {
        event.preventDefault(); const err = $('ot-t-error'); err.textContent = '';
        if (!isAdmin()) { err.textContent = 'Only an admin can record thanksgiving.'; notify(err.textContent, 'error', 'Admin access needed'); return; }
        const date = $('ot-t-date').value, amount = Number($('ot-t-amount').value);
        if (!date) { err.textContent = 'Choose the date.'; return; }
        if (!(amount > 0)) { err.textContent = 'Enter an amount greater than zero.'; return; }
        const values = { date, amount: amount.toFixed(2), giver: $('ot-t-giver').value.trim(), location: $('ot-t-location').value.trim(), note: $('ot-t-note').value.trim() };
        if (tEdit) { thanks = thanks.map(r => r.id === tEdit ? { ...r, ...values } : r); notify('Thanksgiving updated.', 'success'); }
        else { thanks.push({ id: newId('tg'), createdAt: new Date().toISOString(), ...values }); notify(`Thanksgiving of ${money(amount)} recorded.`, 'success'); }
        persist(); resetThanks(); shown = date.slice(0, 7); $('ot-month').value = shown; render();
      });
      $('ot-s-rows').addEventListener('click', event => {
        const button = event.target.closest('button[data-action]'), rec = offerings.find(r => r.id === button?.closest('tr')?.dataset.id); if (!rec) return;
        if (button.dataset.action === 'edit') { sEdit = rec.id; $('ot-s-error').textContent = ''; $('ot-s-date').value = rec.date; $('ot-s-amount').value = rec.amount; $('ot-s-note').value = rec.note || ''; $('ot-s-save').textContent = 'Update Sunday offering'; $('ot-s-cancel').hidden = false; $('ot-s-amount').focus(); }
        if (button.dataset.action === 'delete') { if (!isAdmin()) { notify('Only an admin can delete offerings.', 'error', 'Admin access needed'); return; } if (window.confirm(`Delete the Sunday offering of ${money(rec.amount)} for ${prettyDate(rec.date)}?`)) { offerings = offerings.filter(r => r.id !== rec.id); if (sEdit === rec.id) resetSunday(); persist(); render(); notify('Sunday offering deleted.', 'success'); } }
      });
      $('ot-t-rows').addEventListener('click', event => {
        const button = event.target.closest('button[data-action]'), rec = thanks.find(r => r.id === button?.closest('tr')?.dataset.id); if (!rec) return;
        if (button.dataset.action === 'edit') { tEdit = rec.id; $('ot-t-error').textContent = ''; $('ot-t-date').value = rec.date; $('ot-t-amount').value = rec.amount; $('ot-t-giver').value = rec.giver || ''; $('ot-t-location').value = rec.location || ''; $('ot-t-note').value = rec.note || ''; $('ot-t-save').textContent = 'Update thanksgiving'; $('ot-t-cancel').hidden = false; $('ot-t-amount').focus(); }
        if (button.dataset.action === 'delete') { if (!isAdmin()) { notify('Only an admin can delete thanksgiving.', 'error', 'Admin access needed'); return; } if (window.confirm(`Delete the thanksgiving of ${money(rec.amount)} on ${prettyDate(rec.date)}?`)) { thanks = thanks.filter(r => r.id !== rec.id); if (tEdit === rec.id) resetThanks(); persist(); render(); notify('Thanksgiving deleted.', 'success'); } }
      });
      function reloadOfferings() {
        offerings = load(SK);
        thanks = load(TK);
        render();
        dashboard();
      }
      window.addEventListener('offerings-change', reloadOfferings);
      window.addEventListener('storage', e => { if (e.key === SK || e.key === TK) reloadOfferings(); });
      $('ot-month').value = shown; resetSunday(); resetThanks(); showTab('overview'); render();
    })();
