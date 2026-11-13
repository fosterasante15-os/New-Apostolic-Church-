(() => {
      const storageKey = 'church-reconstruction-settings-v1';
      const form = document.getElementById('settings-form');
      if (!form) return;
      const notice = document.getElementById('settings-notice');
      const logoFile = document.getElementById('settings-logo-file');
      const logoPreview = document.getElementById('settings-logo-preview');
      const submit = form.querySelector('[type="submit"]');
      const mainAdmin = Boolean(window.ChurchAccess?.isMainAdmin());
      if (!mainAdmin) {
        form.querySelectorAll('input, select, textarea, button').forEach(control => { control.disabled = true; });
        notice.textContent = 'Only the main admin can change church profile, security, backup, or maintenance settings.';
      }
      let logoData = '';
      let pendingLogo = null;
      const FIELD_LABELS = { churchName: 'Church name', address: 'Address', phone: 'Phone', email: 'Email', timezone: 'Time zone', sessionTimeoutMinutes: 'Session timeout', failedLoginLimit: 'Failed login limit', lockoutMinutes: 'Lockout duration', backupRetention: 'Backup retention', autoBackupEnabled: 'Automatic backup', maintenanceMode: 'Maintenance mode' };
      function readValues() {
        const v = {};
        for (const field of form.querySelectorAll('[name]')) { if (field.type !== 'file') v[field.name] = field.type === 'checkbox' ? field.checked : field.value; }
        return v;
      }
      function savedState() {
        try { const s = JSON.parse(localStorage.getItem(storageKey) || 'null'); if (s && s.values) return { values: { ...defaultSettings(), ...s.values }, logo: s.logo || '' }; } catch (_) {}
        return { values: defaultSettings(), logo: '' };
      }
      function changedLabels(before, after, logoBefore, logoAfter) {
        const out = [];
        for (const key of Object.keys(after)) { if (String(before[key] ?? '') !== String(after[key] ?? '')) out.push(FIELD_LABELS[key] || key); }
        if (logoBefore !== logoAfter) out.push('Logo');
        return out;
      }
      const dialog = document.getElementById('settings-dialog'), dirty = document.getElementById('settings-dirty');
      document.getElementById('settings-dialog-ok')?.addEventListener('click', () => dialog.close());
      dialog?.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
      form.addEventListener('input', () => { dirty.hidden = false; });
      form.addEventListener('change', () => { dirty.hidden = false; });
      function announce(text, type, title, details) {
        notice.textContent = text;
        if (typeof window.notify === 'function') window.notify(text, type, title);
        if (details && dialog && typeof dialog.showModal === 'function') {
          document.getElementById('settings-dialog-title').textContent = title;
          document.getElementById('settings-dialog-text').textContent = details.length ? 'The following were updated:' : text;
          const list = document.getElementById('settings-dialog-list'); list.replaceChildren();
          details.forEach(d => { const li = document.createElement('li'); li.textContent = d; list.append(li); });
          list.hidden = !details.length;
          const icon = document.getElementById('settings-dialog-icon'); icon.classList.toggle('is-info', type === 'info'); icon.textContent = type === 'info' ? 'i' : '\u2713';
          if (!dialog.open) dialog.showModal();
          document.getElementById('settings-dialog-ok').focus();
        }
        if (type !== 'error') dirty.hidden = true;
      }

      function defaultSettings() {
        return {
          churchName: 'New Apostolic Church Kumasi Central', address: 'M9PW+3FQ, Kumasi, Ashanti, Ghana', phone: '', email: '',
          timezone: 'Africa/Accra', sessionTimeoutMinutes: '30', failedLoginLimit: '5', lockoutMinutes: '15', backupRetention: '10',
          autoBackupEnabled: false, maintenanceMode: false
        };
      }
      function showLogo(data) {
        logoPreview.replaceChildren();
        if (!data) { const mark = document.createElement('span'); mark.textContent = '✦'; logoPreview.append(mark); return; }
        const img = document.createElement('img'); img.src = data; img.alt = 'Selected church logo preview'; logoPreview.append(img);
      }
      function applySettings(data = defaultSettings(), savedLogo = '') {
        for (const [name,value] of Object.entries(data)) {
          const field = form.elements.namedItem(name);
          if (!field) continue;
          if (field.type === 'checkbox') field.checked = Boolean(value);
          else field.value = value ?? '';
        }
        logoData = savedLogo || '';
        pendingLogo = null; logoFile.value = ''; showLogo(logoData);
      }
      const DEFAULT_CHURCH_NAME = 'New Apostolic Church Kumasi Central';
      /* Put the saved logo, or the downloaded church image by default, in the sidebar tile beside the church name. */
      function applyLogo(name = window.churchProfile?.name || DEFAULT_CHURCH_NAME) {
        const mark = document.querySelector('.brand-mark');
        if (!mark) return;
        mark.replaceChildren();
        if (logoData) { const img = document.createElement('img'); img.src = logoData; img.alt = `${name} logo`; mark.append(img); mark.classList.add('has-logo'); mark.removeAttribute('aria-hidden'); }
        else { const img = document.createElement('img'); img.src = 'img/download.jpg'; img.alt = `${name} logo`; mark.append(img); mark.classList.add('has-logo'); mark.removeAttribute('aria-hidden'); }
      }
      /* Push the saved profile (name, logo, address, phone, email) to every place in the app that shows it. */
      function applyProfile() {
        const v = {};
        for (const field of form.querySelectorAll('[name]')) { if (field.type !== 'file') v[field.name] = field.type === 'checkbox' ? field.checked : field.value; }
        const name = (v.churchName || '').trim() || DEFAULT_CHURCH_NAME;
        const address = (v.address || '').trim(), phone = (v.phone || '').trim(), email = (v.email || '').trim();
        document.title = `${name} — Church Management`;
        document.querySelectorAll('[data-church-name]').forEach(el => { el.textContent = name; });
        document.querySelectorAll('[data-church-address]').forEach(el => { el.textContent = address; el.hidden = !address; });
        const contact = document.getElementById('church-contact');
        if (contact) {
          contact.replaceChildren();
          [['Phone', phone, /\d/.test(phone) ? `tel:${phone.replace(/[^\d+]/g, '')}` : ''], ['Email', email, email ? `mailto:${email}` : '']].forEach(([label, value, href]) => {
            if (!value) return;
            const line = document.createElement('span'); line.className = 'location-contact-line'; line.append(`${label}: `);
            if (href) { const link = document.createElement('a'); link.href = href; link.textContent = value; line.append(link); } else line.append(value);
            contact.append(line);
          });
        }
        applyLogo(name);
        const frame = document.getElementById('church-map'); if (frame) frame.title = `Map showing ${name}`;
        window.churchProfile = { name, address, phone, email };
        window.dispatchEvent(new CustomEvent('church-profile-change'));
      }

      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (saved && typeof saved === 'object' && saved.values) applySettings({...defaultSettings(),...saved.values}, saved.logo || '');
        else applySettings();
      } catch (_) { applySettings(); }
      applyProfile();

      window.ChurchDB?.onStoresChanged?.([storageKey], () => {
        if (dirty && !dirty.hidden) return;
        const state = savedState();
        applySettings(state.values, state.logo);
        applyProfile();
        window.dispatchEvent(new CustomEvent('maintenance-change'));
      });

      async function loadAuthoritativeSettings() {
        if (!mainAdmin || (dirty && !dirty.hidden)) return;
        try {
          const result = await window.ChurchDB.getSystemSettings();
          if (!result.ready || !result.settings?.values) throw new Error('Run security-settings-migration.sql once in Supabase SQL Editor to activate these settings.');
          localStorage.setItem(storageKey, JSON.stringify(result.settings));
          applySettings({ ...defaultSettings(), ...result.settings.values }, result.settings.logo || '');
          applyProfile();
          window.ChurchDB.securityPolicy = { ready: true, ...result.policy };
          window.dispatchEvent(new CustomEvent('security-policy-change'));
        } catch (error) { notice.textContent = error.message || 'Could not load authoritative cloud settings.'; }
      }
      window.addEventListener('hashchange', () => { if (location.hash === '#settings') loadAuthoritativeSettings(); });
      setTimeout(loadAuthoritativeSettings, 850);

      function readDataUrl(blob) {
        return new Promise((resolve,reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Could not read the selected logo.'));
          reader.readAsDataURL(blob);
        });
      }
      /* Any image, any shape: centre-crop to a square and resize so it fills the logo tile. */
      async function squareLogo(file) {
        const source = await readDataUrl(file);
        const image = await new Promise((resolve,reject) => {
          const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('That image could not be opened.')); img.src = source;
        });
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        if (!side) throw new Error('That image could not be opened.');
        const size = Math.min(256, side);
        const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Image resizing is not available in this browser.');
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, size, size);
        const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/webp',0.9));
        return await readDataUrl(blob || file);
      }
      logoFile.addEventListener('change', async () => {
        const file = logoFile.files?.[0];
        if (!file) return;
        if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { announce('Choose a JPEG, PNG, or WebP image.', 'error', 'Logo not updated'); logoFile.value = ''; return; }
        if (file.size > 8 * 1024 * 1024) { announce('Choose an image smaller than 8 MB.', 'error', 'Logo not updated'); logoFile.value = ''; return; }
        try {
          logoData = await squareLogo(file);
          showLogo(logoData); applyLogo();
          announce('Logo preview is ready. Click Save settings to save it to the cloud.', 'info', 'Logo ready');
          dirty.hidden = false;
        } catch (error) { announce(error.message || 'The logo could not be processed.', 'error', 'Logo not updated'); }
        logoFile.value = '';
      });
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!form.reportValidity()) { announce('Please correct the highlighted fields and try again.', 'error', 'Settings not saved'); return; }
        submit.disabled = true;
        try {
          const before = savedState();
          const values = readValues();
          const result = await window.ChurchDB.saveSystemSettings({ values, logo: logoData });
          if (!result.ready || !result.settings?.values) throw new Error('The server did not confirm settings persistence.');
          localStorage.setItem(storageKey, JSON.stringify(result.settings));
          applySettings({ ...defaultSettings(), ...result.settings.values }, result.settings.logo || '');
          window.ChurchDB.securityPolicy = { ready: true, ...result.policy };
          window.dispatchEvent(new CustomEvent('security-policy-change'));
          window.dispatchEvent(new CustomEvent('maintenance-change'));
          pendingLogo = null; logoFile.value = ''; showLogo(logoData);
          applyProfile();
          const changed = changedLabels(before.values, values, before.logo, logoData);
          if (changed.length) announce(`Updated: ${changed.join(', ')}. The changes now apply across the app.`, 'success', 'Settings saved', changed);
          else announce('Your settings are saved. No values were changed.', 'info', 'Settings saved', []);
        } catch (error) {
          announce(error?.name === 'QuotaExceededError' ? 'Browser storage is full; remove the logo or reduce its size, then try again.' : (error.message || 'Settings could not be saved in browser storage.'), 'error', 'Settings not saved');
        } finally { submit.disabled = false; }
      });
      document.getElementById('settings-reset').addEventListener('click', async () => {
        if (!mainAdmin || submit.disabled) return;
        submit.disabled = true;
        try {
          const result = await window.ChurchDB.saveSystemSettings({ values: defaultSettings(), logo: '' });
          if (!result.ready || !result.settings?.values) throw new Error('The server did not confirm defaults were saved.');
          localStorage.setItem(storageKey, JSON.stringify(result.settings));
          applySettings(result.settings.values, result.settings.logo || ''); applyProfile();
          window.ChurchDB.securityPolicy = { ready: true, ...result.policy };
          window.dispatchEvent(new CustomEvent('security-policy-change'));
          window.dispatchEvent(new CustomEvent('maintenance-change'));
          announce('Default settings are saved in Supabase and apply across devices.', 'success', 'Settings reset', ['Church profile and logo','Session and security options','Backup and maintenance options']);
        } catch (error) { announce(error.message || 'Defaults could not be saved.', 'error', 'Reset incomplete'); }
        finally { submit.disabled = false; }
      });
    })();
