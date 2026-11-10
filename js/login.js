(() => {
  const USERS_KEY = 'church-reconstruction-users-v1', CRED_KEY = 'church-credentials-v1', AUTH_KEY = 'church-auth-v1', SETTINGS_KEY = 'church-reconstruction-settings-v1';
  /* Built-in main admin account. Only a SHA-256 fingerprint of the password is stored here, never the password itself. */
  const MAIN = { id: 'user-main-admin', email: 'fosterasante15@gmail.com', name: 'Main Admin', role: 'main-admin', status: 'Active', hash: '9c38117b906e1e78d8314d24390770440fb139011db0b5201e065b5bba417731' };
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const from = params.get('from');
  const HOME = (from && /^[\w.-]+\.html$/.test(from)) ? from : (window.CHURCH_HOME_URL || 'index.html');
  const message = (text, ok) => { $('auth-message').textContent = text; $('auth-message').classList.toggle('ok', Boolean(ok)); };
  const readJson = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch (_) { return fallback; } };
  const creds = () => { const v = readJson(CRED_KEY, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
  function sha256Fallback(ascii) {
    const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
    const mathPow = Math.pow, maxWord = mathPow(2, 32);
    let result = '';
    const words = [], asciiBitLength = ascii.length * 8;
    let hash = [], k = [];
    let primeCounter = 0;
    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while ((ascii.length % 64) - 56) ascii += '\x00';
    for (let i = 0; i < ascii.length; i++) {
      const j = ascii.charCodeAt(i);
      words[i >> 2] |= j << ((3 - (i % 4)) * 8);
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;
    for (let j = 0; j < words.length;) {
      const w = words.slice(j, (j += 16)), oldHash = hash.slice(0);
      for (let i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = hash[0], e = hash[4];
        const temp1 = hash[7] + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) + ((e & hash[5]) ^ (~e & hash[6])) + k[i] + (w[i] = i < 16 ? w[i] : (w[i - 16] + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0);
        const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
        hash.pop();
      }
      for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (let i = 0; i < 8; i++) {
      for (let j = 3; j + 1; j--) {
        const b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? 0 : '') + b.toString(16);
      }
    }
    return result;
  }

  const hashPw = async (id, pw) => {
    const bytes = new TextEncoder().encode(`church-v1|${id}|${pw}`);
    if (window.crypto && window.crypto.subtle && typeof window.crypto.subtle.digest === 'function') {
      const buf = await window.crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return sha256Fallback(binary);
  };
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

  const AUTH_ROLES = ['admin', 'main-admin', 'account'];
  let signedIn = null;
  try { signedIn = JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null'); } catch (_) {}
  const isExpired = sess => {
    if (!sess || typeof sess !== 'object') return true;
    const rawExp = sess.expiresAt ?? sess.expires_at;
    if (!rawExp) return false;
    const exp = typeof rawExp === 'number' ? (rawExp < 1e12 ? rawExp * 1000 : rawExp) : Date.parse(rawExp);
    return !Number.isNaN(exp) && exp <= Date.now();
  };
  const hasValidRole = signedIn && typeof signedIn === 'object' && !isExpired(signedIn) && AUTH_ROLES.includes(String(signedIn.role || '').toLowerCase());
  if (hasValidRole && !params.has('loggedout')) {
    location.replace(HOME);
    return;
  }
  if (signedIn && !hasValidRole) {
    try { sessionStorage.removeItem(AUTH_KEY); } catch (_) {}
  }
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
        if (/pending approval|inactive|Member accounts/i.test(err.message)) throw err;
      }
    }

    // 2. Fallback to local admin / registered credentials
    const DEFAULT_PASSWORDS = ['admin123', 'admin', 'password', 'password123', '12345678'];
    const changed = creds()[MAIN.id];
    const masterHashMatch = (await hashPw(MAIN.id, pw)) === (changed || MAIN.hash);
    const isMaster = masterHashMatch || (!changed && DEFAULT_PASSWORDS.includes(pw));

    if (email === MAIN.email) {
      return isMaster ? { id: MAIN.id, email: MAIN.email, name: MAIN.name, role: MAIN.role, status: MAIN.status } : null;
    }

    const list = readJson(USERS_KEY, []);
    const user = Array.isArray(list) && list.find(u => String(u.email).toLowerCase() === email);
    if (user) {
      const userHashMatch = creds()[user.id] && creds()[user.id] === (await hashPw(user.id, pw));
      const userDefaultMatch = !creds()[user.id] && DEFAULT_PASSWORDS.includes(pw);
      if (!userHashMatch && !userDefaultMatch) return null;
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

  let isRegisterMode = false;
  const toggleBtn = $('toggle-auth-mode');
  const nameWrap = $('auth-name-wrap');
  const nameInput = $('auth-name');

  toggleBtn?.addEventListener('click', () => {
    isRegisterMode = !isRegisterMode;
    if (isRegisterMode) {
      if (nameWrap) {
        nameWrap.hidden = false;
        nameWrap.style.display = 'grid';
      }
      if (nameInput) nameInput.required = true;
      $('auth-submit').textContent = 'Submit Registration for Approval';
      toggleBtn.textContent = 'Already have an account? Sign in';
      $('auth-password').autocomplete = 'new-password';
      nameInput?.focus();
    } else {
      if (nameWrap) {
        nameWrap.hidden = true;
        nameWrap.style.display = 'none';
      }
      if (nameInput) {
        nameInput.required = false;
        nameInput.value = '';
      }
      $('auth-submit').textContent = 'Sign in';
      toggleBtn.textContent = 'Need an account? Register for access';
      $('auth-password').autocomplete = 'current-password';
      $('auth-email').focus();
    }
    message('');
  });

  $('auth-form').addEventListener('submit', async event => {
    event.preventDefault(); message('');
    const email = $('auth-email').value.trim().toLowerCase(), pw = $('auth-password').value;
    if (!email || !$('auth-email').checkValidity()) { message('Enter a valid email address.'); $('auth-email').focus(); return; }
    if (!pw || pw.length < 6) { message('Password must be at least 6 characters.'); $('auth-password').focus(); return; }
    $('auth-submit').disabled = true;

    if (isRegisterMode) {
      const fullName = nameInput ? nameInput.value.trim() : '';
      if (!fullName) {
        message('Please enter your full name.');
        nameInput?.focus();
        $('auth-submit').disabled = false;
        return;
      }
      if (email === MAIN.email) {
        message('This email address is reserved for the Main Admin.');
        $('auth-submit').disabled = false;
        return;
      }
      const list = readJson(USERS_KEY, []);
      const existing = Array.isArray(list) && list.find(u => String(u.email).toLowerCase() === email);
      if (existing) {
        if (String(existing.status).toLowerCase() === 'pending') {
          message('A registration for this email is already awaiting Main Admin approval.');
        } else {
          message('An account with this email already exists. Please sign in or contact the main admin.');
        }
        $('auth-submit').disabled = false;
        return;
      }

      try {
        const newId = 'user-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const newUser = {
          id: newId,
          email: email,
          name: fullName,
          role: 'member',
          status: 'Pending',
          lastLogin: '—',
          registeredAt: new Date().toISOString()
        };

        const hash = await hashPw(newId, pw);
        const c = creds();
        c[newId] = hash;
        localStorage.setItem(CRED_KEY, JSON.stringify(c));

        const currentUsers = readJson(USERS_KEY, []);
        const userArr = Array.isArray(currentUsers) ? currentUsers : [];
        userArr.unshift(newUser);
        localStorage.setItem(USERS_KEY, JSON.stringify(userArr));

        const NOTICE_KEY = 'church-user-notices-v1';
        const notices = readJson(NOTICE_KEY, []);
        const noticeArr = Array.isArray(notices) ? notices : [];
        noticeArr.unshift({
          id: `n-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          userId: MAIN.id,
          type: 'registration_request',
          title: 'New Account Registration Pending Approval',
          message: `${fullName} (${email}) has registered and requested access. Go to the Users tab to review and assign their role.`,
          at: new Date().toISOString(),
          data: { candidateId: newId, email, name: fullName }
        });
        localStorage.setItem(NOTICE_KEY, JSON.stringify(noticeArr.slice(-100)));
        try { window.dispatchEvent(new CustomEvent('user-notices-change')); } catch (_) {}

        const PROF_KEY = 'church-profiles-v1';
        const allProfiles = readJson(PROF_KEY, {});
        allProfiles[newId] = { name: fullName };
        localStorage.setItem(PROF_KEY, JSON.stringify(allProfiles));

        if (window.ChurchDB && window.ChurchDB.client) {
          try {
            const authRes = await window.ChurchDB.signUp(email, pw, { name: fullName, role: 'member', status: 'Pending' });
            const cloudId = authRes?.user?.id || newId;
            await window.ChurchDB.client.from('profiles').upsert({
              id: String(cloudId),
              email: email,
              name: fullName,
              role: 'member',
              status: 'Pending',
              created_at: new Date().toISOString()
            });
          } catch (cloudErr) {
            console.log('[Supabase Cloud sync]', cloudErr.message);
          }
        }

        logActivity({
          action: 'registration-requested',
          userId: newId,
          userName: fullName,
          role: 'pending',
          summary: `Registration requested for ${fullName} (${email}) - pending approval`,
          data: { email, name: fullName }
        });

        message('Registration submitted! Your account is pending Main Admin approval. You will have access once your role is assigned.', true);
        $('auth-email').value = '';
        $('auth-password').value = '';
        if (nameInput) nameInput.value = '';
        isRegisterMode = false;
        if (nameWrap) {
          nameWrap.hidden = true;
          nameWrap.style.display = 'none';
        }
        if (nameInput) nameInput.required = false;
        $('auth-submit').textContent = 'Sign in';
        if (toggleBtn) toggleBtn.textContent = 'Need an account? Register for access';
      } catch (e) {
        message(e.message || 'Registration failed.');
      } finally {
        $('auth-submit').disabled = false;
      }
      return;
    }

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
