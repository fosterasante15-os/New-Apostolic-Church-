const URL = process.env.SUPABASE_URL || 'https://nsccmfevvkvjhvxrtmax.supabase.co';
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const AUTH_KEY = (process.env.SUPABASE_AUTH_ADMIN_KEY || KEY).trim();
function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}
async function request(path, compatibility = false) {
  const key = path.startsWith('/auth/v1/admin/') ? AUTH_KEY : KEY;
  const response = await fetch(URL + path, { headers: { apikey: key, ...(key.startsWith('sb_secret_') && !compatibility ? {} : { Authorization: `Bearer ${key}` }) } });
  let data = null; try { data = await response.json(); } catch (_) {}
  const message = String(data?.msg || data?.message || '');
  if (!compatibility && key.startsWith('sb_secret_') && path.startsWith('/auth/v1/admin/') && [401, 403].includes(response.status) && (['bad_jwt', 'no_authorization'].includes(data?.error_code) || /requires.*bearer|missing.*authorization|invalid JWT/i.test(message))) return request(path, true);
  return { response, data };
}
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
  const token = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''))?.[1];
  if (!token) return json(res, 401, { error: 'A valid Main Admin sign-in is required.' });
  if (!KEY) return json(res, 503, { error: 'The user directory is not configured.' });
  try {
    const response = await fetch(URL + '/auth/v1/user', { headers: { apikey: KEY, Authorization: `Bearer ${token}` } });
    const actor = response.ok ? await response.json() : null;
    if (!actor?.id) return json(res, 401, { error: 'Your sign-in expired. Sign in again.' });
    const own = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(actor.id)}&select=role,status&limit=1`);
    if (!own.response.ok) return json(res, 502, { error: 'The server could not verify your account.' });
    const me = Array.isArray(own.data) ? own.data[0] : null;
    if (String(me?.role || '').trim().toLowerCase() !== 'main-admin' || String(me?.status || '').trim().toLowerCase() !== 'active') return json(res, 403, { error: 'Only an active Main Admin can view the user directory.' });
    await require('../server/portal-security.cjs').requireSession(actor, token);
    const profiles = await request('/rest/v1/profiles?select=*&order=created_at.desc&limit=1000');
    if (!profiles.response.ok || !Array.isArray(profiles.data)) return json(res, 502, { error: 'The user profiles could not be loaded.' });
    const auth = await request('/auth/v1/admin/users?page=1&per_page=1000');
    const authUsers = auth.response.ok && Array.isArray(auth.data?.users) ? auth.data.users : [];
    const byId = new Map(authUsers.map(user => [user.id, user]));
    const users = profiles.data.map(profile => ({
      id: profile.id, email: profile.email, name: profile.name || profile.display_name || String(profile.email || '').split('@')[0],
      role: profile.role || 'member', status: profile.status || 'Pending',
      lastLogin: profile.last_login || byId.get(profile.id)?.last_sign_in_at || null, photo: profile.photo_url || ''
    }));
    // Only the allowlisted fields above leave the server. Never return complete
    // Auth user objects, password hashes, tokens, keys, or editable auth metadata.
    return json(res, 200, { users, warning: auth.response.ok ? '' : 'Some historical login times could not be loaded. New successful sign-ins will record their times.' });
  } catch (error) {
    if (error?.status && error?.code) return json(res, error.status, { error: error.message, code: error.code });
    return json(res, 502, { error: 'Could not reach the user directory. Please try again.' });
  }
};
