/* User-side notifications: shows the signed-in user any notice queued for them (e.g. password reset). */
    (() => {
      const KEY = 'church-user-notices-v1';
      const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
      const write = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (_) {} };
      const me = () => { try { return JSON.parse(sessionStorage.getItem('church-auth-v1') || 'null'); } catch (_) { return null; } };
      const shown = new Set();
      function banner(notice) {
        let host = document.getElementById('user-notice-stack');
        if (!host) {
          host = document.createElement('div'); host.id = 'user-notice-stack'; host.setAttribute('aria-live', 'polite');
          host.style.cssText = 'display:grid;gap:10px;margin:0 0 18px';
          const main = document.querySelector('main'); if (!main) return; main.prepend(host);
        }
        const box = document.createElement('div'); box.setAttribute('role', 'status');
        box.className = 'user-notice';
        const text = document.createElement('div'); text.style.flex = '1';
        const h = document.createElement('strong'); h.textContent = notice.title; h.style.display = 'block';
        const p = document.createElement('span'); p.textContent = notice.message; p.style.fontSize = '13px';
        text.append(h, p);
        const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Dismiss'; close.className = 'plain-button';
        close.addEventListener('click', () => { box.remove(); write(read().filter(n => n.id !== notice.id)); });
        box.append(text, close); host.append(box);
      }
      function check() {
        const user = me(); if (!user?.id) return;
        read().filter(n => n.userId === user.id && !shown.has(n.id)).forEach(n => {
          shown.add(n.id);
          window.notify?.(n.message, 'info', n.title);
          banner(n);
        });
      }
      document.addEventListener('DOMContentLoaded', () => setTimeout(check, 400));
      window.addEventListener('user-notices-change', check);
      window.addEventListener('storage', e => { if (e.key === KEY) check(); });
    })();

