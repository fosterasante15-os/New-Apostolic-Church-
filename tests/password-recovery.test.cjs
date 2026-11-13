const assert = require('node:assert/strict');
const test = require('node:test');
const recovery = require('../js/password-recovery.js');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('uses the exact reset page redirect URL', () => {
  assert.equal(recovery.recoveryRedirectUrl({ origin: 'https://church.example' }), 'https://church.example/reset-password.html');
});

test('keeps the recovery request response neutral and classifies provider failures', () => {
  assert.equal(recovery.classifyAuthError(new Error('User not found')), 'provider');
  assert.equal(recovery.classifyAuthError(new Error('email rate limit exceeded')), 'rate-limit');
  assert.equal(recovery.classifyAuthError(new Error('SMTP provider is not configured')), 'configuration');
});

test('matches the existing minimum and weak-password list', () => {
  assert.equal(recovery.isWeakPassword('password'), true);
  assert.equal(recovery.isWeakPassword('QWERTY123'), true);
  assert.equal(recovery.isWeakPassword('a-strong-password-42'), false);
});

test('PASSWORD_RECOVERY is deferred, then verifies the actual Auth user before opening reset UI', async () => {
  const calls = [];
  const auth = {
    getUser: async () => ({ data: { user: { id: 'real-user', email: 'member@example.com' } }, error: null })
  };
  let readyUser = null;
  let invalid = 0;
  const controller = recovery.createRecoveryController(auth, {
    onReady: user => { readyUser = user; },
    onInvalid: () => { invalid += 1; }
  });
  controller.handleAuthEvent('PASSWORD_RECOVERY', { access_token: 'recovery-token', user: { id: 'real-user' } });
  assert.equal(readyUser, null, 'callback must not await auth work inline');
  await wait(10);
  assert.equal(readyUser.id, 'real-user');
  assert.equal(invalid, 0);
  assert.equal(controller.isReady(), true);
  assert.deepEqual(calls, []);
});

test('rejects a recovery session when the verified current user differs from the recovery session user', async () => {
  let invalid = 0;
  const controller = recovery.createRecoveryController({
    getUser: async () => ({ data: { user: { id: 'different-user' } }, error: null })
  }, { onInvalid: () => { invalid += 1; } });
  await controller.activate({ access_token: 'recovery-token', user: { id: 'link-user' } });
  assert.equal(invalid, 1);
  assert.equal(controller.isReady(), false);
});

test('exchanges a PKCE code and only then enables password completion', async () => {
  const calls = [];
  let ready = 0;
  const controller = recovery.createRecoveryController({
    exchangeCodeForSession: async code => {
      calls.push(['exchange', code]);
      return { data: { session: { access_token: 'pkce-token', user: { id: 'pkce-user' } } }, error: null };
    },
    getUser: async () => {
      calls.push(['getUser']);
      return { data: { user: { id: 'pkce-user' } }, error: null };
    }
  }, { onReady: () => { ready += 1; } });
  await controller.exchangeCode('one-time-code');
  assert.deepEqual(calls, [['exchange', 'one-time-code'], ['getUser']]);
  assert.equal(ready, 1);
});

test('does not accept a cached-session-only activation', async () => {
  let invalid = 0;
  const controller = recovery.createRecoveryController({
    getUser: async () => ({ data: { user: { id: 'cached-user' } }, error: null })
  }, { onInvalid: () => { invalid += 1; } });
  await controller.activate(null);
  assert.equal(invalid, 1);
  assert.equal(controller.isReady(), false);
});
