const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nsccmfevvkvjhvxrtmax.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
// Optional legacy service_role JWT for projects whose Auth Admin routes require it.
const AUTH_ADMIN_KEY = (process.env.SUPABASE_AUTH_ADMIN_KEY || SERVICE_ROLE_KEY).trim();
const WEAK_PASSWORDS = new Set(['12345678', '123456789', '1234567890', '123456', '11111111', 'admin123', 'admin', 'password', 'password1', 'password123', 'qwerty123']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

async function supabase(path, options = {}, compatibleAuth = false) {
  const key = path.startsWith('/auth/v1/admin/') ? AUTH_ADMIN_KEY : SERVICE_ROLE_KEY;
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: key,
      // New secret keys are not JWTs. Let the gateway authenticate the apikey.
      ...(key.startsWith('sb_secret_') && !compatibleAuth ? {} : { Authorization: `Bearer ${key}` }),
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  // Some hosted gateways still require a Bearer header equal to the apikey.
  // Retry only a rejected Auth Admin request, never an accepted write.
  const authMessage = String(data?.msg || data?.message || data?.error_description || '');
  const headerRejected = data?.error_code === 'bad_jwt' || data?.error_code === 'no_authorization' || /requires.*bearer|invalid JWT|missing.*authorization/i.test(authMessage);
  if (!compatibleAuth && key.startsWith('sb_secret_') && path.startsWith('/auth/v1/admin/') && [401, 403].includes(response.status) && headerRejected) {
    return supabase(path, options, true);
  }
  return { response, data };
}

function adminKeyError(result) {
  const data = result.data || {};
  const message = String(data.msg || data.message || data.error_description || '');
  const rejected = [401, 403].includes(result.response.status) || data.error_code === 'bad_jwt' || data.error_code === 'no_authorization' || /requires.*bearer|invalid JWT|missing.*authorization/i.test(message);
  if (!rejected) return null;
  const allowedCodes = new Set(['bad_jwt', 'no_authorization', 'not_admin', 'unexpected_audience', 'invalid_credentials']);
  const code = allowedCodes.has(data.error_code) ? data.error_code : 'admin_auth_rejected';
  const keyType = AUTH_ADMIN_KEY.startsWith('sb_secret_') ? 'secret' : 'legacy';
  const guidance = keyType === 'secret'
    ? 'This project requires a legacy service_role key for Auth administration. Add it privately as SUPABASE_AUTH_ADMIN_KEY in Vercel Production and redeploy.'
    : 'The Auth Admin credential is invalid or lacks service_role privileges. Check the private Auth Admin key in Vercel Production.';
  return { code, error: `Password was not changed. ${guidance}` };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  if (!SERVICE_ROLE_KEY || !AUTH_ADMIN_KEY) return json(res, 503, { error: 'Password reset is not configured on the server.' });

  const token = /^Bearer\s+(\S+)$/i.exec(String(req.headers?.authorization || ''))?.[1];
  if (!token) return json(res, 401, { error: 'A signed-in Main Admin session is required.' });

  let input;
  try {
    input = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (_) {
    return json(res, 400, { error: 'Invalid JSON request.' });
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return json(res, 400, { error: 'Invalid JSON request.' });

  const userId = typeof input.userId === 'string' ? input.userId.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!UUID.test(userId)) return json(res, 400, { error: 'Enter a valid target user ID.' });
  if (password.length < 8) return json(res, 400, { error: 'Password must be at least 8 characters.' });
  if (WEAK_PASSWORDS.has(password.toLowerCase())) return json(res, 400, { error: 'That password is too easy to guess and will be rejected on the sign-in page. Choose a stronger password.' });

  try {
    // The caller JWT authenticates the person; the server key authorizes this backend.
    const actorResult = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }
    });
    const actor = actorResult.ok ? await actorResult.json() : null;
    if (!actor?.id) return json(res, 401, { error: 'Your Supabase session is missing or expired. Sign in again.' });

    const profileResult = await supabase(`/rest/v1/profiles?id=eq.${encodeURIComponent(actor.id)}&select=id,role,status&limit=1`);
    if (!profileResult.response.ok) return json(res, 502, { error: 'The server could not verify Main Admin access. Check the Supabase server key and profiles table.' });
    const actorProfile = Array.isArray(profileResult.data) ? profileResult.data[0] : null;
    const isMainAdmin = String(actorProfile?.role || '').trim().toLowerCase() === 'main-admin' && actorProfile?.status === 'Active';
    if (!isMainAdmin) return json(res, 403, { error: 'Only an active Main Admin can reset passwords.' });

    // Verify that the target is a real Auth account before changing its password.
    const targetResult = await supabase(`/auth/v1/admin/users/${encodeURIComponent(userId)}`);
    const targetKeyError = adminKeyError(targetResult);
    if (targetKeyError) return json(res, 502, targetKeyError);
    if (targetResult.response.status === 404) return json(res, 404, { error: 'The target account could not be found.' });
    if (!targetResult.response.ok) return json(res, 502, { error: 'The target account could not be verified. Please try again.' });
    const target = targetResult.data?.user || targetResult.data;
    if (!target?.id || String(target.id).toLowerCase() !== userId.toLowerCase()) return json(res, 404, { error: 'The target account could not be found.' });

    const updated = await supabase(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify({ password })
    });
    const updateKeyError = adminKeyError(updated);
    if (updateKeyError) return json(res, 502, updateKeyError);
    if (!updated.response.ok) return json(res, 502, { error: 'The password could not be changed. Please try again.' });

    return json(res, 200, { ok: true, userId });
  } catch (_) {
    return json(res, 502, { error: 'Could not reach Supabase to complete the password reset. Check the account before retrying.' });
  }
};
