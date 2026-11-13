const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js/modules/backups.js'), 'utf8');

class Bus {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback) { const list = this.listeners.get(name) || []; list.push(callback); this.listeners.set(name, list); }
  dispatchEvent(event) { return Promise.all((this.listeners.get(event.type) || []).map(callback => callback(event))); }
  async emit(name, details = {}) { return this.dispatchEvent({ type: name, ...details }); }
}

class Node extends Bus {
  constructor(tagName = 'div') {
    super();
    this.tagName = tagName.toUpperCase(); this.children = []; this.hidden = false; this.disabled = false;
    this.textContent = ''; this.dataset = {}; this.attributes = {}; this.className = '';
    this.href = ''; this.download = ''; this.type = ''; this.clicked = false;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  classList = { toggle() {} };
  click() { this.clicked = true; return this.dispatchEvent({ type: 'click', target: this }); }
  remove() { this.removed = true; }
}

function environment(options = {}) {
  const window = new Bus();
  const document = new Bus();
  const elements = new Map();
  const created = [];
  const make = (id, tag = 'div') => {
    if (!elements.has(id)) elements.set(id, new Node(tag));
    return elements.get(id);
  };
  ['backup-status', 'backup-create', 'backup-list', 'backup-count', 'backup-empty', 'settings'].forEach(id => make(id, id === 'backup-create' ? 'button' : id === 'backup-list' ? 'tbody' : 'div'));
  document.getElementById = id => elements.get(id) || null;
  document.createElement = tag => { const node = new Node(tag); created.push(node); return node; };
  document.body = new Node('body'); document.documentElement = new Node('html'); document.visibilityState = 'visible';

  const calls = { list: 0, policy: 0, create: [], download: [] };
  let backups = options.backups || [];
  const policy = options.policy === undefined ? { ready: true, backupRetention: 10 } : options.policy;
  const db = {
    securityPolicy: policy,
    async getSecurityPolicy() { calls.policy++; return policy; },
    async listBackups() { calls.list++; return backups; },
    async createBackup(payload) {
      calls.create.push(payload);
      if (options.create) return options.create(payload);
      const created = { id: 'new-backup', createdAt: '2026-11-13T00:00:00Z', recordCount: 2, automatic: false };
      backups = [created, ...backups];
      return created;
    },
    async downloadBackup(id) { calls.download.push(id); return options.download || { id, records: [{ name: 'Protected record' }] }; }
  };
  const notifications = [];
  Object.assign(window, {
    ChurchDB: db,
    ChurchAccess: { isMainAdmin: () => options.mainAdmin !== false },
    notify: (message, type, title) => notifications.push({ message, type, title }),
    Blob
  });
  const location = { hash: options.hash || '#settings' };
  const objectUrls = [];
  const urlApi = {
    createObjectURL(blob) { objectUrls.push(blob); return `blob:test-${objectUrls.length}`; },
    revokeObjectURL() {}
  };
  const context = vm.createContext({ window, document, location, URL: urlApi, Blob, CustomEvent: class { constructor(type, detail = {}) { this.type = type; Object.assign(this, detail); } }, setTimeout: fn => { fn(); return 1; }, clearTimeout() {}, console: { warn() {} } });
  vm.runInContext(source, context);
  return { window, document, elements, db, calls, notifications, created, objectUrls, location, async settle() { await new Promise(resolve => setImmediate(resolve)); } };
}

test('ready Main Admin renders backend metadata with textContent-safe values', async () => {
  const env = environment({ backups: [{ id: '<unsafe-id>', createdAt: '2026-11-12T12:00:00Z', recordCount: 7, automatic: true }] });
  await env.settle();
  const row = env.elements.get('backup-list').children[0];
  assert.equal(env.calls.list, 1);
  assert.equal(row.children[1].textContent, '7');
  assert.equal(row.children[2].textContent, 'Automatic');
  assert.equal(row.children[3].children[0].children[0].textContent, 'Download');
  assert.equal(row.dataset.backupId, '<unsafe-id>');
  assert.equal(env.elements.get('backup-count').textContent, '1');
  assert.equal(env.elements.get('backup-empty').hidden, true);
});

test('non-Main Admin cannot list or create backups', async () => {
  const env = environment({ mainAdmin: false });
  await env.settle();
  await env.elements.get('backup-create').click();
  assert.equal(env.calls.policy, 0);
  assert.equal(env.calls.list, 0);
  assert.equal(env.calls.create.length, 0);
});

test('unready security policy shows setup-required state and never creates a real backup', async () => {
  const env = environment({ policy: { ready: false, policybackupRetention: 10 } });
  await env.settle();
  assert.match(env.elements.get('backup-status').textContent, /setup is required/i);
  assert.equal(env.elements.get('backup-empty').hidden, false);
  await env.elements.get('backup-create').click();
  assert.equal(env.calls.create.length, 0);
  assert.equal(env.notifications.some(item => item.type === 'success'), false);
});

test('manual creation sends automatic false and reports success only after an actual backend id', async () => {
  const env = environment({ backups: [], policy: { ready: true, policybackupRetention: 3 } });
  await env.settle();
  const pending = env.elements.get('backup-create').click();
  assert.equal(env.elements.get('backup-create').disabled, true);
  assert.equal(env.elements.get('backup-create').textContent, 'Create backup');
  await pending; await env.settle();
  assert.equal(env.calls.create.length, 1);
  assert.equal(env.calls.create[0].automatic, false);
  assert.equal(env.elements.get('backup-create').disabled, false);
  const success = env.notifications.find(item => item.type === 'success');
  assert.ok(success);
  assert.match(success.message, /1 of 3 retention copies/);
});

test('created false with a backend reason is not reported as a successful backup', async () => {
  const env = environment({ create: async () => ({ created: false, reason: 'Backup policy is not installed.' }) });
  await env.settle();
  await env.elements.get('backup-create').click();
  assert.equal(env.notifications.some(item => item.type === 'success'), false);
  assert.ok(env.notifications.some(item => /policy is not installed/i.test(item.message)));
});

test('settings changes refresh the list while unrelated data changes do not', async () => {
  const env = environment();
  await env.settle();
  const initial = env.calls.list;
  await env.window.emit('church-data-change', { detail: { stores: ['church-members-v1'] } });
  assert.equal(env.calls.list, initial);
  await env.window.emit('church-data-change', { detail: { stores: ['church-reconstruction-settings-v1'] } });
  await env.settle();
  assert.equal(env.calls.list, initial + 1);
  await env.window.emit('security-policy-change', { detail: { stores: ['setting'] } });
  await env.settle();
  assert.equal(env.calls.list, initial + 2);
});

test('download uses protected backend JSON, application/json Blob, and a local date/id filename', async () => {
  const env = environment({ backups: [{ id: 'backup-42', createdAt: '2026-11-13T00:00:00Z', recordCount: 1, automatic: false }] });
  await env.settle();
  const button = env.elements.get('backup-list').children[0].children[3].children[0].children[0];
  await button.click();
  assert.deepEqual(env.calls.download, ['backup-42']);
  assert.equal(env.objectUrls.length, 1);
  assert.equal(env.objectUrls[0].type, 'application/json');
  const link = env.created.find(node => node.tagName === 'A');
  assert.ok(link);
  assert.match(link.download, /^application-backup-\d{4}-\d{2}-\d{2}-backup-42\.json$/);
  assert.equal(link.href, 'blob:test-1');
  assert.equal(link.clicked, true);
});
