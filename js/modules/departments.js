/* Departments: admins can create, edit and delete departments. Every department list in the app stays in sync. */
    (() => {
      const STORE = 'church-departments-v1';
      const seed = [
        ['Choir', 'Choir ministry'], ['Lactating Mothers', 'Pregnant Woman ministry'], ['Left Back Seat', 'Left Back Seat ministry'],
        ["Men's Fellowship", "Men's Fellowship ministry"], ['Middle Seat', 'Middle Seat ministry'], ['Right Back Seat', 'Right Back Seat ministry'],
        ['Sunday School', 'Sunday School ministry'], ["The Minister's Wife", "The Minister's Wife ministry"], ["Women's Fellowship", "Women's Fellowship ministry"],
        ["Children's Fellowship", "Children's ministry"], ['Youth Fellowship', 'Youth ministry'], ['Evangelism', 'Evangelism ministry'], ['Welfare', 'Welfare ministry']
      ].map(([name, description], i) => ({ id: `dept-seed-${i + 1}`, name, description }));
      let departments = seed;
      try {
        const saved = JSON.parse(localStorage.getItem(STORE));
        if (Array.isArray(saved) && saved.length) {
          const existing = new Set(saved.map(department => department.name));
          departments = [...saved, ...seed.filter(department => !existing.has(department.name))];
        }
      } catch (_) {}
      window.churchDepartments = departments;
      let counts = {}, editingId = null, pendingEdit = null;

      const f = id => document.getElementById(id);
      const rows = f('department-rows'), notice = f('department-notice'), form = f('department-form'), err = f('department-form-error');
      const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(departments)); window.churchDepartments = departments; } catch (_) { notice.textContent = 'Changes work for this session but could not be saved in browser storage.'; } };
      /* Departments are administrator-managed; Main Admin also has full access. */
      function isAdmin() { return window.ChurchAccess?.isAdmin ? window.ChurchAccess.isAdmin() : true; }
      const adminOnly = () => { if (isAdmin()) return true; notify('Only an admin can add, edit or delete departments.', 'error', 'Admin access needed'); return false; };

      /* Rebuild every department dropdown in the app (keeps the first "All…" option and the current choice). */
      function fillSelects() {
        document.querySelectorAll('#member-dept-filter, #attendance-department, select[data-filter="department"]').forEach(sel => {
          const keep = sel.value, first = sel.options[0];
          [...sel.options].slice(1).forEach(o => o.remove());
          departments.forEach(d => sel.add(new Option(d.name, d.name)));
          sel.value = [...sel.options].some(o => o.value === keep) ? keep : first.value;
        });
        window.dispatchEvent(new CustomEvent('departments-change', { detail: departments.map(d => d.name) }));
      }

      function render() {
        rows.replaceChildren();
        departments.forEach(d => {
          const tr = document.createElement('tr'); tr.dataset.departmentId = d.id;
          const td = (...kids) => { const c = document.createElement('td'); c.append(...kids); return c; };
          const name = document.createElement('strong'); name.textContent = d.name;
          const desc = td(d.description || '—'); desc.className = 'contact';
          const actions = document.createElement('div'); actions.className = 'row-actions';
          const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.action = 'edit'; edit.textContent = 'Edit';
          const del = document.createElement('button'); del.type = 'button'; del.dataset.action = 'delete'; del.className = 'delete'; del.textContent = 'Delete';
          actions.append(edit, del);
          tr.append(td(name), desc, td(String(counts[d.name] || 0)), td(actions)); rows.append(tr);
        });
        f('department-count').textContent = `${departments.length} ${departments.length === 1 ? 'department' : 'departments'}`;
      }

      function prepareForm(dept) {
        editingId = dept ? dept.id : null; err.textContent = '';
        f('department-form-title').textContent = dept ? 'Edit department' : 'Add department';
        f('department-crumb').textContent = dept ? 'Edit' : 'New';
        f('department-save').textContent = dept ? 'Save changes' : 'Create department';
        f('department-name').value = dept?.name || ''; f('department-desc').value = dept?.description || '';
        window.scrollTo(0, 0); f('department-name').focus({ preventScroll: true });
      }
      function onRoute() {
        if (location.hash !== '#department-new') return;
        if (!isAdmin()) { notify('Only an admin can add, edit or delete departments.', 'error', 'Admin access needed'); location.hash = '#departments'; return; }
        prepareForm(pendingEdit); pendingEdit = null;
      }
      window.addEventListener('hashchange', onRoute);

      f('department-add').addEventListener('click', () => { if (!adminOnly()) return; pendingEdit = null; if (location.hash === '#department-new') prepareForm(null); else location.hash = '#department-new'; });

      form.addEventListener('submit', e => {
        e.preventDefault();
        if (!adminOnly()) return;
        const name = f('department-name').value.trim().replace(/\s+/g, ' '), description = f('department-desc').value.trim();
        if (!name) { err.textContent = 'Please enter a department name.'; f('department-name').focus(); return; }
        if (departments.some(d => d.name.toLowerCase() === name.toLowerCase() && d.id !== editingId)) { err.textContent = `A department named “${name}” already exists.`; f('department-name').focus(); return; }
        if (editingId) {
          const old = departments.find(d => d.id === editingId);
          departments = departments.map(d => d.id === editingId ? { ...d, name, description } : d);
          if (old && old.name !== name) window.dispatchEvent(new CustomEvent('department-renamed', { detail: { from: old.name, to: name } }));
          notice.textContent = `Department “${name}” updated.`; notify(`Department “${name}” updated.`, 'success');
        } else {
          departments.push({ id: `dept-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, description });
          notice.textContent = `Department “${name}” created.`; notify(`Department “${name}” created. It is now available when registering members.`, 'success', 'Department added');
        }
        persist(); fillSelects(); render(); location.hash = '#departments';
      });

      rows.addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]'); if (!btn) return;
        const d = departments.find(x => x.id === btn.closest('tr')?.dataset.departmentId); if (!d) return;
        if (!adminOnly()) return;
        if (btn.dataset.action === 'edit') { pendingEdit = d; location.hash = '#department-new'; return; }
        const n = counts[d.name] || 0;
        if (n > 0) { notify(`“${d.name}” still has ${n} ${n === 1 ? 'member' : 'members'}. Move them to another department first.`, 'error', 'Cannot delete'); return; }
        if (window.confirm(`Delete the department “${d.name}”?`)) {
          departments = departments.filter(x => x.id !== d.id);
          persist();
          fillSelects();
          render();
          notice.textContent = `Department “${d.name}” deleted.`;
          window.ChurchDB?.deleteItem('departments', d.id || d.name);
        }
      });

      /* Member counts come from the members module. */
      window.addEventListener('members-change', e => { counts = {}; (e.detail || []).forEach(m => { window.memberDepartments(m).forEach(d => { counts[d] = (counts[d] || 0) + 1; }); }); render(); });
      function reloadDepartments() {
        try {
          const saved = JSON.parse(localStorage.getItem(STORE));
          if (Array.isArray(saved)) {
            departments = saved;
            window.churchDepartments = departments;
            fillSelects();
            render();
          }
        } catch (_) {}
      }
      window.addEventListener('departments-change', reloadDepartments);
      window.addEventListener('storage', e => { if (e.key === STORE) reloadDepartments(); });
      fillSelects(); render(); onRoute();
    })();
