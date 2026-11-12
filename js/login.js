(() => {
  const USERS_KEY = 'church-reconstruction-users-v1', CRED_KEY = 'church-credentials-v1', AUTH_KEY = 'church-auth-v1', SETTINGS_KEY = 'church-reconstruction-settings-v1';
  /* Built-in main admin account. NO password (or password fingerprint) is stored in this file: the password lives in Supabase Auth. */
  const MAIN = { id: 'user-main-admin', email: 'fosterasante15@gmail.com', name: 'Main Admin', role: 'main-admin', status: 'Active' };
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const from = params.get('from');
  const HOME = (from && /^[\w.-]+\.html$/.test(from)) ? from : (window.CHURCH_HOME_URL || 'index.html');
  const message = (text, ok) => { $('auth-message').textContent = text; $('auth-message').classList.toggle('ok', Boolean(ok)); };
  const readJson = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch (_) { return fallback; } };
  const creds = () => { const v = readJson(CRED_KEY, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
  const hashPw = async (id, pw) => { if (!(window.crypto && crypto.subtle)) throw new Error('Secure sign-in needs https or localhost.'); const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`church-v1|${id}|${pw}`)); return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); };
  const ACT_KEY = 'church-activity-v1';
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

  let signedIn = null; try { signedIn = JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null'); } catch (_) {}
  if (signedIn && signedIn.role && signedIn.isCloud && !params.has('loggedout')) { location.replace(HOME); return; }
  if (signedIn && !signedIn.isCloud) sessionStorage.removeItem(AUTH_KEY);
  if (params.has('loggedout')) message('You have been logged out.', true);

  /* The login identity always uses the church logo; the Settings logo is for the administration workspace. */
  const settings = readJson(SETTINGS_KEY, null);
  const name = settings && settings.values && String(settings.values.churchName || '').trim();
  if (name) { $('church-name').textContent = name; document.title = `Sign in — ${name}`; }

  $('show-password').addEventListener('click', event => {
    const visible = $('auth-password').type === 'text';
    $('auth-password').type = visible ? 'password' : 'text';
    event.currentTarget.setAttribute('aria-pressed', String(!visible)); event.currentTarget.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
  });

  async function authenticate(email, pw) {
    // 1. Try Supabase Auth first
    if (window.ChurchDB && window.ChurchDB.client) {
      try {
        const authData = await window.ChurchDB.signIn(email, pw);
        if (authData && authData.user) {
          let userRole = authData.user.user_metadata?.role || (email === MAIN.email ? 'main-admin' : 'admin');
          let userStatus = 'Active';
          try {
            const { data: prof } = await window.ChurchDB.client.from('profiles').select('*').eq('id', authData.user.id).single();
            if (prof) {
              if (prof.role) userRole = prof.role;
              if (prof.status) userStatus = prof.status;
            }
          } catch (_) {}
          if (String(userStatus).toLowerCase() === 'pending') {
            throw new Error('Your registration is pending approval by the Main Admin. Please wait for an administrator to activate your account and assign your role.');
          }
          if (String(userStatus).toLowerCase() === 'declined') {
            throw new Error('Your registration was declined by the Main Admin. Please contact the Main Admin if you think this is a mistake.');
          }
          if (String(userStatus).toLowerCase() !== 'active') {
            throw new Error('This account is inactive. Contact the main admin.');
          }
          if (userRole === 'member') {
            throw new Error('Member accounts cannot sign in to the administration system.');
          }
          return {
            id: authData.user.id,
            email: authData.user.email,
            name: authData.user.user_metadata?.name || String(authData.user.email).split('@')[0],
            role: userRole,
            status: userStatus,
            isCloud: true
          };
        }
      } catch (err) {
        console.log('[Supabase Auth fallback]', err.message);
        if (/not confirmed/i.test(err.message || '')) throw new Error('Please confirm your email address using the link we sent you, then wait for the Main Admin to approve your account.');
        if (/pending approval|inactive|declined|Member accounts/i.test(err.message)) throw err;
        if (/invalid login credentials|invalid credentials|user not found/i.test(err.message || '')) throw new Error('Email or password is incorrect. Check the credentials supplied by the Main Admin.');
        if (email === MAIN.email) throw new Error('Main Admin sign-in requires the Supabase account. Check your internet connection and use the Supabase password; browser-only sign-in cannot create accounts for other users.');
      }
    }

    // 2. Fallback to local admin / registered credentials
    /* There are no built-in or default passwords. This offline fallback only accepts a password that was set on THIS device
       through Users -> Reset password. Everyone else signs in through Supabase Auth above. */

    if (email === MAIN.email) {
      throw new Error('Main Admin sign-in requires a working Supabase connection. Browser-only credentials cannot authorize account creation.');
    }

    const list = readJson(USERS_KEY, []);
    const user = Array.isArray(list) && list.find(u => String(u.email).toLowerCase() === email);
    if (user) {
      if (user.role === 'main-admin') throw new Error('Main Admin sign-in requires a working Supabase connection. Please sign in with your Supabase credentials.');
      const userHashMatch = creds()[user.id] && creds()[user.id] === (await hashPw(user.id, pw));
      if (!userHashMatch) return null;
      if (String(user.status || '').toLowerCase() === 'pending') {
        throw new Error('Your registration is pending approval by the Main Admin. Please wait for an administrator to activate your account and assign your role.');
      }
      if (String(user.status || '').toLowerCase() !== 'active') {
        throw new Error('This account is inactive. Contact the main admin.');
      }
      if (user.role === 'member') {
        throw new Error('Member accounts cannot sign in to the administration system.');
      }
      return { id: user.id, email: user.email, name: user.name || String(user.email).split('@')[0], role: user.role, status: user.status };
    }

    return null;
  }

  $('auth-form').addEventListener('submit', async event => {
    event.preventDefault(); message('');
    const email = $('auth-email').value.trim().toLowerCase(), pw = $('auth-password').value;
    if (!email || !$('auth-email').checkValidity()) { message('Enter a valid email address.'); $('auth-email').focus(); return; }
    if (!pw || pw.length < 6) { message('Password must be at least 6 characters.'); $('auth-password').focus(); return; }
    /* Weak, well-known passwords are refused on every device, for sign-in and for new registrations. */
    const WEAK = ['12345678', '123456789', '1234567890', '123456', '11111111', 'admin123', 'admin', 'password', 'password1', 'password123', 'qwerty123'];
    if (WEAK.includes(pw.toLowerCase())) { message('That password is not allowed because it is too easy to guess. Ask the Main Admin to set a new one.'); $('auth-password').focus(); return; }
    $('auth-submit').disabled = true;

    try {
      const session = await authenticate(email, pw);
      if (!session) throw new Error('Email or password is incorrect.');
      recordLogin(session);
      logActivity({ action: 'login', userId: session.id, userName: session.name, role: session.role, summary: 'Signed in to the administration system', data: { email: session.email } });
      sessionStorage.setItem(AUTH_KEY, JSON.stringify({ ...session, signedInAt: new Date().toISOString() }));
      location.replace(HOME);
    } catch (e) {
      if (/incorrect/i.test(e.message || '')) logActivity({ action: 'login-failed', userId: 'unknown', userName: email, summary: 'Failed sign-in attempt', data: { email } });
      message(e.message || 'Could not sign in.');
      $('auth-submit').disabled = false;
    }
  });
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
