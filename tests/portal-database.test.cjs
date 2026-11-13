const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let PGlite; try { ({ PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite')); } catch (_) {}
const main = '11111111-1111-4111-8111-111111111111';
const account = '22222222-2222-4222-8222-222222222222';
const mainSession = '33333333-3333-4333-8333-333333333333';
const accountSession = '44444444-4444-4444-8444-444444444444';
const expiredSession = '55555555-5555-4555-8555-555555555555';

test('real PostgreSQL migration: locks, expiry, RLS, settings and backup retention', { skip: !PGlite }, async t => {
  const db = new PGlite();
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.j;
  const rpc = (name, args = []) => scalar(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) AS j`, args);
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
      GRANT USAGE ON SCHEMA auth, public TO anon,authenticated,service_role;
      CREATE TABLE profiles(id uuid PRIMARY KEY,email text,name text,role text,status text,created_at timestamptz DEFAULT now());
      CREATE TABLE church_settings(key text PRIMARY KEY,value jsonb,updated_at timestamptz DEFAULT now());
      CREATE TABLE members(id text PRIMARY KEY,name text);
      INSERT INTO profiles VALUES ('${main}','main@example.test','Synthetic Main','main-admin','Active',now()), ('${account}','account@example.test','Synthetic Account','account','Active',now());
      INSERT INTO members VALUES ('test-1','Synthetic Member');
      GRANT ALL ON profiles,church_settings,members TO anon,authenticated;
      ALTER TABLE profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE church_settings ENABLE ROW LEVEL SECURITY; ALTER TABLE members ENABLE ROW LEVEL SECURITY;
      CREATE POLICY baseline_profiles ON profiles FOR ALL USING(true) WITH CHECK(true);
      CREATE POLICY baseline_settings ON church_settings FOR ALL USING(true) WITH CHECK(true);
      CREATE POLICY baseline_members ON members FOR ALL USING(true) WITH CHECK(true);`);
    // PGlite includes PostgreSQL's native gen_random_uuid(), but not Supabase's
    // already-installed pgcrypto extension. Only that installation line differs.
    const migration = fs.readFileSync(path.join(__dirname, '..', 'security-settings-migration.sql'), 'utf8').replace(/^CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*$/m, '');
    await db.exec(migration);
    await db.exec(migration);
    await t.test('migration is repeatable and returns canonical saved defaults', async () => {
      const status = await rpc('portal_security_status');
      assert.equal(status.ready, true); assert.equal(status.policy.sessionTimeoutMinutes, 30);
      assert.equal(status.settings.values.backupRetention, '10');
    });
    await t.test('concurrent-attempt reservation and wrong-password threshold use shared state', async () => {
      let a = await rpc('portal_begin_login', ['MAIN@example.test']);
      assert.equal(a.allowed, true);
      assert.equal((await rpc('portal_begin_login', ['main@example.test'])).allowed, false);
      const cancel = await rpc('portal_finish_login', ['main@example.test', a.ticket, null]);
      assert.equal(cancel.allowed, true);
      assert.equal(await scalar("SELECT failed_count AS j FROM portal_login_attempts WHERE email='main@example.test'"), 0);
      for (let i = 0; i < 5; i++) {
        a = await rpc('portal_begin_login', ['main@example.test']); assert.equal(a.allowed, true);
        const r = await rpc('portal_finish_login', ['main@example.test', a.ticket, false]);
        assert.equal(Boolean(r.lockedUntil), i === 4);
      }
      const blocked = await rpc('portal_begin_login', ['main@example.test']);
      assert.equal(blocked.allowed, false); assert.ok(blocked.retryAfterSeconds > 0);
      await db.exec("UPDATE portal_login_attempts SET locked_until=now()-interval '1 second' WHERE email='main@example.test'");
      a = await rpc('portal_begin_login', ['main@example.test']); assert.equal(a.allowed, true);
      assert.equal((await rpc('portal_finish_login', ['main@example.test', a.ticket, true])).allowed, true);
      assert.equal(await scalar("SELECT failed_count AS j FROM portal_login_attempts WHERE email='main@example.test'"), 0);
    });
    await t.test('native app sessions expire, seal and cannot be reopened', async () => {
      assert.equal((await rpc('portal_session', [main, mainSession, 'open'])).valid, true);
      assert.equal((await rpc('portal_session', [main, expiredSession, 'open'])).valid, true);
      await db.query("UPDATE portal_sessions SET last_activity=now()-interval '31 minutes' WHERE session_id=$1", [expiredSession]);
      assert.equal((await rpc('portal_session', [main, expiredSession, 'touch'])).valid, false);
      assert.equal((await rpc('portal_session', [main, expiredSession, 'open'])).valid, false);
      await db.exec('UPDATE portal_security_policy SET session_timeout_minutes=60');
      assert.equal((await rpc('portal_session', [main, expiredSession, 'open'])).valid, false);
      await db.exec('UPDATE portal_security_policy SET session_timeout_minutes=30');
      assert.equal((await rpc('portal_session', [account, accountSession, 'open'])).valid, true);
    });
    await t.test('private RPCs are inaccessible directly and Account cannot promote itself', async () => {
      await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: account, session_id: accountSession })]);
      await db.exec('SET ROLE authenticated');
      await assert.rejects(rpc('portal_begin_login', ['attacker@example.test']), /permission denied/i);
      await assert.rejects(db.query('SELECT * FROM portal_security_policy'), /permission denied/i);
      assert.equal((await db.query('SELECT * FROM members')).rows.length, 1);
      await db.query("UPDATE profiles SET role='main-admin' WHERE id=$1", [account]);
      await db.exec('RESET ROLE');
      assert.equal(await scalar('SELECT role AS j FROM profiles WHERE id=$1', [account]), 'account');
      await db.query("UPDATE portal_sessions SET last_activity=now()-interval '31 minutes' WHERE session_id=$1", [accountSession]);
      await db.exec('SET ROLE authenticated');
      assert.equal((await db.query('SELECT * FROM members')).rows.length, 0);
      await db.exec('RESET ROLE');
    });
    await t.test('settings save validates bounds and cannot revive old expired sessions', async () => {
      await assert.rejects(rpc('portal_save_settings', [main, mainSession, JSON.stringify({ values: { failedLoginLimit: '0' } })]), /Invalid/i);
      const body = { values: { churchName: 'Saved Synthetic Church', sessionTimeoutMinutes: '5', failedLoginLimit: '5', lockoutMinutes: '15', backupRetention: '2', autoBackupEnabled: true }, logo: '' };
      const saved = await rpc('portal_save_settings', [main, mainSession, JSON.stringify(body)]);
      assert.equal(saved.policy.backupRetention, 2); assert.equal(saved.settings.values.churchName, 'Saved Synthetic Church');
      assert.equal((await rpc('portal_session', [account, accountSession, 'open'])).valid, false);
      await db.exec("UPDATE church_settings SET value=jsonb_set(value,'{values,backupRetention}','\"99\"') WHERE key='general'");
      assert.equal((await rpc('portal_security_status')).settings.values.backupRetention, '2');
    });
    await t.test('private snapshots are real data, prune to retention, and auto-run once daily', async () => {
      for (let i = 0; i < 3; i++) assert.equal((await rpc('portal_backup', [main, mainSession, false])).created, true);
      const list = await rpc('portal_list_backups', [main, mainSession]); assert.equal(list.length, 2);
      const backup = await rpc('portal_download_backup', [main, mainSession, list[0].id]);
      assert.equal(backup.data.members[0].name, 'Synthetic Member');
      assert.equal('portal_sessions' in backup.data, false); assert.equal('auth.users' in backup.data, false);
      assert.equal((await db.query('SELECT * FROM members')).rows.length, 1);
      assert.equal((await rpc('portal_backup', [main, mainSession, true])).created, true);
      assert.equal((await rpc('portal_backup', [main, mainSession, true])).created, false);
      assert.equal((await rpc('portal_list_backups', [main, mainSession])).length, 2);
      await db.exec('DELETE FROM portal_backup_snapshots WHERE automatic=true');
      assert.equal((await rpc('portal_backup', [main, mainSession, true])).created, false, 'pruning cannot reset the daily automatic-backup guard');
      await rpc('portal_session', [main, mainSession, 'close']);
      assert.equal((await rpc('portal_session', [main, mainSession, 'open'])).valid, false);
    });
  } finally { await db.close(); }
});
