const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nsccmfevvkvjhvxrtmax.supabase.co';
const SERVER_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_AUTH_ADMIN_KEY || '').trim();
const OWNER_EMAIL = 'fosterasante15@gmail.com';

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}
async function profileRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVER_KEY,
      ...(SERVER_KEY.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${SERVER_KEY}` }),
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  let data = null; try { data = await response.json(); } catch (_) {}
  return { response, data };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const token = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''))?.[1];
  if (!token) return json(res, 401, { error: 'A valid sign-in is required.' });
  if (!SERVER_KEY) return json(res, 503, { error: 'Account profile recovery is not configured on the server.' });
  try {
    const auth = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVER_KEY, Authorization: `Bearer ${token}` } });
    const actor = auth.ok ? await auth.json() : null;
    if (!actor?.id || !actor?.email) return json(res, 401, { error: 'Your sign-in expired. Please sign in again.' });
    const query = `profiles?id=eq.${encodeURIComponent(actor.id)}&select=*&limit=1`;
    let result = await profileRequest(query);
    if (!result.response.ok) return json(res, 502, { error: 'The server could not read your account profile. Check the profiles table configuration.' });
    let profile = Array.isArray(result.data) ? result.data[0] : null;
    if (!profile) {
      // This owner was explicitly designated by the user. Never infer anyone
      // else's role from user-editable metadata, an email match, or request data.
      const owner = String(actor.email).trim().toLowerCase() === OWNER_EMAIL && Boolean(actor.email_confirmed_at);
      if (!owner) return json(res, 404, { error: 'Your login exists, but its account profile is missing. The Main Admin must restore the profile for this account.' });
      const existingOwner = await profileRequest(`profiles?email=ilike.${encodeURIComponent(OWNER_EMAIL)}&select=id&limit=2`);
      if (!existingOwner.response.ok) return json(res, 502, { error: 'The owner profile identity could not be verified.' });
      if (Array.isArray(existingOwner.data) && existingOwner.data.some(row => row.id !== actor.id)) return json(res, 409, { error: 'The owner profile belongs to a different Auth identity. An administrator must repair that link; permissions will not be copied automatically.' });
      const created = await profileRequest('profiles?on_conflict=id', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({ id: actor.id, email: actor.email, name: 'Foster Asante', role: 'main-admin', status: 'Active' })
      });
      if (!created.response.ok) return json(res, 502, { error: 'The owner profile could not be restored. Check the profiles table configuration.' });
      // Always reread: a concurrent profile creation must keep its existing role
      // and status, especially a blocked/inactive account. Do not overwrite it.
      result = await profileRequest(query);
      if (!result.response.ok) return json(res, 502, { error: 'The restored profile could not be verified. Please try again.' });
      profile = Array.isArray(result.data) ? result.data[0] : null;
    }
    if (!profile || profile.id !== actor.id) return json(res, 404, { error: 'Your account profile could not be verified.' });
    let input = {}; try { input = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (_) { return json(res, 400, { error: 'Invalid request.' }); }
    let loginTimeSaved = false;
    const when = actor.last_sign_in_at && !Number.isNaN(Date.parse(actor.last_sign_in_at)) ? actor.last_sign_in_at : null;
    if (input.recordLogin === true) {
      const approved = ['main-admin', 'admin', 'account'].includes(String(profile.role || '').trim().toLowerCase()) && String(profile.status || '').trim().toLowerCase() === 'active';
      if (!approved) return json(res, 403, { error: 'This account does not have active administration access.' });
      if (when) {
        const saved = await profileRequest(`profiles?id=eq.${encodeURIComponent(actor.id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ last_login: when }) });
        loginTimeSaved = saved.response.ok && Array.isArray(saved.data) && saved.data.some(row => row.id === actor.id);
        if (!loginTimeSaved) return json(res, 502, { error: 'Sign-in succeeded, but the profile login time could not be saved. Check profiles.last_login and server permissions.', lastLogin: when, loginTimeSaved: false });
        if (loginTimeSaved) profile = { ...profile, last_login: when };
      }
    }
    // Returning a profile does not grant access: the client still checks its
    // authoritative role/status. Existing inactive/member profiles are unchanged.
    return json(res, 200, { profile: { id: actor.id, email: actor.email, name: profile.name || '', role: profile.role, status: profile.status, lastLogin: profile.last_login || when }, lastLogin: when || profile.last_login || null, loginTimeSaved });
  } catch (_) {
    return json(res, 502, { error: 'Could not reach the account profile service. Please try signing in again.' });
  }
};
