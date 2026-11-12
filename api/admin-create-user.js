const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nsccmfevvkvjhvxrtmax.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MAIN_ADMIN_EMAIL = 'fosterasante15@gmail.com';
const ALLOWED_ROLES = new Set(['main-admin', 'admin', 'account', 'member']);
const ALLOWED_STATUSES = new Set(['Active', 'Pending', 'Inactive', 'Locked', 'Blocked']);

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify(body));
}

async function supabase(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { message: text }; }
  return { response, data };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  if (!SERVICE_ROLE_KEY) return json(res, 503, { error: 'Account creation is not configured. Add SUPABASE_SERVICE_ROLE_KEY to the Vercel production environment.' });

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(res, 401, { error: 'A signed-in Main Admin session is required.' });

  const actorResult = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }
  });
  const actor = actorResult.ok ? await actorResult.json() : null;
  if (!actor?.id || !actor?.email) return json(res, 401, { error: 'Your Supabase session is missing or expired. Sign in again.' });

  const profileResult = await supabase(`/rest/v1/profiles?id=eq.${encodeURIComponent(actor.id)}&select=id,email,role,status&limit=1`);
  const actorProfile = Array.isArray(profileResult.data) ? profileResult.data[0] : null;
  const isFoster = String(actor.email).toLowerCase() === MAIN_ADMIN_EMAIL;
  const isMainAdmin = isFoster || (actorProfile?.role === 'main-admin' && actorProfile?.status === 'Active');
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
  if (!ALLOWED_ROLES.has(role)) return json(res, 400, { error: 'Invalid account role.' });
  if (!ALLOWED_STATUSES.has(status)) return json(res, 400, { error: 'Invalid account status.' });
  if (email === MAIN_ADMIN_EMAIL && role !== 'main-admin') return json(res, 400, { error: 'The Foster Main Admin account must keep the Main admin role.' });

  const created = await supabase('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role, status }
    })
  });
  if (!created.response.ok || !created.data?.id) {
    const message = created.data?.msg || created.data?.message || created.data?.error_description || 'Supabase could not create the account.';
    if (/already|registered|exists/i.test(String(message))) return json(res, 409, { error: 'An account with this email already exists in Supabase Auth.' });
    return json(res, created.response.status || 502, { error: message });
  }

  const profile = await supabase('/rest/v1/profiles', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ id: created.data.id, email, name, role, status })
  });
  if (!profile.response.ok) {
    await supabase(`/auth/v1/admin/users/${encodeURIComponent(created.data.id)}`, { method: 'DELETE' });
    const message = profile.data?.message || profile.data?.hint || 'The Auth user was created but the profile could not be saved.';
    return json(res, 502, { error: message });
  }

  return json(res, 201, {
    user: {
      id: created.data.id,
      email,
      name,
      role,
      status,
      lastLogin: '—'
    }
  });
};