/* Profile: avatar (photo or first letter), account menu, and "Customize profile". */
    (() => {
      const KEY = 'church-profiles-v1', $ = id => document.getElementById(id);
      const access = window.ChurchAccess;
      const sess = () => { try { return JSON.parse(sessionStorage.getItem('church-auth-v1') || 'null') || {}; } catch (_) { return {}; } };
      const profiles = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (_) { return {}; } };
      const saveProfiles = p => { try { localStorage.setItem(KEY, JSON.stringify(p)); return true; } catch (_) { return false; } };
      const ROLE = { 'main-admin': 'Main admin', admin: 'Administrator', account: 'Account' };
      const me = sess();
      if (!me.id) return;
      const mine = () => profiles()[me.id] || {};
      const displayName = () => (mine().name || sess().name || String(sess().email || '').split('@')[0] || 'User').trim();
      const letter = () => (displayName().match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();

      function paint(el, photo) {
        el.replaceChildren();
        if (photo) { const img = document.createElement('img'); img.alt = ''; img.src = photo; img.addEventListener('error', () => { el.replaceChildren(document.createTextNode(letter())); }); el.append(img); }
        else el.textContent = letter();
      }
      function render() {
        const photo = mine().photo || '';
        ['profile-avatar', 'profile-menu-avatar'].forEach(id => paint($(id), photo));
        $('profile-menu-name').textContent = displayName();
        $('profile-menu-email').textContent = sess().email || '';
        $('profile-menu-role').textContent = ROLE[String(sess().role || '').toLowerCase()] || 'User';
        $('profile-trigger').setAttribute('aria-label', `Account menu for ${displayName()}`);
        const hi = $('user-greeting');
        if (hi) { const first = (displayName().split(/\s+/)[0] || 'there').replace(/[^\p{L}'’-]/gu, ''); const h = new Date().getHours(); hi.textContent = `Good ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}, ${first || 'there'}`; }
      }
      if (mine().name) access?.setName?.(mine().name);   /* a saved display name overrides the default after each sign-in */
      render();

      /* ----- account menu ----- */
      const wrap = $('profile-menu-wrap'), trigger = $('profile-trigger'), menu = $('profile-menu'), topbar = document.querySelector('.topbar');
      const setOpen = open => { menu.hidden = !open; trigger.setAttribute('aria-expanded', String(open)); topbar?.classList.toggle('menu-open', open); if (open) menu.querySelector('[role="menuitem"]')?.focus(); };
      trigger.addEventListener('click', () => setOpen(menu.hidden));
      document.addEventListener('click', e => { if (!menu.hidden && !wrap.contains(e.target)) setOpen(false); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { setOpen(false); trigger.focus(); } });
      menu.addEventListener('keydown', e => { if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return; e.preventDefault(); const items = [...menu.querySelectorAll('[role="menuitem"]')], i = items.indexOf(document.activeElement); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); });
      $('logout-button').addEventListener('click', () => setOpen(false));   /* the existing logout confirmation then opens */

      /* ----- customize profile ----- */
      const dialog = $('profile-dialog'), nameInput = $('profile-name'), file = $('profile-file'), errorBox = $('profile-error');
      let draftPhoto = '';
      const showDraft = () => { paint($('profile-preview'), draftPhoto); if (!draftPhoto) $('profile-preview').textContent = (nameInput.value.trim().match(/[\p{L}\p{N}]/u) || [letter()])[0].toUpperCase(); };
      $('customize-profile').addEventListener('click', () => {
        setOpen(false); errorBox.textContent = '';
        draftPhoto = mine().photo || ''; nameInput.value = displayName(); $('profile-email').value = sess().email || ''; showDraft();
        dialog.showModal(); nameInput.focus();
      });
      nameInput.addEventListener('input', () => { if (!draftPhoto) showDraft(); });
      $('profile-change').addEventListener('click', () => file.click());
      $('profile-remove').addEventListener('click', () => { draftPhoto = ''; file.value = ''; showDraft(); });
      $('profile-close').addEventListener('click', () => dialog.close()); $('profile-cancel').addEventListener('click', () => dialog.close());
      file.addEventListener('change', () => {
        const f = file.files && file.files[0]; if (!f) return; errorBox.textContent = '';
        if (!/^image\//.test(f.type)) { errorBox.textContent = 'Choose an image file (JPG, PNG or WebP).'; return; }
        if (f.size > 10 * 1024 * 1024) { errorBox.textContent = 'That image is too large. Choose one under 10 MB.'; return; }
        const url = URL.createObjectURL(f), img = new Image();
        img.onload = () => {
          const size = 256, c = document.createElement('canvas'); c.width = c.height = size; const ctx = c.getContext('2d');
          const side = Math.min(img.naturalWidth, img.naturalHeight), sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);   /* square centre-crop, kept small for browser storage */
          draftPhoto = c.toDataURL('image/jpeg', 0.85); URL.revokeObjectURL(url); showDraft();
        };
        img.onerror = () => { URL.revokeObjectURL(url); errorBox.textContent = 'That image could not be read. Try another one.'; };
        img.src = url;
      });
      $('profile-form').addEventListener('submit', event => {
        event.preventDefault();
        const name = nameInput.value.trim();
        if (!name) { errorBox.textContent = 'Enter a display name.'; nameInput.focus(); return; }
        const all = profiles(); all[me.id] = { name, photo: draftPhoto };
        if (!saveProfiles(all)) { errorBox.textContent = 'Could not save. The photo may be too large for browser storage.'; return; }
        access?.setName?.(name); render(); dialog.close();
        window.notify?.('Your profile has been updated.', 'success', 'Profile saved');
      });
      window.addEventListener('storage', e => { if (e.key === KEY) render(); });
    })();

/* Light / dark theme switch (moon = go dark, sun = go light). The choice is remembered per browser. */
    (() => {
      const KEY = 'church-theme-v1', root = document.documentElement, btn = document.getElementById('theme-toggle');
      if (!btn) return;
      const current = () => root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      function sync() {
        const dark = current() === 'dark';
        btn.setAttribute('aria-pressed', String(dark));
        const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
        btn.setAttribute('aria-label', label); btn.title = label;
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta); }
        meta.content = dark ? '#0f1a22' : '#123d55';
      }
      btn.addEventListener('click', () => {
        const next = current() === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        try { localStorage.setItem(KEY, next); } catch (_) {}
        sync();
      });
      window.addEventListener('storage', e => { if (e.key === KEY) { root.setAttribute('data-theme', e.newValue === 'dark' ? 'dark' : 'light'); sync(); } });
      sync();
    })();
