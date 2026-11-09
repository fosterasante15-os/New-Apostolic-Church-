/* Members: every new member automatically receives a unique, never-reused Member ID (e.g. NAC-0004). */
    (() => {
      const STORE = 'church-members-v1', SEQ_STORE = 'church-member-seq-v1', PREFIX = 'NAC-', PAD = 4;
      let members = [];
      try {
        const saved = JSON.parse(localStorage.getItem(STORE));
        if (Array.isArray(saved)) members = saved;
      } catch (_) {}
      window.churchMembers = members;

      const f = id => document.getElementById(id);
      const rows = f('member-rows'), count = f('member-count'), notice = f('member-notice');
      const searchInput = f('member-search'), deptFilter = f('member-dept-filter'), statusFilter = f('member-status-filter');
      const form = f('member-form'), deptBox = f('member-dept-options'), formError = f('member-form-error');
      const deptNames = () => [...deptFilter.options].slice(1).map(o => o.textContent);
      const selectedDepts = () => [...deptBox.querySelectorAll('input[type="checkbox"]:checked')].map(i => i.value);
      function updateDeptCount() { const n = selectedDepts().length; f('member-dept-count').textContent = n ? `${n} selected` : 'None selected'; }
      function fillDeptSelect(keep = selectedDepts()) {
        const names = deptNames(); const all = [...names, ...keep.filter(k => !names.includes(k))];   /* keep a department even if it was removed from the list */
        deptBox.replaceChildren();
        all.forEach(name => {
          const label = document.createElement('label'); label.className = 'dept-option';
          const box = document.createElement('input'); box.type = 'checkbox'; box.value = name; box.checked = keep.includes(name); box.addEventListener('change', updateDeptCount);
          const text = document.createElement('span'); text.textContent = name; label.append(box, text); deptBox.append(label);
        });
        updateDeptCount();
      }
      fillDeptSelect();
      window.addEventListener('departments-change', fillDeptSelect);
      window.addEventListener('department-renamed', e => {
        members = members.map(m => { const list = window.memberDepartments(m); if (!list.includes(e.detail.from)) return m; const next = list.map(d => d === e.detail.from ? e.detail.to : d); return { ...m, departments: next, department: next.join(', ') }; });
        persist(); render();
      });
      let editingId = null, pendingEdit = null, registeredId = null, currentPhoto = '', pendingNotice = null;

      const numberOf = id => { const m = /(\d+)$/.exec(id || ''); return m ? parseInt(m[1], 10) : 0; };
      const format = n => PREFIX + String(n).padStart(PAD, '0');
      const readSeq = () => { try { return parseInt(localStorage.getItem(SEQ_STORE), 10) || 0; } catch (_) { return 0; } };
      /* When the member list is empty, begin a fresh numbering cycle at zero so the first new member is NAC-0001. */
      function peekNextId() {
        if (!members.length) { try { localStorage.setItem(SEQ_STORE, '0'); } catch (_) {} return format(1); }
        let n = Math.max(readSeq(), ...members.map(m => numberOf(m.id))) + 1;
        while (members.some(m => m.id === format(n))) n++;
        return format(n);
      }
      const commitId = id => { try { localStorage.setItem(SEQ_STORE, String(Math.max(readSeq(), numberOf(id)))); } catch (_) {} };
      const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(members)); } catch (_) { notice.textContent = 'Changes work for this session but could not be saved in browser storage.'; } };

      function updateDashboardTotals() {
        const total = members.length, active = members.filter(m => m.status === 'Active').length;
        const now = new Date(), ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const fresh = members.filter(m => (m.joined || '').startsWith(ym)).length;
        const label = [...document.querySelectorAll('#dashboard .quick-label')].find(el => el.textContent.trim() === 'Total members');
        if (!label) return;
        const value = label.parentElement.querySelector('.quick-value'), note = label.parentElement.querySelector('.quick-note');
        if (value) value.textContent = total;
        if (note) note.textContent = `${active} active · ${fresh} new this month`;
      }

      function updateBirthdayWishes() {
        const list = document.getElementById('dash-birthday-list'), dateLabel = document.getElementById('dash-birthday-date');
        if (!list) return;
        const now = new Date(), month = String(now.getMonth() + 1).padStart(2, '0'), day = String(now.getDate()).padStart(2, '0');
        const todayKey = `${now.getFullYear()}-${month}-${day}`;
        const birthdays = members.filter(member => /^\d{4}-\d{2}-\d{2}$/.test(member.dob || '') && member.dob.slice(5) === `${month}-${day}`);
        dateLabel.textContent = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        list.replaceChildren();
        if (!birthdays.length) {
          const empty = document.createElement('p'); empty.className = 'birthday-empty'; empty.textContent = 'No birthdays today. Add a date of birth to a member profile to receive birthday wishes.'; list.append(empty); return;
        }
        birthdays.forEach(member => {
          const card = document.createElement('article'); card.className = 'birthday-card';
          const icon = document.createElement('div'); icon.className = 'birthday-icon'; icon.textContent = '★'; icon.setAttribute('aria-hidden', 'true');
          const copy = document.createElement('div'), first = (member.name || 'Member').trim().split(/\s+/)[0];
          const title = document.createElement('strong'); title.textContent = `Happy Birthday, ${first}!`;
          const message = document.createElement('span'); message.textContent = `Wishing ${member.name || 'you'} a joyful birthday from the church family.`;
          copy.append(title, message); card.append(icon, copy); list.append(card);
        });
        const notifiedKey = `church-birthday-wishes-${todayKey}`;
        if (!sessionStorage.getItem(notifiedKey)) {
          const names = birthdays.map(member => member.name || 'a member').join(', ');
          window.notify?.(`Happy Birthday to ${names}!`, 'success', 'Birthday wishes');
          try { sessionStorage.setItem(notifiedKey, 'shown'); } catch (_) {}
        }
      }

      function showMemberBirthdays() {
        const monthInput = f('member-birthday-month'), results = f('member-birthday-results'), selected = monthInput.value;
        if (!selected) { results.innerHTML = '<p class="birthday-empty">Select a month first.</p>'; return; }
        const month = selected.slice(5, 7), monthName = new Date(`${selected}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const birthdays = members.filter(member => /^\d{4}-\d{2}-\d{2}$/.test(member.dob || '') && member.dob.slice(5, 7) === month).sort((a, b) => a.dob.slice(8, 10).localeCompare(b.dob.slice(8, 10)) || (a.name || '').localeCompare(b.name || ''));
        results.replaceChildren();
        if (!birthdays.length) { const empty = document.createElement('p'); empty.className = 'birthday-empty'; empty.textContent = `No members with birthdays in ${monthName}.`; results.append(empty); return; }
        birthdays.forEach(member => {
          const card = document.createElement('article'); card.className = 'birthday-card';
          const icon = document.createElement('div'); icon.className = 'birthday-icon'; icon.textContent = '★'; icon.setAttribute('aria-hidden', 'true');
          const copy = document.createElement('div'), day = Number(member.dob.slice(8, 10));
          const title = document.createElement('strong'); title.textContent = member.name || 'Unnamed member';
          const details = document.createElement('span'); details.textContent = `${day} ${monthName.split(' ')[0]} · ${member.id}${member.department ? ` · ${member.department}` : ''}`;
          copy.append(title, details); card.append(icon, copy); results.append(card);
        });
        f('member-notice').textContent = `${birthdays.length} birthday ${birthdays.length === 1 ? 'member' : 'members'} found for ${monthName}.`;
      }

      function render() {
        const q = searchInput.value.trim().toLowerCase(), dept = deptFilter.value, st = statusFilter.value;
        const visible = members.filter(m =>
          (!q || [m.id, m.name, m.phone, m.email, m.place].some(v => (v || '').toLowerCase().includes(q))) &&
          (dept === 'All departments' || window.memberDepartments(m).includes(dept)) && (st === 'All statuses' || m.status === st));
        rows.replaceChildren();
        visible.forEach(m => {
          const tr = document.createElement('tr'); tr.dataset.memberId = m.id;
          const td = (...kids) => { const c = document.createElement('td'); c.append(...kids); return c; };
          const idBadge = document.createElement('span'); idBadge.className = 'member-id'; idBadge.textContent = m.id;
          const person = document.createElement('div'); person.className = 'person';
          const avatar = document.createElement('span'); avatar.className = 'avatar';
          if (m.photo) { const im = document.createElement('img'); im.src = m.photo; im.alt = ''; avatar.append(im); } else avatar.textContent = (m.name || '?').trim().charAt(0).toUpperCase();
          const nm = document.createElement('span'); nm.className = 'person-name'; nm.textContent = m.name; person.append(avatar, nm);
          const contact = td(); contact.className = 'contact';
          const c1 = document.createElement('span'); c1.textContent = m.email || '—';
          const c2 = document.createElement('span'); c2.textContent = m.phone || 'No phone';
          contact.append(c1, c2);
          const badge = document.createElement('span'); badge.className = m.status === 'Active' ? 'status' : 'status inactive'; badge.textContent = m.status;
          const actions = document.createElement('div'); actions.className = 'row-actions';
          const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.action = 'edit'; edit.textContent = 'Edit';
          const del = document.createElement('button'); del.type = 'button'; del.dataset.action = 'delete'; del.className = 'delete'; del.textContent = 'Delete';
          actions.append(edit, del);
          tr.append(td(idBadge), td(person), contact, td(m.place || '—'), td(m.department || '—'), td(m.joined || '—'), td(badge), td(actions));
          rows.append(tr);
        });
        count.textContent = `${visible.length} ${visible.length === 1 ? 'record' : 'records'}${members.length !== visible.length ? ` of ${members.length}` : ''}`;
        updateDashboardTotals();
        updateBirthdayWishes();
        window.churchMembers = members;
        window.dispatchEvent(new CustomEvent('members-change', { detail: members }));
      }


      /* ---- Profile photo: choose a file or use the camera; photos are cropped square and resized. ---- */
      const photoPreview = f('member-photo-preview'), photoRemove = f('member-photo-remove');
      function setPhoto(dataUrl) {
        currentPhoto = dataUrl || '';
        photoPreview.replaceChildren();
        if (currentPhoto) { const im = document.createElement('img'); im.src = currentPhoto; im.alt = 'Profile photo preview'; photoPreview.append(im); }
        else { const t = document.createElement('span'); t.textContent = 'No photo'; photoPreview.append(t); }
        photoRemove.hidden = !currentPhoto;
      }
      function toSquareJpeg(source, w, h, size = 320) {
        const side = Math.min(w, h), canvas = document.createElement('canvas');
        canvas.width = canvas.height = Math.min(size, side);
        canvas.getContext('2d').drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.85);
      }
      f('member-photo-file').addEventListener('change', e => {
        const file = e.target.files[0]; e.target.value = '';
        if (!file) return;
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { formError.textContent = 'Please choose a JPEG, PNG, or WebP image.'; return; }
        formError.textContent = '';
        const url = URL.createObjectURL(file), img = new Image();
        img.onload = () => { setPhoto(toSquareJpeg(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(url); };
        img.onerror = () => { URL.revokeObjectURL(url); formError.textContent = 'That image could not be read. Try another file.'; };
        img.src = url;
      });
      photoRemove.addEventListener('click', () => setPhoto(''));

      const camDialog = f('camera-dialog'), camVideo = f('camera-video'), camError = f('camera-error');
      let camStream = null;
      const stopCamera = () => { camStream?.getTracks().forEach(t => t.stop()); camStream = null; camVideo.srcObject = null; };
      f('member-photo-camera').addEventListener('click', async () => {
        camError.textContent = '';
        if (!navigator.mediaDevices?.getUserMedia) { notify('The camera is not available here. Use “Choose from computer” instead (the camera needs https or localhost).', 'error'); return; }
        try {
          camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
          camVideo.srcObject = camStream; camDialog.showModal();
        } catch (_) { stopCamera(); notify('Could not access the camera. Allow camera permission, or use “Choose from computer”.', 'error'); }
      });
      f('camera-capture').addEventListener('click', () => {
        if (!camVideo.videoWidth) { camError.textContent = 'The camera is still starting. Try again in a moment.'; return; }
        setPhoto(toSquareJpeg(camVideo, camVideo.videoWidth, camVideo.videoHeight)); camDialog.close();
      });
      f('camera-cancel').addEventListener('click', () => camDialog.close());
      camDialog.addEventListener('close', stopCamera);


      /* ---- Welcome notification ----------------------------------------------------------
         Browsers cannot send SMS safely on their own (a gateway key would be public), so:
         1) set window.CHURCH_NOTIFY_ENDPOINT = '/api/notify' (see api/notify.js) to send automatically, or
         2) leave it empty and use the "Send as SMS" / "Send on WhatsApp" buttons, which open the
            message already written on the registrar's phone/computer. */
      const NOTIFY_ENDPOINT = window.CHURCH_NOTIFY_ENDPOINT || '';
      const OUTBOX = 'church-notification-outbox-v1';
      function normalizePhone(raw) {
        const d = String(raw || '').replace(/[\s\-().]/g, '');
        if (/^\+\d{8,15}$/.test(d)) return d;
        if (/^0\d{9}$/.test(d)) return '+233' + d.slice(1);       /* Ghana: 024 123 4567 */
        if (/^233\d{9}$/.test(d)) return '+' + d;
        if (/^\d{9}$/.test(d)) return '+233' + d;
        return null;
      }
      const churchName = () => (document.querySelector('[data-church-name]')?.textContent || 'our church').trim();
      function welcomeMessage(m) {
        const first = (m.name || '').trim().split(/\s+/)[0] || 'friend';
        return `Welcome to ${churchName()}, ${first}! You have been registered as a member.\nYour Member ID: ${m.id}${m.department ? `\nDepartment: ${m.department}` : ''}\nPlease keep this number safe. God bless you.`;
      }
      function logOutbox(entry) {
        try { const box = JSON.parse(localStorage.getItem(OUTBOX)) || []; box.unshift(entry); localStorage.setItem(OUTBOX, JSON.stringify(box.slice(0, 50))); } catch (_) {}
      }
      async function showWelcomeMessage(member, to) {
        const text = welcomeMessage(member), enc = encodeURIComponent(text), status = f('msg-status');
        f('msg-card').hidden = false;
        f('msg-to').textContent = to;
        f('msg-bubble').textContent = text;
        f('msg-sms').href = `sms:${to}?&body=${enc}`;
        const photoPreview = f('msg-photo-preview'), photoImg = f('msg-photo-img');
        if (photoPreview && photoImg) {
          if (member.photo) { photoImg.src = member.photo; photoPreview.style.display = 'block'; }
          else { photoPreview.style.display = 'none'; }
        }
        const waLink = f('msg-wa');
        waLink.href = `https://wa.me/${to.replace('+', '')}?text=${enc}`;
        waLink.onclick = async (e) => {
          if (navigator.share && member.photo) {
            try {
              const res = await fetch(member.photo);
              const blob = await res.blob();
              const file = new File([blob], `${member.id || 'member'}.jpg`, { type: blob.type || 'image/jpeg' });
              if (navigator.canShare && navigator.canShare({ files: [file] })) {
                e.preventDefault();
                await navigator.share({ title: `Welcome to ${churchName()}`, text, files: [file] });
                return;
              }
            } catch (err) {
              if (err.name === 'AbortError') { e.preventDefault(); return; }
            }
          }
        };
        f('msg-copy').onclick = async () => { try { await navigator.clipboard.writeText(text); notify('Message copied.', 'success'); } catch (_) { notify('Could not copy automatically.', 'error'); } };
        status.className = 'msg-status';
        if (!NOTIFY_ENDPOINT) { status.textContent = 'Ready to send. Choose SMS or WhatsApp below (no SMS gateway is connected yet).'; logOutbox({ id: member.id, to, text, status: 'ready', at: new Date().toISOString() }); return; }
        status.textContent = 'Sending…';
        try {
          const res = await fetch(NOTIFY_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, message: text, memberId: member.id }) });
          if (!res.ok) throw new Error(res.status);
          status.textContent = `✓ Message sent to ${to}`; status.classList.add('is-ok');
          logOutbox({ id: member.id, to, text, status: 'sent', at: new Date().toISOString() });
        } catch (_) {
          status.textContent = 'Could not send automatically. Use the buttons below instead.'; status.classList.add('is-error');
          logOutbox({ id: member.id, to, text, status: 'failed', at: new Date().toISOString() });
        }
      }

      /* Fill the Register / Edit page every time it is opened. */
      function prepareForm(member) {
        editingId = member ? member.id : null;
        formError.textContent = '';
        f('member-form-title').textContent = member ? 'Edit member' : 'Register member';
        f('member-crumb').textContent = member ? 'Edit' : 'New';
        f('member-save').textContent = member ? 'Save changes' : 'Create member';
        f('member-id-preview').textContent = member ? member.id : peekNextId();
        f('member-id-caption').textContent = member ? 'Member ID (cannot be changed)' : 'Member ID (auto-generated)';
        f('member-name').value = member?.name || '';
        f('member-email').value = member?.email || '';
        f('member-phone').value = member?.phone || '';
        f('member-dob').value = member?.dob || '';
        f('member-joined').value = member?.joined || new Date().toISOString().slice(0, 10);
        f('member-status').value = member?.status || 'Active';
        f('member-place').value = member?.place || '';
        f('member-notes').value = member?.notes || '';
        f('member-notify').checked = !member;
        f('member-notify').closest('label').hidden = Boolean(member);
        setPhoto(member?.photo || '');
        fillDeptSelect(window.memberDepartments(member));
        window.scrollTo(0, 0);
        f('member-name').focus({ preventScroll: true });
      }
      function onRoute() { if (location.hash === '#member-new') { prepareForm(pendingEdit); pendingEdit = null; } }
      window.addEventListener('hashchange', onRoute);
      onRoute();

      f('member-add').addEventListener('click', () => { pendingEdit = null; if (location.hash === '#member-new') prepareForm(null); else location.hash = '#member-new'; });
      f('member-filter').addEventListener('submit', e => { e.preventDefault(); render(); });
      searchInput.addEventListener('input', render); deptFilter.addEventListener('change', render); statusFilter.addEventListener('change', render);
      f('member-birthday-month').value = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      f('member-birthday-show').addEventListener('click', showMemberBirthdays);

      form.addEventListener('submit', e => {
        e.preventDefault();
        const name = f('member-name').value.trim();
        if (!name) { formError.textContent = 'Please enter the full name.'; f('member-name').focus(); return; }
        if (!f('member-email').checkValidity()) { formError.textContent = 'Please enter a valid email address.'; f('member-email').focus(); return; }
        const email = f('member-email').value.trim().toLowerCase();
        if (email && members.some(m => (m.email || '').toLowerCase() === email && m.id !== editingId)) { formError.textContent = 'A member with that email already exists.'; f('member-email').focus(); return; }
        const rawPhone = f('member-phone').value.trim();
        const phoneIntl = rawPhone ? normalizePhone(rawPhone) : null;
        if (rawPhone && !phoneIntl) { formError.textContent = 'Enter a valid phone number, e.g. 024 123 4567 or +233241234567.'; f('member-phone').focus(); return; }
        const chosen = selectedDepts();
        if (!chosen.length && deptNames().length) { formError.textContent = 'Choose at least one department.'; deptBox.querySelector('input')?.focus(); return; }
        const values = { name, email, phone: f('member-phone').value.trim(), dob: f('member-dob').value, notes: f('member-notes').value.trim(), photo: currentPhoto, place: f('member-place').value.trim(), departments: chosen, department: chosen.join(', '), joined: f('member-joined').value, status: f('member-status').value };
        if (editingId) {
          members = members.map(m => m.id === editingId ? { ...m, ...values } : m);
          notice.textContent = `Member ${editingId} updated.`;
          notify(`${name} (${editingId}) updated.`, 'success');
        } else {
          const id = peekNextId();            /* re-checked at save time so two quick saves can never share an ID */
          members.unshift({ id, ...values });
          commitId(id);
          registeredId = id;
          pendingNotice = (phoneIntl && f('member-notify').checked) ? { member: { id, ...values }, to: phoneIntl } : null;
          f('member-success-text').textContent = `${name} has been registered. Member number:`;
          f('member-success-id').textContent = id;
          notice.textContent = `${name} added with Member ID ${id}.`;
        }
        persist(); render(); location.hash = '#members';
        if (registeredId) {
          f('msg-card').hidden = true;
          f('member-success-dialog').showModal(); registeredId = null;
          if (pendingNotice) { showWelcomeMessage(pendingNotice.member, pendingNotice.to); pendingNotice = null; }
        }
      });
      f('member-success-ok').addEventListener('click', () => f('member-success-dialog').close());
      f('member-success-copy').addEventListener('click', async () => {
        const id = f('member-success-id').textContent;
        try { await navigator.clipboard.writeText(id); notify(`${id} copied.`, 'success'); } catch (_) { notify(`Member number: ${id}`, 'info'); }
      });

      rows.addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]'); if (!btn) return;
        const m = members.find(x => x.id === btn.closest('tr')?.dataset.memberId); if (!m) return;
        if (btn.dataset.action === 'edit') { pendingEdit = m; location.hash = '#member-new'; }
        if (btn.dataset.action === 'delete' && window.confirm(`Delete ${m.name} (${m.id})? This ID will not be reused.`)) {
          members = members.filter(x => x.id !== m.id);
          persist();
          render();
          notice.textContent = `Member ${m.id} deleted.`;
          window.ChurchDB?.deleteItem('members', m.id);
        }
      });
      commitId(format(Math.max(readSeq(), ...members.map(m => numberOf(m.id)))));
      function reloadFromCloud() {
        try {
          const saved = JSON.parse(localStorage.getItem(STORE));
          if (Array.isArray(saved)) {
            members = saved;
            window.churchMembers = members;
            render();
          }
        } catch (_) {}
      }
      window.addEventListener('members-change', reloadFromCloud);
      window.addEventListener('storage', e => { if (e.key === STORE) reloadFromCloud(); });
      render();
    })();
