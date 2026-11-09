(() => {
      const navLinks = [...document.querySelectorAll('.nav a[href^="#"]')];
      function updateActiveNavigation() {
        const requested = location.hash.slice(1);
        const screen = document.getElementById(requested);
        const active = screen && screen.classList.contains('screen') ? (requested.startsWith('report-') ? 'reports' : requested === 'member-new' ? 'members' : requested === 'department-new' ? 'departments' : requested === 'service-new' ? 'sunday-services' : requested === 'announcement-new' ? 'announcements' : requested === 'minister-new' ? 'ministers' : requested) : 'dashboard';
        navLinks.forEach(link => {
          if (link.hash === `#${active}`) link.setAttribute('aria-current', 'page');
          else link.removeAttribute('aria-current');
        });
      }
      window.addEventListener('hashchange', updateActiveNavigation);
      updateActiveNavigation();

      const storageKey = 'church-reconstruction-announcements-v1';
      const seed = [
        { id: 'seed-youth-retreat', title: 'Youth Retreat Registration', status: 'published', date: '2026-08-10' },
        { id: 'seed-welcome-sunday', title: 'Welcome Sunday', status: 'published', date: '2026-08-01' },
        { id: 'seed-easter-recap', title: 'Easter recap', status: 'archived', date: '2026-04-01' }
      ];
      let announcements = seed;
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey));
        if (Array.isArray(saved)) announcements = saved;
      } catch (_) { /* Storage may be disabled; in-memory actions still work. */ }

      const rows = document.getElementById('announcement-rows');
      const count = document.getElementById('announcement-count');
      const notice = document.getElementById('announcement-notice');
      const filterForm = document.getElementById('announcement-filter');
      const statusFilter = document.getElementById('announcement-status-filter');
      const dialog = { showModal() { location.hash = '#announcement-new'; window.scrollTo(0, 0); }, close() { location.hash = '#announcements'; } };
      const form = document.getElementById('announcement-form');
      const titleInput = document.getElementById('announcement-title');
      const statusInput = document.getElementById('announcement-status');
      const dateInput = document.getElementById('announcement-date');
      const contentInput = document.getElementById('announcement-content');
      const submitBtn = document.getElementById('announcement-submit');
      const formError = document.getElementById('announcement-form-error');
      let editingId = null;
      /* Announcements are administrator-managed; Main Admin also has full access. */
      const isAdmin = () => window.ChurchAccess?.isAdmin ? window.ChurchAccess.isAdmin() : true;
      const adminOnly = () => { if (isAdmin()) return true; if (typeof window.notify === 'function') window.notify('Only the main admin can add, edit or delete announcements.', 'error', 'Admin access needed'); else notice.textContent = 'Only the main admin can manage announcements.'; return false; };

      /* ---- SMS to members. window.CHURCH_SMS_API: unset = not connected, 'demo' = simulated, otherwise the base URL of your SMS gateway backend (POST {base}/send). ---- */
      const SMS_API = String(window.CHURCH_SMS_API || '').replace(/\/$/, '');
      const SMS_MODE = !SMS_API ? 'off' : SMS_API === 'demo' ? 'demo' : 'live';
      const toGhanaNumber = raw => { const d = String(raw || '').replace(/\D/g, ''); if (/^233\d{9}$/.test(d)) return d; if (/^0\d{9}$/.test(d)) return '233' + d.slice(1); if (/^\d{9}$/.test(d)) return '233' + d; return ''; };
      function memberList() { if (Array.isArray(window.churchMembers)) return window.churchMembers; try { const v = JSON.parse(localStorage.getItem('church-members-v1')); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
      function smsAudience() {
        const active = memberList().filter(m => !m.status || m.status === 'Active');
        const seen = new Set(), numbers = []; let missing = 0;
        active.forEach(m => { const n = toGhanaNumber(m.phone); if (!n) { missing++; return; } if (!seen.has(n)) { seen.add(n); numbers.push(n); } });
        return { numbers, missing, total: active.length };
      }
      const smsText = item => `${item.title}\n${item.content || ''}`.trim();
      const flash = (msg, type) => { notice.textContent = msg; if (typeof window.notify === 'function') window.notify(msg, type || 'info'); };
      let smsBusy = false;
      async function sendSms(item) {
        if (smsBusy) return;
        if (SMS_MODE === 'off') { item.smsStatus = 'not-connected'; persist(); render(); flash('Announcement published, but the SMS was not sent: the SMS service is not connected yet.', 'error'); return; }
        const { numbers, missing, total } = smsAudience();
        if (!numbers.length) { item.smsStatus = 'no-recipients'; persist(); render(); flash(total ? 'No SMS sent: none of the active members has a valid phone number.' : 'No SMS sent: there are no active members yet.', 'error'); return; }
        const text = smsText(item), parts = Math.ceil(text.length / 160) || 1;
        const ok = window.confirm(`Send this announcement by SMS to ${numbers.length} member${numbers.length === 1 ? '' : 's'}?${missing ? `\n\n${missing} active member${missing === 1 ? ' has' : 's have'} no valid phone number and will be skipped.` : ''}\n\nMessage length: ${text.length} characters (${parts} SMS part${parts === 1 ? '' : 's'} each).${SMS_MODE === 'demo' ? '\n\nDemo mode: nothing is really sent.' : ''}`);
        if (!ok) { if (!item.smsStatus) { item.smsStatus = 'not-sent'; persist(); render(); } return; }
        smsBusy = true; flash(`Sending SMS to ${numbers.length} member${numbers.length === 1 ? '' : 's'}…`);
        try {
          if (SMS_MODE === 'live') {
            const res = await fetch(`${SMS_API}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: `ANN-${item.id}`, message: text, recipients: numbers.map(n => '+' + n) }) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.status === 'failed') throw new Error(data.message || 'The SMS service could not send the message.');
          } else { await new Promise(r => setTimeout(r, 1200)); }
          item.smsStatus = SMS_MODE === 'demo' ? 'demo' : 'sent'; item.smsCount = numbers.length; item.smsAt = new Date().toISOString();
          persist(); render(); flash(`${SMS_MODE === 'demo' ? 'Demo: SMS simulated for' : 'SMS sent to'} ${numbers.length} member${numbers.length === 1 ? '' : 's'}.`, 'success');
        } catch (e) { item.smsStatus = 'failed'; persist(); render(); flash(e.message || 'SMS failed. Check the connection and try again.', 'error'); }
        finally { smsBusy = false; }
      }
      const smsLabel = item => {
        if (item.status !== 'published') return '';
        const when = item.smsAt ? ` · ${new Date(item.smsAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : '';
        return ({ sent: `SMS sent to ${item.smsCount}${when}`, demo: `SMS simulated (${item.smsCount})${when}`, failed: 'SMS failed', 'not-connected': 'SMS not sent: service not connected', 'no-recipients': 'SMS not sent: no phone numbers', 'not-sent': 'SMS not sent' })[item.smsStatus] || 'SMS not sent';
      };

      function persist() {
        try { localStorage.setItem(storageKey, JSON.stringify(announcements)); }
        catch (_) { notice.textContent = 'Changes work for this session but could not be saved in browser storage.'; }
      }
      function makeButton(label, action, className = '') {
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.action = action; button.className = className; button.textContent = label;
        return button;
      }
      function render() {
        const filter = statusFilter.value;
        const visible = announcements.filter(item => filter === 'all' || item.status === filter);
        rows.replaceChildren();
        visible.forEach(item => {
          const tr = document.createElement('tr');
          const titleCell = document.createElement('td'); titleCell.style.fontWeight = '600'; titleCell.textContent = item.title;
          if (item.content) { const sn = document.createElement('div'); sn.className = 'quick-note'; sn.style.fontWeight = '400'; sn.textContent = item.content.length > 90 ? item.content.slice(0, 90).trim() + '…' : item.content; titleCell.append(sn); }
          const statusCell = document.createElement('td');
          const badge = document.createElement('span'); badge.className = `announcement-status ${item.status}`; badge.textContent = item.status; statusCell.append(badge);
          const sl = smsLabel(item); if (sl) { const sn2 = document.createElement('div'); sn2.className = 'quick-note'; sn2.style.marginTop = '4px'; sn2.textContent = sl; statusCell.append(sn2); }
          const dateCell = document.createElement('td'); dateCell.textContent = item.date || '—';
          const actionCell = document.createElement('td');
          const actionGroup = document.createElement('div'); actionGroup.className = 'row-actions';
          actionGroup.append(makeButton('Edit', 'edit'), ...(item.status === 'published' ? [makeButton(item.smsStatus === 'sent' || item.smsStatus === 'demo' ? 'Resend SMS' : 'Send SMS', 'sms'), makeButton('WhatsApp', 'wa')] : []), makeButton('Delete', 'delete', 'delete'));
          actionCell.append(actionGroup); tr.append(titleCell,statusCell,dateCell,actionCell);
          tr.dataset.announcementId = item.id; rows.append(tr);
        });
        count.textContent = `${visible.length} ${visible.length === 1 ? 'record' : 'records'}${filter === 'all' ? '' : ` · ${filter}`}`;
      }
      function openDialog(item = null) {
        editingId = item ? item.id : null;
        document.getElementById('announcement-dialog-title').textContent = item ? 'Edit announcement' : 'Add announcement';
        titleInput.value = item?.title || '';
        contentInput.value = item?.content || '';
        formError.textContent = '';
        submitBtn.textContent = item ? 'Save changes' : 'Create announcement';
        statusInput.value = item?.status || 'draft';
        dateInput.value = item?.date || '';
        document.getElementById('announcement-crumb').textContent = item ? 'Edit announcement' : 'Add announcement';
        dialog.showModal();
        setTimeout(() => titleInput.focus({ preventScroll: true }), 60);
      }
      document.getElementById('announcement-add').addEventListener('click', () => { if (adminOnly()) openDialog(); });
      document.getElementById('announcement-cancel').addEventListener('click', () => dialog.close());
      filterForm.addEventListener('submit', event => { event.preventDefault(); render(); });
      statusFilter.addEventListener('change', render);
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!adminOnly()) return;
        const item = { title: titleInput.value.trim(), content: contentInput.value.trim(), status: statusInput.value, date: dateInput.value };
        if (!item.title) { formError.textContent = 'Enter a title.'; titleInput.focus(); return; }
        if (!item.content) { formError.textContent = 'Enter the announcement content.'; contentInput.focus(); return; }
        if (item.status === 'published' && !item.date) item.date = new Date().toISOString().slice(0, 10);
        const prev = editingId ? announcements.find(a => a.id === editingId) : null;
        const newlyPublished = item.status === 'published' && !(prev && prev.status === 'published');
        if (editingId) {
          announcements = announcements.map(existing => existing.id === editingId ? { ...existing, ...item } : existing);
          notice.textContent = 'Announcement updated.';
        } else {
          item.id = (crypto.randomUUID ? crypto.randomUUID() : `ann-${Date.now()}-${Math.random().toString(16).slice(2)}`);
          announcements.unshift(item);
          notice.textContent = 'Announcement added.';
        }
        persist(); render(); dialog.close();
        if (newlyPublished) { const saved = announcements.find(a => a.id === (editingId || item.id)); if (saved) sendSms(saved); }
      });
      rows.addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const tr = button.closest('tr');
        const item = announcements.find(entry => entry.id === tr?.dataset.announcementId);
        if (!item) return;
        if (!adminOnly()) return;
        if (button.dataset.action === 'sms') { sendSms(item); return; }
        if (button.dataset.action === 'wa') {
          const church = (document.querySelector('[data-church-name]')?.textContent || 'New Apostolic Church Kumasi Central').trim();
          const text = `📢 *${item.title}*\n\n${item.content || ''}\n\n📍 ${church}`;
          if (navigator.share) {
            navigator.share({ title: item.title, text }).catch(() => {
              window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
            });
          } else {
            window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
          }
          return;
        }
        if (button.dataset.action === 'edit') openDialog(item);
        if (button.dataset.action === 'delete' && window.confirm(`Delete “${item.title}”?`)) {
          announcements = announcements.filter(entry => entry.id !== item.id);
          persist(); render(); notice.textContent = 'Announcement deleted.';
        }
      });
      function reloadAnnouncements() {
        try {
          const saved = JSON.parse(localStorage.getItem(storageKey));
          if (Array.isArray(saved) && saved.length) {
            announcements = saved;
            render();
          }
        } catch (_) {}
      }
      window.addEventListener('announcements-change', reloadAnnouncements);
      window.addEventListener('storage', e => { if (e.key === storageKey) reloadAnnouncements(); });
      render();
    })();
