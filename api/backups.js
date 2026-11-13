const security = require('../server/portal-security.cjs');
function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store'); return res.end(JSON.stringify(body));
}
module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
  try {
    const { actor, token } = await security.verifyBearer(req);
    const status = await security.getStatus();
    if (!status.ready) return json(res, 503, { error: 'Run security-settings-migration.sql in Supabase SQL Editor to enable private cloud backups.', code: 'SETUP_REQUIRED', setupRequired: true });
    await security.requireSession(actor, token, 'check');
    const session = security.sessionIdFromToken(token);
    const args = { p_actor: actor.id, p_session: session };
    if (req.method === 'POST') {
      let body; try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (_) { return json(res, 400, { error: 'Invalid backup request.' }); }
      if (typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'Invalid backup request.' });
      if (body.automatic !== undefined && typeof body.automatic !== 'boolean') return json(res, 400, { error: 'Invalid automatic-backup option.' });
      const result = await security.rpc('portal_backup', { ...args, p_automatic: body.automatic === true });
      if (result?.created === false && ['main-admin-required', 'administrator-required', 'invalid-session'].includes(result.reason)) {
        return json(res, 403, { error: result.reason === 'invalid-session' ? 'Your application session has expired.' : 'This account cannot create that backup.', code: result.reason === 'invalid-session' ? 'APP_SESSION_EXPIRED' : 'MAIN_ADMIN_REQUIRED' });
      }
      return json(res, 200, result);
    }
    const id = req.query?.id || new URL(req.url || '/api/backups', 'https://newapostolicchurch.vercel.app').searchParams.get('id');
    if (id) {
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { error: 'Invalid backup ID.' });
      const result = await security.rpc('portal_download_backup', { ...args, p_id: id });
      if (!result?.data || !result?.createdAt) return json(res, 404, { error: 'This backup no longer exists. Refresh backup history.', code: 'BACKUP_NOT_FOUND' });
      return json(res, 200, result);
    }
    const result = await security.rpc('portal_list_backups', args);
    return json(res, 200, { backups: result });
  } catch (error) {
    return json(res, error.status || error.statusCode || 502, { error: error.message || 'The backup request failed.', code: error.code });
  }
};
