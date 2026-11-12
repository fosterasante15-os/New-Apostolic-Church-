const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nsccmfevvkvjhvxrtmax.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const MAIN_ADMIN_EMAIL = 'fosterasante15@gmail.com';
const ALLOWED_ROLES = new Set(['main-admin', 'admin', 'account', 'member']);
const ALLOWED_STATUSES = new Set(['Active', 'Pending', 'Inactive', 'Locked', 'Blocked']);
const WEAK_PASSWORDS = new Set(['12345678', '123456789', '1234567890', '123456', '11111111', 'admin123', 'admin', 'password', 'password1', 'password123', 'qwerty123']);

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

async function supabase(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      // New secret keys are not JWTs. Let the gateway authenticate the apikey.
      ...(SERVICE_ROLE_KEY.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${SERVICE_ROLE_KEY}` }),
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  return { response, data };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  if (!SERVICE_ROLE_KEY) return json(res, 503, { error: 'Account creation is not configured. Add SUPABASE_SERVICE_ROLE_KEY to the Vercel production environment.' });

  const token = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''))?.[1];
  if (!token) return json(res, 401, { error: 'A signed-in Main Admin session is required.' });

  try {
    // The caller's JWT authenticates the person; the API key authenticates this backend.
    const actorResult = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }
    });
    const actor = actorResult.ok ? await actorResult.json() : null;
    if (!actor?.id || !actor?.email) return json(res, 401, { error: 'Your Supabase session is missing or expired. Sign in again.' });

    const profileResult = await supabase(`/rest/v1/profiles?id=eq.${encodeURIComponent(actor.id)}&select=id,email,role,status&limit=1`);
    if (!profileResult.response.ok) return json(res, 502, { error: 'The server could not verify Main Admin access. Check the Supabase server key and profiles table.' });
    const actorProfile = Array.isArray(profileResult.data) ? profileResult.data[0] : null;
    const isFoster = String(actor.email).toLowerCase() === MAIN_ADMIN_EMAIL;
    const isMainAdmin = (isFoster && (!actorProfile || actorProfile.status === 'Active')) || (actorProfile?.role === 'main-admin' && actorProfile?.status === 'Active');
    if (!isMainAdmin) return json(res, 403, { error: 'Only an active Main Admin can create accounts.' });

    let input;
    try { input = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (_) { return json(res, 400, { error: 'Invalid JSON request.' }); }
    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.password || '');
    const name = String(input.name || '').trim() || email.split('@')[0];
    const role = String(input.role || 'member');
    const status = String(input.status || 'Active');

    if (!/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { error: 'Enter a valid email address.' });
    if (password.length < 8) return json(res, 400, { error: 'Password must be at least 8 characters.' });
    if (WEAK_PASSWORDS.has(password.toLowerCase())) return json(res, 400, { error: 'That password is too easy to guess and will be rejected on the sign-in page. Choose a stronger password.' });
    if (!ALLOWED_ROLES.has(role)) return json(res, 400, { error: 'Invalid account role.' });
    if (!ALLOWED_STATUSES.has(status)) return json(res, 400, { error: 'Invalid account status.' });
    if (email === MAIN_ADMIN_EMAIL && role !== 'main-admin') return json(res, 400, { error: 'The Foster Main Admin account must keep the Main admin role.' });

    const created = await supabase('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name, role, status } })
    });
    if (!created.response.ok || !created.data?.id) {
      const message = created.data?.msg || created.data?.message || created.data?.error_description || 'Supabase could not create the account.';
      if (/already|registered|exists/i.test(String(message))) return json(res, 409, { error: 'An account with this email already exists in Supabase Auth.' });
      if ([401, 403].includes(created.response.status)) return json(res, 502, { error: 'Supabase rejected the server account-creation key. Verify SUPABASE_SERVICE_ROLE_KEY in Vercel Production and redeploy.' });
      return json(res, created.response.ok ? 502 : created.response.status, { error: message });
    }

    // Merge by this newly created Auth ID if a database trigger already created the profile.
    const profile = await supabase('/rest/v1/profiles?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ id: created.data.id, email, name, role, status })
    });
    if (!profile.response.ok) {
      const cleanup = await supabase(`/auth/v1/admin/users/${encodeURIComponent(created.data.id)}`, { method: 'DELETE' });
      const error = cleanup.response.ok
        ? 'The account could not be saved to the profiles table and was rolled back. Check the Supabase profiles schema and permissions.'
        : 'The Auth account exists, but its profile could not be saved or rolled back. Ask the project administrator to repair this account in Supabase before retrying.';
      return json(res, 502, { error });
    }

    // Never return the password or the privileged server key.
    return json(res, 201, { user: { id: created.data.id, email, name, role, status, lastLogin: '—' } });
  } catch (_) {
    return json(res, 502, { error: 'Could not reach Supabase to complete account creation. Check the Users list before retrying.' });
  }
};
