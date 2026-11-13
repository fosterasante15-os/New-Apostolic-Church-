/* New Apostolic Church — self-service Supabase password recovery. */
(function (root) {
  'use strict';

  const MIN_PASSWORD_LENGTH = 8;
  const WEAK_PASSWORDS = new Set([
    '12345678', '123456789', '1234567890', '123456', '11111111',
    'admin123', 'admin', 'password', 'password1', 'password123', 'qwerty123'
  ]);
  const NEUTRAL_SENT_MESSAGE = 'If an account exists for that email, a reset link has been sent. Check your inbox and spam folder.';

  function isWeakPassword(password) {
    return WEAK_PASSWORDS.has(String(password || '').toLowerCase());
  }

  function classifyAuthError(error) {
    const text = String((error && (error.message || error.code || error.error_description)) || '').toLowerCase();
    if (/rate.?limit|too many|429|email rate/.test(text)) return 'rate-limit';
    if (/smtp|email provider|mail provider|redirect|allowlist|not configured|configuration|provider is disabled|email service/.test(text)) return 'configuration';
    return 'provider';
  }

  function recoveryRedirectUrl(locationObject) {
    const location = locationObject || root.location;
    return String(location.origin || '') + '/reset-password.html';
  }

  function createRecoveryController(auth, hooks) {
    hooks = hooks || {};
    let ready = false;
    let invalid = false;
    let activation = null;
    let recoveryUserId = null;

    function showInvalid() {
      if (ready || invalid) return;
      invalid = true;
      if (typeof hooks.onInvalid === 'function') hooks.onInvalid();
    }

    async function activate(session) {
      if (ready || invalid) return false;
      if (!session || !session.access_token || !auth || typeof auth.getUser !== 'function') {
        showInvalid();
        return false;
      }
      if (activation) return activation;
      activation = (async function () {
        const result = await auth.getUser();
        const user = result && result.data && result.data.user;
        const error = result && result.error;
        if (error || !user || !user.id) throw new Error('recovery-user-not-verified');
        if (session.user && session.user.id && session.user.id !== user.id) throw new Error('recovery-user-mismatch');
        ready = true;
        recoveryUserId = user.id;
        if (typeof hooks.onReady === 'function') hooks.onReady(user, session);
        return true;
      }()).catch(function () {
        showInvalid();
        return false;
      }).finally(function () {
        activation = null;
      });
      return activation;
    }

    function handleAuthEvent(event, session) {
      if (event !== 'PASSWORD_RECOVERY') return;
      /* Supabase warns that auth callbacks are awaited in order; do not await getUser here. */
      setTimeout(function () { activate(session); }, 0);
    }

    async function exchangeCode(code) {
      if (!code || !auth || typeof auth.exchangeCodeForSession !== 'function') {
        showInvalid();
        return false;
      }
      try {
        const result = await auth.exchangeCodeForSession(code);
        const session = result && result.data && result.data.session;
        if (result && result.error) throw result.error;
        if (!session) throw new Error('recovery-session-missing');
        return activate(session);
      } catch (_) {
        /* A browser client may already have consumed the code and emit PASSWORD_RECOVERY shortly. */
        setTimeout(function () { showInvalid(); }, 2500);
        return false;
      }
    }

    return { activate, exchangeCode, handleAuthEvent, isReady: function () { return ready; }, getUserId: function () { return recoveryUserId; } };
  }

  function initPage() {
    if (!root.document) return;
    const document = root.document;
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) themeToggle.addEventListener('click', function () {
      const dark = document.documentElement.getAttribute('data-theme') !== 'dark';
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      themeToggle.setAttribute('aria-pressed', String(dark));
      themeToggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      try { root.localStorage.setItem('church-theme-v1', dark ? 'dark' : 'light'); } catch (_) {}
    });
    const requestPanel = document.getElementById('request-panel');
    const resetPanel = document.getElementById('reset-panel');
    const successPanel = document.getElementById('success-panel');
    const requestForm = document.getElementById('password-recovery-request-form');
    const resetForm = document.getElementById('password-recovery-reset-form');
    const emailInput = document.getElementById('recovery-email');
    const newPassword = document.getElementById('new-password');
    const confirmPassword = document.getElementById('confirm-password');
    const requestMessage = document.getElementById('request-message');
    const resetMessage = document.getElementById('reset-message');
    const requestSubmit = document.getElementById('request-submit');
    const resetSubmit = document.getElementById('reset-submit');
    if (!requestPanel || !resetPanel || !successPanel || !requestForm || !resetForm) return;

    const context = root.__passwordRecoveryContext || { hasRecoveryHash: false, hasRecoveryQuery: false, code: '', hasAuthError: false };
    const recoveryIntent = !!(context.hasRecoveryHash || context.hasRecoveryQuery || context.code);
    const client = root.ChurchDB && root.ChurchDB.client;
    const auth = client && client.auth;
    let invalidTimer = null;
    let controller = null;

    function setMessage(element, text, ok) {
      if (!element) return;
      element.textContent = text || '';
      element.classList.toggle('ok', !!ok);
    }

    function showRequestMode(message) {
      requestPanel.hidden = false;
      resetPanel.hidden = true;
      successPanel.hidden = true;
      if (message) setMessage(requestMessage, message, false);
      if (emailInput) emailInput.focus();
    }

    function showResetMode() {
      if (invalidTimer) root.clearTimeout(invalidTimer);
      requestPanel.hidden = true;
      resetPanel.hidden = false;
      successPanel.hidden = true;
      setMessage(resetMessage, '', false);
      if (newPassword) newPassword.focus();
    }

    function showSuccessMode() {
      requestPanel.hidden = true;
      resetPanel.hidden = true;
      successPanel.hidden = false;
    }

    function showInvalidRecovery() {
      showRequestMode('This reset link is invalid or has expired. Enter your email to request a new link.');
    }

    function providerMessage(error) {
      if (/different.*password|same.*password|reuse|password.*different/i.test(error?.message || '')) return 'Choose a new password that is different from your previous password.';
      const kind = classifyAuthError(error);
      if (kind === 'rate-limit') return 'Too many requests were made. Please wait a while and try again.';
      if (kind === 'configuration') return 'Password recovery is not configured for this site yet. Please contact the site administrator.';
      return 'We could not complete that password recovery request right now. Please try again later.';
    }

    function resetFields() {
      if (newPassword) newPassword.value = '';
      if (confirmPassword) confirmPassword.value = '';
      root.ChurchPasswordVisibility?.mask(resetPanel, true);
    }

    async function finishRecovery() {
      try {
        /* A local sign-out clears the recovery session without redirecting or touching profiles. */
        if (auth && typeof auth.signOut === 'function') await auth.signOut({ scope: 'local' });
      } catch (_) {
        try { if (auth && typeof auth.signOut === 'function') await auth.signOut(); } catch (_) {}
      }
      resetFields();
      try { root.sessionStorage.removeItem('church-auth-v1'); } catch (_) {}
      showSuccessMode();
    }

    if (requestForm) requestForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (requestSubmit?.disabled) return;
      setMessage(requestMessage, '', false);
      if (!emailInput || !emailInput.value.trim() || (typeof emailInput.checkValidity === 'function' && !emailInput.checkValidity())) {
        setMessage(requestMessage, 'Enter a valid email address.', false);
        if (emailInput) emailInput.focus();
        return;
      }
      if (!auth || typeof auth.resetPasswordForEmail !== 'function') {
        setMessage(requestMessage, 'Password recovery is not connected to the authentication service yet. Please contact the site administrator.', false);
        return;
      }
      requestSubmit && (requestSubmit.disabled = true);
      try {
        const result = await client.auth.resetPasswordForEmail(emailInput.value.trim().toLowerCase(), { redirectTo: root.location.origin + '/reset-password.html' });
        if (result && result.error) throw result.error;
        setMessage(requestMessage, NEUTRAL_SENT_MESSAGE, true);
      } catch (error) {
        setMessage(requestMessage, providerMessage(error), false);
      } finally {
        requestSubmit && (requestSubmit.disabled = false);
      }
    });

    if (resetForm) resetForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (resetSubmit?.disabled) return;
      if (!controller?.isReady()) { showInvalidRecovery(); return; }
      setMessage(resetMessage, '', false);
      const password = newPassword ? newPassword.value : '';
      const confirmation = confirmPassword ? confirmPassword.value : '';
      if (password.length < MIN_PASSWORD_LENGTH) {
        setMessage(resetMessage, 'Use at least 8 characters.', false);
        newPassword && newPassword.focus();
        return;
      }
      if (isWeakPassword(password)) {
        setMessage(resetMessage, 'That password is too easy to guess. Choose a stronger password.', false);
        newPassword && newPassword.focus();
        return;
      }
      if (password !== confirmation) {
        setMessage(resetMessage, 'The passwords do not match.', false);
        confirmPassword && confirmPassword.focus();
        return;
      }
      if (!auth || typeof auth.updateUser !== 'function') {
        setMessage(resetMessage, 'Password recovery is not connected to the authentication service yet. Please contact the site administrator.', false);
        return;
      }
      resetSubmit && (resetSubmit.disabled = true);
      try {
        const verified = await auth.getUser();
        if (verified.error || verified.data?.user?.id !== controller.getUserId()) throw new Error('The recovery session changed. Request a new reset link.');
        const result = await auth.updateUser({ password: password });
        if (result && result.error) throw result.error;
        await finishRecovery();
      } catch (error) {
        setMessage(resetMessage, providerMessage(error), false);
      } finally {
        resetSubmit && (resetSubmit.disabled = false);
      }
    });

    if (!recoveryIntent) {
      /* Do not inspect or use an existing cached session on an ordinary visit. */
      showRequestMode();
      return;
    }

    if (context.hasAuthError) {
      showInvalidRecovery();
      return;
    }
    if (!auth) {
      showRequestMode('Password recovery is not connected to the authentication service yet. Please contact the site administrator.');
      return;
    }

    controller = createRecoveryController(auth, { onReady: showResetMode, onInvalid: showInvalidRecovery });
    if (typeof auth.onAuthStateChange === 'function') {
      auth.onAuthStateChange(function (event, session) { controller.handleAuthEvent(event, session); });
    }
    // URL detection is disabled only on this page. Consume its reset parameters
    // explicitly so PASSWORD_RECOVERY cannot fire before the listener is ready.
    if (context.hasRecoveryHash && context.accessToken && context.refreshToken) {
      const tokens = { access_token: context.accessToken, refresh_token: context.refreshToken };
      delete context.accessToken; delete context.refreshToken;
      if (root.history?.replaceState) root.history.replaceState(null, '', root.location.pathname);
      auth.setSession(tokens).then(function (result) {
        if (result.error || !result.data?.session) throw new Error('Invalid recovery session');
        return controller.activate(result.data.session);
      }).catch(showInvalidRecovery);
      return;
    }
    if (context.code) {
      controller.exchangeCode(context.code);
    } else if (context.hasRecoveryHash || context.hasRecoveryQuery) {
      /* A valid implicit-flow link emits PASSWORD_RECOVERY. Otherwise offer resend. */
      invalidTimer = root.setTimeout(function () {
        if (!controller.isReady()) showInvalidRecovery();
      }, 2500);
    }
  }

  const api = { isWeakPassword, classifyAuthError, recoveryRedirectUrl, createRecoveryController };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PasswordRecovery = api;
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', initPage);
    else initPage();
  }
}(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this)));
