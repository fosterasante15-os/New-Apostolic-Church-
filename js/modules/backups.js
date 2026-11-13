/* Main Admin backup controls. Backup bytes and retention are always supplied by the protected backend. */
(() => {
  const $ = id => document.getElementById(id);
  const status = $('backup-status');
  const createButton = $('backup-create');
  const rows = $('backup-list');
  const count = $('backup-count');
  const empty = $('backup-empty');
  if (!status || !createButton || !rows || !count) return;

  const DEFAULT_BUTTON_LABEL = 'Create backup';
  let pending = false;
  let refreshNumber = 0;
  let currentPolicy = null;

  const isMainAdmin = () => Boolean(window.ChurchAccess?.isMainAdmin?.());
  const isSettingsRouteVisible = () => {
    if (typeof location !== 'undefined' && location.hash) return location.hash === '#settings';
    const section = $('settings');
    return !section || section.hidden !== true;
  };
  const db = () => window.ChurchDB;
  const setupMessage = 'Backup service setup is required before real backups can be created.';
  const readableError = error => {
    const text = String(error?.message || error || '').trim();
    if (!text || /failed to fetch|networkerror|network request/i.test(text)) return 'The backup service could not be reached. Try again when the connection is available.';
    if (/schema|relation|function|rpc|not found|does not exist|setup|required|migration/i.test(text)) return setupMessage;
    return text;
  };
  const setStatus = (message, state = 'info') => {
    status.textContent = message;
    if (status.dataset) status.dataset.state = state;
    status.classList?.toggle('is-error', state === 'error');
    status.classList?.toggle('is-success', state === 'success');
  };
  const setButtonState = disabled => {
    createButton.disabled = Boolean(disabled);
    /* Never replace this label with a progress message; this is stable for keyboard and mobile users. */
    createButton.textContent = DEFAULT_BUTTON_LABEL;
  };
  const retentionFrom = policy => {
    const value = policy?.backupRetention ?? policy?.policybackupRetention ?? policy?.retention;
    const number = Number(value);
    return Number.isFinite(number) && number >= 1 ? Math.floor(number) : null;
  };
  const policyIsReady = policy => Boolean(policy && policy.ready === true);
  const isSettingStore = stores => {
    const values = Array.isArray(stores) ? stores : [stores];
    return values.some(value => /(^|[-_/])settings?$|church-reconstruction-settings-v1|security-policy/i.test(String(value || '').toLowerCase()));
  };
  const dateText = value => {
    const date = new Date(value);
    if (value && !Number.isNaN(date.getTime())) {
      try { return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (_) { return date.toISOString(); }
    }
    return String(value || '—');
  };
  const recordText = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '—';
  const typeText = automatic => automatic ? 'Automatic' : 'Manual';
  const backupId = backup => backup && backup.id !== undefined && backup.id !== null ? String(backup.id).trim() : '';

  function showEmpty(show, message = 'No backups have been created yet.') {
    if (!empty) return;
    empty.textContent = message;
    empty.hidden = !show;
  }

  function render(list) {
    const backups = Array.isArray(list) ? list : [];
    count.textContent = String(backups.length);
    rows.replaceChildren();
    showEmpty(backups.length === 0);
    backups.forEach(backup => {
      const id = backupId(backup);
      const row = document.createElement('tr');
      row.dataset.backupId = id;
      const created = document.createElement('td'); created.textContent = dateText(backup.createdAt);
      const records = document.createElement('td'); records.textContent = recordText(backup.recordCount);
      const type = document.createElement('td'); type.textContent = typeText(Boolean(backup.automatic));
      const actionCell = document.createElement('td');
      const actionGroup = document.createElement('div'); actionGroup.className = 'row-actions';
      const download = document.createElement('button');
      download.type = 'button'; download.className = 'plain-button'; download.textContent = 'Download';
      download.disabled = !id;
      download.addEventListener('click', () => downloadBackup(id, download, backup.createdAt));
      actionGroup.append(download); actionCell.append(actionGroup);
      row.append(created, records, type, actionCell);
      rows.append(row);
    });
  }

  async function getPolicy() {
    const api = db();
    if (!api) return null;
    if (typeof api.getSecurityPolicy === 'function') return await api.getSecurityPolicy();
    return api.securityPolicy || null;
  }

  async function refreshBackups() {
    if (!isMainAdmin() || !isSettingsRouteVisible()) return [];
    const api = db();
    const requestNumber = ++refreshNumber;
    if (!api || typeof api.listBackups !== 'function') {
      currentPolicy = null;
      render([]);
      setStatus(setupMessage, 'error');
      showEmpty(true, setupMessage);
      return [];
    }
    if (!pending) setStatus('Loading backups…', 'info');
    try {
      const policy = await getPolicy();
      if (requestNumber !== refreshNumber) return [];
      currentPolicy = policy || null;
      if (api && policy && typeof policy === 'object') api.securityPolicy = { ready: policy.ready === true, ...(policy.policy || policy) };
      if (!policyIsReady(policy)) {
        render([]);
        setStatus(setupMessage, 'error');
        showEmpty(true, setupMessage);
        return [];
      }
      const list = await api.listBackups();
      if (requestNumber !== refreshNumber) return [];
      const backups = Array.isArray(list) ? list : [];
      render(backups);
      setStatus(backups.length ? 'Backups are ready.' : 'No backups have been created yet.', 'success');
      return backups;
    } catch (error) {
      if (requestNumber !== refreshNumber) return [];
      render([]);
      const message = readableError(error);
      setStatus(message, 'error');
      showEmpty(true, message);
      return [];
    }
  }

  function notify(message, type, title) {
    if (typeof window.notify === 'function') window.notify(message, type, title);
  }

  async function createBackup() {
    if (pending || !isMainAdmin()) return;
    const api = db();
    if (!api || typeof api.createBackup !== 'function') {
      setStatus(setupMessage, 'error'); showEmpty(true, setupMessage); notify(setupMessage, 'error', 'Backup setup required'); return;
    }
    pending = true; setButtonState(true);
    try {
      const policy = await getPolicy();
      currentPolicy = policy || null;
      if (policy && typeof policy === 'object') api.securityPolicy = { ready: policy.ready === true, ...(policy.policy || policy) };
      if (!policyIsReady(policy)) {
        setStatus(setupMessage, 'error'); showEmpty(true, setupMessage);
        notify(setupMessage, 'error', 'Backup setup required');
        return;
      }
      const result = await api.createBackup({ automatic: false });
      const id = backupId(result);
      if (result?.created === false || !id) {
        const reason = readableError(result?.reason || 'The backend did not create a backup.');
        setStatus(reason, 'error');
        notify(reason, 'error', 'Backup not created');
        return;
      }
      /* The backend creates and prunes atomically. Re-read metadata; never prune or invent rows here. */
      const backups = await refreshBackups();
      const retention = retentionFrom(currentPolicy);
      const retained = backups.length;
      const detail = retention ? `${retained} of ${retention} retention copies.` : `${retained} retention copies.`;
      setStatus(`Backup created. ${detail}`, 'success');
      notify(`Backup created. ${detail}`, 'success', 'Backup created');
    } catch (error) {
      const message = readableError(error);
      setStatus(message, 'error');
      notify(message, 'error', 'Backup not created');
    } finally {
      pending = false; setButtonState(false);
    }
  }

  function blobFor(result) {
    const value = result && Object.prototype.hasOwnProperty.call(result, 'resultBlob') ? result.resultBlob : result;
    const BlobCtor = window.Blob || (typeof Blob !== 'undefined' ? Blob : null);
    if (!BlobCtor) throw new Error('This browser cannot prepare a backup download.');
    if (typeof BlobCtor !== 'undefined' && value instanceof BlobCtor) return value;
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    return new BlobCtor([payload], { type: 'application/json' });
  }
  const filenamePart = value => String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'backup';
  const backupDate = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
  };

  async function downloadBackup(id, button, createdAt) {
    if (!id || !isMainAdmin() || button?.disabled) return;
    const api = db();
    if (!api || typeof api.downloadBackup !== 'function') { notify(setupMessage, 'error', 'Backup setup required'); return; }
    if (button) button.disabled = true;
    try {
      const result = await api.downloadBackup(id);
      const blob = blobFor(result);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `application-backup-${backupDate(createdAt || new Date())}-${filenamePart(id)}.json`;
      link.hidden = true;
      (document.body || document.documentElement).append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL?.(objectUrl), 0);
    } catch (error) {
      notify(readableError(error), 'error', 'Backup download failed');
    } finally {
      if (button) button.disabled = false;
    }
  }

  createButton.addEventListener('click', createBackup);
  setButtonState(false);

  const refreshIfSettingsVisible = event => {
    if (event?.type === 'church-data-change' && !isSettingStore(event.detail?.stores)) return;
    if (isSettingsRouteVisible()) refreshBackups();
  };
  window.addEventListener('security-policy-change', refreshIfSettingsVisible);
  window.addEventListener('church-data-change', refreshIfSettingsVisible);
  window.addEventListener('hashchange', refreshIfSettingsVisible);
  window.addEventListener('pageshow', refreshIfSettingsVisible);
  window.addEventListener('focus', refreshIfSettingsVisible);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshIfSettingsVisible(); });
  refreshIfSettingsVisible();

  /* Small public surface keeps tests and the existing page integration explicit without storing data. */
  window.ChurchBackups = { refresh: refreshBackups, create: createBackup, download: downloadBackup };
})();
