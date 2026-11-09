(() => {
      const storageKey = 'church-reconstruction-ministers-v1';
      const seed = [
        { id: 'seed-minister-001', order: 1, name: 'Minister 001', role: 'Congregational Rector', note: 'Leads worship and pastoral care for the congregation.', photo: '' },
        { id: 'seed-minister-002', order: 2, name: 'Minister 002', role: "Women's Fellowship Leader", note: 'Supports the women of the congregation and helps coordinate fellowship gatherings.', photo: '' },
        { id: 'seed-minister-003', order: 3, name: 'Minister 003', role: "Men's Fellowship Leader", note: 'Serves the men of the church and assists with Sunday service arrangements.', photo: '' }
      ];
      let ministers = seed;
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey));
        if (Array.isArray(saved) && saved.length > 0) ministers = saved;
        else if (!localStorage.getItem(storageKey)) {
          localStorage.setItem(storageKey, JSON.stringify(ministers));
        }
      } catch (_) {}
      window.churchMinisters = ministers;

      const cards = document.getElementById('minister-cards');
      const notice = document.getElementById('minister-notice');
      const formError = document.getElementById('minister-form-error');
      const dialog = { showModal() { location.hash = '#minister-new'; window.scrollTo(0, 0); }, close() { location.hash = '#ministers'; } };
      const form = document.getElementById('minister-form');
      const nameInput = document.getElementById('minister-name');
      const roleInput = document.getElementById('minister-role');
      const noteInput = document.getElementById('minister-note-input');
      const photoInput = document.getElementById('minister-photo-input');
      const saveButton = document.getElementById('minister-save');
      const orderInput = document.getElementById('minister-order');
      const photoPreview = document.getElementById('minister-photo-preview');
      const photoChoose = document.getElementById('minister-photo-choose');
      const photoRemove = document.getElementById('minister-photo-remove');
      const sortedMinisters = () => ministers.map((m, i) => ({ m, i })).sort((a, b) => (Number(a.m.order) || 0) - (Number(b.m.order) || 0) || a.i - b.i).map(x => x.m);
      function showPhoto() {
        photoPreview.replaceChildren();
        if (currentPhoto) { const im = document.createElement('img'); im.src = currentPhoto; im.alt = 'Selected minister photo'; photoPreview.append(im); }
        else { const sp = document.createElement('span'); sp.textContent = 'No photo'; photoPreview.append(sp); }
        photoRemove.hidden = !currentPhoto;
        photoChoose.textContent = currentPhoto ? 'Change photo' : 'Choose from computer';
      }
      /* Shrinks large photos (longest side 600 px) so they fit in browser storage. */
      function resizePhoto(file) {
        return new Promise((resolve, reject) => {
          const url = URL.createObjectURL(file), img = new Image();
          img.onload = () => {
            const scale = Math.min(1, 600 / Math.max(img.width, img.height)), w = Math.round(img.width * scale), h = Math.round(img.height * scale);
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85));
          };
          img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image. Choose a JPEG, PNG, or WebP photo.')); };
          img.src = url;
        });
      }
      let editingId = null;
      let currentPhoto = '';

      function persist() {
        try { localStorage.setItem(storageKey, JSON.stringify(ministers)); window.churchMinisters = ministers; window.dispatchEvent(new CustomEvent('ministers-change')); }
        catch (_) { notice.textContent = 'Changes work for this session but could not be saved in browser storage.'; }
      }
      function button(label, action, className = '') {
        const el = document.createElement('button');
        el.type = 'button'; el.dataset.action = action; el.className = className; el.textContent = label;
        return el;
      }
      function render() {
        cards.replaceChildren();
        sortedMinisters().forEach(minister => {
          const card = document.createElement('article'); card.className = 'managed-minister-card'; card.dataset.ministerId = minister.id;
          if (minister.photo) {
            const image = document.createElement('img'); image.className = 'managed-minister-photo'; image.src = minister.photo; image.alt = `Photo of ${minister.name}`; card.append(image);
          } else {
            const avatar = document.createElement('div'); avatar.className = 'minister-avatar';
            avatar.textContent = minister.name.split(/\s+/).filter(Boolean).slice(0,2).map(part => part[0]).join('').toUpperCase() || 'M';
            card.append(avatar);
          }
          const name = document.createElement('h2'); name.textContent = minister.name;
          const role = document.createElement('div'); role.className = 'managed-minister-role'; role.textContent = minister.role;
          const note = document.createElement('p'); note.className = 'managed-minister-note'; note.textContent = minister.note;
          const actions = document.createElement('div'); actions.className = 'managed-minister-actions row-actions';
          actions.append(button('Edit','edit'),button('Delete','delete','delete'));
          card.append(name,role,note,actions); cards.append(card);
        });
        if (!ministers.length) {
          const empty = document.createElement('p'); empty.className = 'reconstruction-note'; empty.textContent = 'No ministers yet. Select Add minister to create one.'; cards.append(empty);
        }
      }
      function openDialog(minister = null) {
        editingId = minister ? minister.id : null;
        currentPhoto = minister?.photo || '';
        document.getElementById('minister-dialog-title').textContent = minister ? 'Edit minister' : 'Add minister';
        document.getElementById('minister-crumb').textContent = minister ? 'Edit minister' : 'Add minister';
        orderInput.value = minister ? (Number(minister.order) || 0) : 0;
        saveButton.textContent = minister ? 'Save changes' : 'Save minister';
        showPhoto();
        nameInput.value = minister?.name || '';
        roleInput.value = minister?.role || '';
        noteInput.value = minister?.note || '';
        photoInput.value = '';
        formError.textContent = '';
        dialog.showModal();
        setTimeout(() => nameInput.focus({ preventScroll: true }), 60);
      }
      function readPhoto(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Could not read this image file.'));
          reader.readAsDataURL(file);
        });
      }

      document.getElementById('minister-add').addEventListener('click', () => openDialog());
      photoChoose.addEventListener('click', () => photoInput.click());
      photoRemove.addEventListener('click', () => { currentPhoto = ''; photoInput.value = ''; showPhoto(); });
      photoInput.addEventListener('change', async () => {
        const file = photoInput.files?.[0]; if (!file) return;
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { formError.textContent = 'Choose a JPEG, PNG, or WebP photo.'; photoInput.value = ''; return; }
        formError.textContent = '';
        try { currentPhoto = await resizePhoto(file); showPhoto(); } catch (e) { formError.textContent = e.message; }
        photoInput.value = '';
      });
      document.getElementById('minister-cancel').addEventListener('click', () => dialog.close());
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const name = nameInput.value.trim();
        const role = roleInput.value.trim();
        const note = noteInput.value.trim();
        if (!name) { formError.textContent = 'Enter the minister’s full name.'; nameInput.focus(); return; }
        if (!role) { formError.textContent = 'Enter the role or title.'; roleInput.focus(); return; }
        if (!note) { formError.textContent = 'Enter a short piece of information.'; noteInput.focus(); return; }
        const order = Math.max(0, Math.round(Number(orderInput.value) || 0));
        formError.textContent = '';
        saveButton.disabled = true;
        try {
          const item = { name, role, note, photo: currentPhoto, order };
          if (editingId) {
            ministers = ministers.map(existing => existing.id === editingId ? { ...existing, ...item } : existing);
            notice.textContent = 'Minister updated.';
          } else {
            item.id = (crypto.randomUUID ? crypto.randomUUID() : `minister-${Date.now()}-${Math.random().toString(16).slice(2)}`);
            ministers.unshift(item);
            notice.textContent = 'Minister added.';
          }
          persist(); render(); dialog.close();
        } catch (error) {
          formError.textContent = error.message || 'The photo could not be saved.';
        } finally { saveButton.disabled = false; }
      });
      cards.addEventListener('click', event => {
        const action = event.target.closest('button[data-action]');
        if (!action) return;
        const card = action.closest('[data-minister-id]');
        const minister = ministers.find(item => item.id === card?.dataset.ministerId);
        if (!minister) return;
        if (action.dataset.action === 'edit') openDialog(minister);
        if (action.dataset.action === 'delete' && window.confirm(`Delete ${minister.name}?`)) {
          ministers = ministers.filter(item => item.id !== minister.id);
          persist(); render(); notice.textContent = 'Minister deleted.';
        }
      });
      function reloadMinisters() {
        try {
          const saved = JSON.parse(localStorage.getItem(storageKey));
          if (Array.isArray(saved) && saved.length) {
            ministers = saved;
            window.churchMinisters = ministers;
            render();
          }
        } catch (_) {}
      }
      window.addEventListener('ministers-change', reloadMinisters);
      window.addEventListener('storage', e => { if (e.key === storageKey) reloadMinisters(); });
      render();
    })();
