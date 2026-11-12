(() => {
  const USERS_KEY = 'church-reconstruction-users-v1', AUTH_KEY = 'church-auth-v1', SETTINGS_KEY = 'church-reconstruction-settings-v1';
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  function homeTarget() {
    try {
      const target = new URL(params.get('from') || window.CHURCH_HOME_URL || 'index.html', location.href);
      if (target.origin === location.origin && ['/', '/index.html'].includes(target.pathname)) return `index.html${target.search}${target.hash}`;
    } catch (_) {}
    return 'index.html';
  }
  const HOME = homeTarget();
  const message = (text, ok) => { $('auth-message').textContent = text; $('auth-message').classList.toggle('ok', Boolean(ok)); };
  const readJson = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch (_) { return fallback; } };
  const ACT_KEY = 'church-activity-v1';
  let manualSignInStarted = false;
  function logActivity(entry) {
    try {
      const list = readJson(ACT_KEY, []); const arr = Array.isArray(list) ? list : [];
      arr.push({ id: `a-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), entity: 'user', ...entry });
      localStorage.setItem(ACT_KEY, JSON.stringify(arr.slice(-500)));
    } catch (_) {}
  }
  function recordLogin(user) {
    try {
      const list = readJson(USERS_KEY, []);
      if (!Array.isArray(list)) return;
      const when = new Date().toISOString();
      const next = list.map(item => item.id === user.id ? { ...item, email: user.email, lastLogin: when, current: true } : { ...item, current: false });
      localStorage.setItem(USERS_KEY, JSON.stringify(next));
    } catch (_) {}
  }
  function clearAppSession() { try { sessionStorage.removeItem(AUTH_KEY); } catch (_) {} }

  // A cached role is not proof of a current login. Never auto-forward it.
  let cached = null; try { cached = JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null'); } catch (_) {}
  if (cached && !window.ChurchDB?.isValidAppSession?.(cached)) clearAppSession();
  if (params.has('loggedout')) { clearAppSession(); message('You have been logged out.', true); }

  const settings = readJson(SETTINGS_KEY, null);
  const name = settings && settings.values && String(settings.values.churchName || '').trim();
  if (name) { $('church-name').textContent = name; document.title = `Sign in — ${name}`; }

  $('show-password').addEventListener('click', event => {
    const visible = $('auth-password').type === 'text';
    $('auth-password').type = visible ? 'password' : 'text';
    event.currentTarget.setAttribute('aria-pressed', String(!visible)); event.currentTarget.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
  });

  async function authenticate(email, pw) {
    if (!window.ChurchDB?.client) throw new Error('Secure sign-in needs the Supabase connection. Check your connection and refresh the sign-in page.');
    try {
      const data = await window.ChurchDB.signIn(email, pw);
      if (!data?.user || !data?.session) throw new Error('Could not establish a Supabase session. Please try signing in again.');
      // Role/status must come from the profile, never editable user metadata.
      return await window.ChurchDB.appSessionForUser(data.user);
    } catch (error) {
      if (/not confirmed/i.test(error.message || '')) throw new Error('Please confirm your email address before signing in.');
      if (/invalid login credentials|invalid credentials|user not found/i.test(error.message || '')) throw new Error('Email or password is incorrect. Check the credentials supplied by the Main Admin.');
      throw error;
    }
  }

  $('auth-form').addEventListener('submit', async event => {
    event.preventDefault();
    if ($('auth-submit').disabled) return;
    message('');
    const email = $('auth-email').value.trim().toLowerCase(), pw = $('auth-password').value;
    if (!email || !$('auth-email').checkValidity()) { message('Enter a valid email address.'); $('auth-email').focus(); return; }
    if (!pw || pw.length < 6) { message('Password must be at least 6 characters.'); $('auth-password').focus(); return; }
    const WEAK = ['12345678', '123456789', '1234567890', '123456', '11111111', 'admin123', 'admin', 'password', 'password1', 'password123', 'qwerty123'];
    if (WEAK.includes(pw.toLowerCase())) { message('That password is not allowed because it is too easy to guess. Ask the Main Admin to set a new one.'); $('auth-password').focus(); return; }
    manualSignInStarted = true;
    $('auth-submit').disabled = true;

    try {
      const session = await authenticate(email, pw);
      if (!window.ChurchDB.isValidAppSession(session)) throw new Error('This account does not have active administration access.');
      sessionStorage.setItem(AUTH_KEY, JSON.stringify({ ...session, signedInAt: new Date().toISOString() }));
      recordLogin(session);
      logActivity({ action: 'login', userId: session.id, userName: session.name, role: session.role, summary: 'Signed in to the administration system', data: { email: session.email } });
      location.replace(HOME);
    } catch (error) {
      clearAppSession();
      if (/incorrect/i.test(error.message || '')) logActivity({ action: 'login-failed', userId: 'unknown', userName: email, summary: 'Failed sign-in attempt', data: { email } });
      message(error.message || 'Could not sign in.');
      $('auth-submit').disabled = false;
    }
  });

  // A reopened mobile tab can keep the Auth token but lose sessionStorage.
  // Restore the derived app identity only after checking the real user/profile.
  async function restoreSavedSignIn() {
    if (params.has('loggedout') || !window.ChurchDB?.client) return;
    try {
      const session = await window.ChurchDB.getAppSession();
      if (manualSignInStarted || $('auth-email').value || $('auth-password').value) return;
      if (!window.ChurchDB.isValidAppSession(session)) { clearAppSession(); return; }
      sessionStorage.setItem(AUTH_KEY, JSON.stringify({ ...session, signedInAt: cached?.signedInAt || new Date().toISOString() }));
      location.replace(HOME);
    } catch (error) {
      if (manualSignInStarted) return;
      clearAppSession();
      if (cached) message(error.message || 'Your saved sign-in could not be verified. Please sign in again.');
    }
  }
  restoreSavedSignIn();
})();

/* Light / dark theme switch. The choice is remembered per browser. */
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
