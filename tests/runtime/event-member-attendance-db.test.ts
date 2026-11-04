import {test, before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {createPool} from '../../packages/db/index.js';
import {migrate} from '../../scripts/database.js';
import {readMigrationSources} from '../../packages/db/migration-files.mjs';
import {legacyMigrationProfile} from '../../packages/db/migration-plan.mjs';
import {runMigrationPlan} from '../../packages/db/migration-runner.mjs';
import {seedLocal, DEMO_USERS, DEMO_PASSWORD, DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import type {AttendanceAck, AttendancePage} from '../../modules/community/event-attendance-state.js';

// Authoring-only evidence in this change: DB/HTTP execution is not_run.
// The official runtime harness must supply an isolated disposable PostgreSQL.
// app.request exercises the actual middleware/router without opening a listener;
// no mock Pool, handler, command receipt or simulated DB is used here.
const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `fp_attendance_${process.pid}_${Date.now()}`, origin = 'http://127.0.0.1:4310';
const host = DEMO_USERS[0].user_id, member = DEMO_USERS[1].user_id, peer = DEMO_USERS[2].user_id;
let admin: Pool, pool: Pool, app: ReturnType<typeof createApp>, createdSchema = false;
type Session = {cookie: string; csrf: string};
let sessions: Session[];
before(async () => {
  assert.ok(databaseUrl, 'TEST_DATABASE_URL must explicitly name an isolated test database');
  const target = new URL(databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    && /^\/fp_[a-zA-Z0-9_]+$/.test(target.pathname) && !target.search && !target.hash,
  'Attendance DB tests require a local fp_* PostgreSQL database without query or fragment overrides');
  // Validate before constructing either pool. There is no remote/non-test
  // escape hatch; the separate upgrade schema uses this same admitted URL.
  admin = createPool(databaseUrl); pool = new Pool({connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 10});
  await admin.query(`CREATE SCHEMA ${schema}`); createdSchema = true; await migrate(pool);
  app = createApp(pool, origin, 'local', {eventEmailSender: async () => {throw Error('Attendance must not send email');}});
});
after(async () => {if (pool) await pool.end(); if (admin) {try {if (createdSchema) await admin.query(`DROP SCHEMA ${schema} CASCADE`);} finally {await admin.end();}}});
beforeEach(async () => {
  await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE'); await seedLocal(pool);
  sessions = []; for (const user of DEMO_USERS) sessions.push(await login(user.email));
});
async function login(email: string): Promise<Session> {
  const response = await app.request(`${origin}/api/v1/auth/login`, {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: JSON.stringify({email, password: DEMO_PASSWORD})});
  assert.equal(response.status, 200); const body = await response.json() as {csrf_token: string};
  return {cookie: response.headers.get('set-cookie')!.split(';')[0], csrf: body.csrf_token};
}
async function request<T = AttendanceAck & {code?: string}>(path: string, session: Session | null = sessions[0], body?: unknown, version?: number, key = randomUUID(), extra: Record<string, string> = {}, application: ReturnType<typeof createApp> = app) {
  const headers: Record<string, string> = {Origin: origin, ...(session ? {Cookie: session.cookie, 'X-CSRF-Token': session.csrf} : {})};
  if (body !== undefined) {headers['Content-Type'] = 'application/json'; headers['Idempotency-Key'] = key; if (version !== undefined) headers['If-Match'] = `"${version}"`;}
  const response = await application.request(`${origin}/api/v1${path}`, {method: body === undefined ? 'GET' : 'POST', headers: {...headers, ...extra}, body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await response.text();
  return {status: response.status, headers: response.headers, data: (text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null) as T};
}
const listPath = (id: string) => `/events/${id}/attendance`;
const path = (id: string, user = member) => `${listPath(id)}/${user}`;
async function fixture(q: Pool = pool) {
  const id = randomUUID();
  await q.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,capacity,state,visibility,aggregate_version)
    VALUES($1,$2,$3,'合成到場測試','主辦人工紀錄，不是完成或發獎',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour','online','合成教室',20,'published','open',17)`, [id, DEMO_COMMUNITY, host]);
  for (const user of [host, member, peer]) await q.query(`INSERT INTO community_event_rsvps(rsvp_id,event_id,user_id,state,confirmed_at) VALUES($1,$2,$3,'going',clock_timestamp())`, [randomUUID(), id, user]);
  return id;
}
async function page(id: string) {const result = await request<AttendancePage>(listPath(id)); assert.equal(result.status, 200); return result.data;}
async function stored(id: string, user = member) {return (await pool.query('SELECT to_jsonb(a) AS value FROM community_event_attendance a WHERE event_id=$1 AND member_ref=$2', [id, user])).rows[0]?.value;}
async function effects() {
  const result: Record<string, unknown> = {};
  for (const table of ['community_events', 'community_event_rsvps', 'community_event_guest_rsvps', 'community_event_attendance', 'transition_journal', 'command_receipts', 'outbox', 'member_notifications'])
    result[table] = (await pool.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
  return result;
}
async function attendanceJournal(id: string) {return (await pool.query("SELECT aggregate_version,command,data FROM transition_journal WHERE aggregate_type='community_event_attendance' AND data->>'event_id'=$1 ORDER BY aggregate_version", [id])).rows;}
async function guild(user: string, tier = 'full') {await pool.query(`INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier)
  VALUES($1,$2,$3,'guild_member_operations','active',$4) ON CONFLICT(community_id,user_id,guild_key) DO UPDATE SET state='active',member_tier=$4`, [randomUUID(), DEMO_COMMUNITY, user, tier]);}
async function waitForBlocked(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {if ((await pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE $1=ANY(pg_blocking_pids(a.pid))) AS blocked', [pid])).rows[0].blocked) return; await new Promise(resolve => setTimeout(resolve, 10));}
  assert.fail('The real PostgreSQL lock wait was not observed');
}

test('save, new login readback, retract and reconfirm retain independent member versions without changing event version', async () => {
  const id = await fixture(), initial = await page(id);
  assert.equal(initial.total, 3); assert(initial.items.every(item => item.state === 'unconfirmed' && item.version === 1));
  const sideEffects = await effects();
  const key = randomUUID(), first = await request(path(id), sessions[0], {action: 'confirm'}, 1, key);
  assert.equal(first.status, 200); assert.deepEqual(first.data, {acknowledged: true, event_id: id, member_ref: member, action: 'confirm', retraction_reason: null, command_key: key, attendance_version: 2, changed: true});
  assert.equal(first.headers.get('cache-control'), 'private, no-store'); assert.match(first.headers.get('vary') ?? '', /Cookie/i);
  assert.equal((await request(path(id, peer), sessions[0], {action: 'confirm'}, 1)).status, 200, 'A does not invalidate B CAS');
  sessions[0] = await login(DEMO_USERS[0].email);
  const read = await request<AttendancePage>(listPath(id)); assert.equal(read.status, 200);
  assert.equal(read.headers.get('cache-control'), 'private, no-store'); assert.match(read.headers.get('vary') ?? '', /Cookie/i);
  const row = read.data.items.find(item => item.member_ref === member)!;
  assert.equal(row.state, 'confirmed'); assert.equal(row.version, 2); assert.equal(row.recorded_by, host); assert(Number.isFinite(Date.parse(row.recorded_at!)));
  const retracted = await request(path(id), sessions[0], {action: 'retract', reason: 'marked_wrong_member'}, 2);
  assert.equal(retracted.status, 200); assert.equal(retracted.data.attendance_version, 3);
  assert.equal(Date.parse((await stored(id)).recorded_at), Date.parse(row.recorded_at!), 'Correction preserves the last confirmation timestamp');
  assert.equal((await stored(id)).state, 'retracted');
  assert.equal((await request(path(id), sessions[0], {action: 'confirm'}, 2)).status, 412, 'No ABA after correction');
  assert.equal((await request(path(id), sessions[0], {action: 'confirm'}, 3)).data.attendance_version, 4);
  assert.equal((await pool.query('SELECT aggregate_version FROM community_events WHERE event_id=$1', [id])).rows[0].aggregate_version, '17');
  const after = await effects(); for (const table of ['community_events', 'community_event_rsvps', 'community_event_guest_rsvps', 'outbox', 'member_notifications']) assert.deepEqual(after[table], sideEffects[table], table);
});

test('only the current organizer can list/write: reviewer, participant, anonymous, arbitrary member and self are denied', async () => {
  const id = await fixture(); await guild(member);
  await pool.query("INSERT INTO positioning_guild_officers(community_id,guild_key,user_id) VALUES($1,'guild_member_operations',$2)", [DEMO_COMMUNITY, member]);
  await pool.query("UPDATE community_events SET state='pending',review_guild_key='guild_member_operations' WHERE event_id=$1", [id]);
  assert.equal((await request<{can_review: boolean}>(`/events/${id}`, sessions[1])).data.can_review, true);
  await pool.query("UPDATE community_events SET state='published' WHERE event_id=$1", [id]);
  const before = await effects();
  for (const session of [sessions[1], sessions[2]]) {
    assert.equal((await request(listPath(id), session)).status, 403);
    assert.equal((await request(path(id), session, {action: 'confirm'}, 1)).status, 403);
  }
  assert.equal((await request(listPath(id), null)).status, 401);
  assert.equal((await request(path(id), null, {action: 'confirm'}, 1)).status, 401);
  assert.equal((await request(path(id, randomUUID()), sessions[0], {action: 'confirm'}, 1)).status, 404);
  assert.equal((await request(path(id, host), sessions[0], {action: 'confirm'}, 1)).data.code, 'attendance_self_confirmation');
  assert.equal((await request(`${listPath(id)}/me`)).status, 404, 'There is no self-service attendance read');
  assert.equal((await app.request(`${origin}/api/v1/public/events/${id}/attendance`)).status, 404);
  assert.deepEqual(await effects(), before);
});

for (const state of ['pending', 'rejected', 'cancelled', 'future']) test(`${state} cannot introduce attendance; ended published events allow an honest later record`, async () => {
  const id = await fixture();
  await pool.query("UPDATE community_events SET state=$2,starts_at=CASE WHEN $3 THEN clock_timestamp()+interval '1 day' ELSE starts_at END,ends_at=CASE WHEN $3 THEN clock_timestamp()+interval '2 days' ELSE ends_at END WHERE event_id=$1", [id, state === 'future' ? 'published' : state, state === 'future']);
  const before = await effects(); const denied = await request(path(id), sessions[0], {action: 'confirm'}, 1);
  assert.equal(denied.status, 409); assert.equal(denied.data.code, 'attendance_unavailable'); assert.deepEqual(await effects(), before);
  await pool.query("UPDATE community_events SET state='published',starts_at=clock_timestamp()-interval '2 days',ends_at=clock_timestamp()-interval '1 day' WHERE event_id=$1", [id]);
  assert.equal((await request(path(id), sessions[0], {action: 'confirm'}, 1)).status, 200);
  assert.equal((await pool.query('SELECT a.recorded_at>e.ends_at AS recorded_later FROM community_event_attendance a JOIN community_events e USING(event_id) WHERE a.event_id=$1', [id])).rows[0].recorded_later, true);
});

test('RSVP and event cancellation preserve history and correction while old exact ACK cannot resurrect state', async () => {
  const id = await fixture(), key = randomUUID(), body = {action: 'confirm'};
  const ack = await request(path(id), sessions[0], body, 1, key); assert.equal(ack.status, 200);
  assert.equal((await request(`/events/${id}/rsvp`, sessions[1], {going: false}, 17)).status, 200);
  assert.equal((await request(`/events/${id}/cancel`, sessions[0], {}, 17)).status, 200);
  let row = (await page(id)).items.find(item => item.member_ref === member)!;
  assert.equal(row.registration_state, 'cancelled'); assert.equal(row.state, 'confirmed'); assert.equal(row.can_retract, true);
  assert.equal((await request(path(id, peer), sessions[0], body, 1)).status, 409);
  assert.equal((await request(path(id), sessions[0], {action: 'retract', reason: 'not_confirmed'}, 2)).status, 200);
  const corrected = await effects(); const replay = await request(path(id), sessions[0], body, 1, key);
  assert.deepEqual(replay.data, ack.data); assert.equal(replay.status, 200); assert.deepEqual(await effects(), corrected);
  row = (await page(id)).items.find(item => item.member_ref === member)!; assert.equal(row.state, 'retracted'); assert.equal(row.version, 3); assert.equal(row.can_confirm, false);
  assert.equal((await request(path(id), sessions[0], body, 3)).status, 409);
});

for (const change of ['inactive', 'onboarding', 'departed_guild']) test(`${change} blocks new confirmation but not correction of retained attendance`, async () => {
  const id = await fixture(); await guild(host); await guild(member); await guild(peer);
  await pool.query("UPDATE community_events SET visibility='guild',event_kind='guild_skill_exchange',guild_key='guild_member_operations' WHERE event_id=$1", [id]);
  const key = randomUUID(), first = await request(path(id), sessions[0], {action: 'confirm'}, 1, key); assert.equal(first.status, 200);
  if (change === 'inactive') await pool.query('UPDATE users SET active=false WHERE user_id=ANY($1::uuid[])', [[member, peer]]);
  if (change === 'onboarding') await pool.query('UPDATE users SET onboarding_required=true,onboarding_completed_at=NULL WHERE user_id=ANY($1::uuid[])', [[member, peer]]);
  if (change === 'departed_guild') await pool.query('DELETE FROM positioning_profession_memberships WHERE user_id=ANY($1::uuid[])', [[member, peer]]);
  assert.equal((await request(path(id, peer), sessions[0], {action: 'confirm'}, 1)).status, 409);
  const row = (await page(id)).items.find(item => item.member_ref === member)!; assert.equal(row.can_retract, true);
  assert.equal((await request(path(id), sessions[0], {action: 'retract', reason: 'not_confirmed'}, 2)).status, 200);
  assert.deepEqual((await request(path(id), sessions[0], {action: 'confirm'}, 1, key)).data, first.data);
  assert.equal((await stored(id)).state, 'retracted');
});

for (const loss of ['intern', 'onboarding']) test(`organizer ${loss} loss denies new writes, correction and old receipt replay before effects`, async () => {
  const id = await fixture(); await guild(host); await guild(member); await guild(peer);
  await pool.query("UPDATE community_events SET visibility='guild',event_kind='guild_skill_exchange',guild_key='guild_member_operations' WHERE event_id=$1", [id]);
  const key = randomUUID(); assert.equal((await request(path(id), sessions[0], {action: 'confirm'}, 1, key)).status, 200);
  if (loss === 'intern') await guild(host, 'intern');
  else await pool.query('UPDATE users SET onboarding_required=true,onboarding_completed_at=NULL WHERE user_id=$1', [host]);
  const before = await effects();
  assert.equal((await request(path(id), sessions[0], {action: 'confirm'}, 1, key)).status, 403);
  assert.equal((await request(path(id), sessions[0], {action: 'retract', reason: 'not_confirmed'}, 2)).status, 403);
  assert.equal((await request(path(id, peer), sessions[0], {action: 'confirm'}, 1)).status, 403);
  if (loss === 'intern') {const history = await page(id); assert.equal(history.items.find(row => row.member_ref === member)!.can_retract, false);}
  else assert.equal((await request(listPath(id))).status, 403, 'The shared HTTP onboarding boundary still applies');
  assert.deepEqual(await effects(), before);
});

for (const loss of ['owner', 'tenant', 'missing_event', 'revoked', 'expired']) test(`${loss} is checked before successful receipt replay`, async () => {
  const id = await fixture(), key = randomUUID(), body = {action: 'confirm'};
  assert.equal((await request(path(id), sessions[0], body, 1, key)).status, 200);
  let expected = 403;
  if (loss === 'owner') await pool.query('UPDATE community_events SET organizer_ref=$2 WHERE event_id=$1', [id, peer]);
  if (loss === 'tenant') {
    const other = randomUUID(), user = randomUUID(), email = `attendance-tenant-${user}@example.test`;
    await pool.query("INSERT INTO communities VALUES($1,'合成其他社群')", [other]);
    await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref) SELECT $1,$2,$3,'合成外社群會員',password_hash,$4 FROM users WHERE user_id=$5`, [user, other, email, randomUUID(), host]);
    sessions[0] = await login(email); expected = 404;
  }
  if (loss === 'missing_event') {await pool.query('DELETE FROM community_event_rsvps WHERE event_id=$1', [id]); await pool.query('DELETE FROM community_events WHERE event_id=$1', [id]); expected = 404;}
  if (loss === 'revoked') {await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1', [host]); expected = 401;}
  if (loss === 'expired') {await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1", [host]); expected = 401;}
  const before = await effects(); assert.equal((await request(path(id), sessions[0], body, 1, key)).status, expected); assert.equal((await request(listPath(id))).status, expected); assert.deepEqual(await effects(), before);
});

test('same key concurrency creates one effect, body/expected mismatch conflicts, and separate subjects/events have distinct receipt namespaces', async () => {
  const id = await fixture(), key = randomUUID(), body = {action: 'confirm'};
  const results = await Promise.all([1, 2].map(() => request(path(id), sessions[0], body, 1, key)));
  assert.deepEqual(results.map(result => result.status), [200, 200]); assert.deepEqual(results[0].data, results[1].data); assert.equal((await attendanceJournal(id)).length, 1);
  const before = await effects();
  for (const [value, version] of [[{action: 'retract', reason: 'not_confirmed'}, 1], [body, 2]] as const) {
    const mismatch = await request(path(id), sessions[0], value, version, key); assert.equal(mismatch.status, 409); assert.equal(mismatch.data.code, 'idempotency_conflict'); assert.deepEqual(await effects(), before);
  }
  assert.equal((await request(path(id, peer), sessions[0], body, 1, key)).status, 200);
  const second = await fixture(); assert.equal((await request(path(second), sessions[0], body, 1, key)).status, 200);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM command_receipts WHERE idempotency_key=$1', [key])).rows[0].n, 3);
});

test('two keys at the same member version commit one effect and a same-state command never appends a second journal transition', async () => {
  const id = await fixture(), body = {action: 'confirm'}, keys = [randomUUID(), randomUUID()];
  const result = await Promise.all(keys.map(key => request(path(id), sessions[0], body, 1, key)));
  assert.equal(result.filter(item => item.status === 200).length, 1);
  const loser = result.findIndex(item => item.status !== 200), denied = result[loser];
  assert(denied.status === 409 || denied.status === 412);
  assert.equal(denied.data.code, denied.status === 409 ? 'attendance_busy' : 'version_conflict');
  assert.equal((await attendanceJournal(id)).length, 1);
  if (denied.status === 409) {
    // The winner is now committed. This is an explicit test-caller retry of
    // the exact loser tuple, not automatic retry behavior in the product.
    const stale = await request(path(id), sessions[0], body, 1, keys[loser]);
    assert.equal(stale.status, 412); assert.equal(stale.data.code, 'version_conflict');
  }
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM command_receipts WHERE idempotency_key=ANY($1::text[])', [keys])).rows[0].n, 1);
  const repeat = await request(path(id), sessions[0], body, 2); assert.equal(repeat.status, 200); assert.equal(repeat.data.changed, false); assert.equal(repeat.data.attendance_version, 2); assert.equal((await attendanceJournal(id)).length, 1);
});

test('strict bodies, quoted CAS, pagination and exhausted versions fail without consuming effect or key', async () => {
  const id = await fixture(), key = randomUUID(), before = await effects();
  for (const body of [{action: 'confirm', actor: host}, {action: 'confirm', reason: 'not_confirmed'}, {action: 'confirm', occurred_at: '2000-01-01'}, {action: 'retract'}, {action: 'retract', reason: 'free text'}, {action: 'award'}, null]) {
    assert.equal((await request(path(id), sessions[0], body, 1, key)).status, 422); assert.deepEqual(await effects(), before);
  }
  assert.equal((await request(path(id), sessions[0], {action: 'confirm'})).status, 428);
  assert.equal((await request(path(id), sessions[0], {action: 'confirm'}, 1, key, {'If-Match': '1'})).status, 400);
  for (const query of ['limit=0', 'limit=51', 'offset=-1', 'offset=1.5', 'offset=9007199254740992', 'unknown=1']) assert.equal((await request(`${listPath(id)}?${query}`)).status, 422);
  assert.deepEqual(await effects(), before);
  assert.equal((await request(path(id), sessions[0], {action: 'confirm'}, 1, key)).status, 200);
  await pool.query('UPDATE community_event_attendance SET aggregate_version=9007199254740991 WHERE event_id=$1', [id]);
  const max = await effects(); assert.equal((await request(path(id), sessions[0], {action: 'retract', reason: 'not_confirmed'}, Number.MAX_SAFE_INTEGER)).status, 409); assert.deepEqual(await effects(), max);
});

for (const table of ['transition_journal', 'command_receipts']) test(`${table} insertion failure rolls back row, journal and receipt together and preserves retry key`, async () => {
  const id = await fixture(), key = randomUUID(), before = await effects();
  await pool.query(`CREATE FUNCTION reject_attendance_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic attendance write failure'; END $$;
    CREATE TRIGGER reject_attendance_write BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_attendance_write()`);
  try {assert.equal((await request(path(id), sessions[0], {action: 'confirm'}, 1, key)).status, 500); assert.deepEqual(await effects(), before);}
  finally {await pool.query(`DROP TRIGGER reject_attendance_write ON ${table}; DROP FUNCTION reject_attendance_write()`);}
  assert.equal((await request(path(id), sessions[0], {action: 'confirm'}, 1, key)).status, 200); assert.equal((await attendanceJournal(id)).length, 1);
});

test('session expiry while the final receipt INSERT waits rolls back the whole transaction', async () => {
  const id = await fixture(), blocker = await pool.connect(), key = randomUUID(); let pending: ReturnType<typeof request> | undefined;
  await pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE user_id=$1", [host]); const before = await effects();
  try {
    await blocker.query('BEGIN'); await blocker.query('LOCK TABLE command_receipts IN SHARE MODE');
    const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending = request(path(id), sessions[0], {action: 'confirm'}, 1, key); await waitForBlocked(pid);
    await blocker.query("SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM (max(expires_at)-clock_timestamp())))+0.05) FROM sessions WHERE user_id=$1", [host]);
    await blocker.query('COMMIT'); const result = await pending; assert.equal(result.status, 401); assert.equal(result.data.code, 'session_expired'); assert.deepEqual(await effects(), before);
  } finally {await blocker.query('ROLLBACK'); blocker.release(); if (pending) await pending;}
});

test('the second canonical guild-member try-lock fails closed and releases the first lock on rollback', async () => {
  const id = await fixture(), key = randomUUID(), blocker = await pool.connect();
  // A tier writer acting as member can hold member first and need host next.
  // Attendance sorts host first, member second. Keep that reverse-order lock
  // held throughout the HTTP response; a blocking implementation must fail
  // this case rather than hanging the runtime suite indefinitely.
  assert(host < member, 'The fixture must exercise failure on the second lock');
  const hostKey = `guild-member/${DEMO_COMMUNITY}/${host}`, subjectKey = `guild-member/${DEMO_COMMUNITY}/${member}`;
  // Keep lock_timeout off: a mistaken blocking implementation must produce
  // statement timeout (57014), not 55P03 that could masquerade as NOWAIT.
  const attemptPool = new Pool({connectionString: databaseUrl, options: `-c search_path=${schema} -c lock_timeout=0 -c statement_timeout=5000`, max: 2});
  const attemptApp = createApp(attemptPool, origin, 'local');
  const before = await effects();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [subjectKey]);
    const response = await attemptApp.request(`${origin}/api/v1${path(id)}`, {method: 'POST',
      headers: {Origin: origin, Cookie: sessions[0].cookie, 'X-CSRF-Token': sessions[0].csrf,
        'Content-Type': 'application/json', 'Idempotency-Key': key, 'If-Match': '"1"'}, body: JSON.stringify({action: 'confirm'})});
    assert.equal(response.status, 409); assert.equal((await response.json() as {code: string}).code, 'attendance_busy');
    assert.deepEqual(await effects(), before, 'No attendance row, journal, receipt or unrelated effect');
    // The subject lock has not been released, so success cannot be explained
    // by waiting for it. Acquiring host here proves the failed transaction did
    // not leak the first lock and the reverse-order writer can now continue.
    const released = (await blocker.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired', [hostKey])).rows[0].acquired;
    assert.equal(released, true, 'Rollback releases the already-acquired actor lock');
    await blocker.query('ROLLBACK');
    // Only this explicit caller retry may execute; the failed key was not spent.
    const retried = await request(path(id), sessions[0], {action: 'confirm'}, 1, key);
    assert.equal(retried.status, 200); assert.equal(retried.data.attendance_version, 2); assert.equal((await attendanceJournal(id)).length, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM command_receipts WHERE idempotency_key=$1', [key])).rows[0].n, 1);
  } finally {await blocker.query('ROLLBACK'); blocker.release(); await attemptPool.end();}
});

test('held event lock refuses attendance immediately and an explicit retry sees committed cancellation', async () => {
  const id = await fixture(), key = randomUUID(), blocker = await pool.connect(), before = await effects();
  const attemptPool = new Pool({connectionString: databaseUrl, options: `-c search_path=${schema} -c lock_timeout=0 -c statement_timeout=5000`, max: 2});
  const attemptApp = createApp(attemptPool, origin, 'local');
  try {
    await blocker.query('BEGIN'); await blocker.query('SELECT 1 FROM community_events WHERE event_id=$1 FOR UPDATE', [id]);
    const denied = await request(path(id), sessions[0], {action: 'confirm'}, 1, key, {}, attemptApp);
    assert.equal(denied.status, 409); assert.equal(denied.data.code, 'attendance_busy'); assert.deepEqual(await effects(), before);
    await blocker.query("UPDATE community_events SET state='cancelled' WHERE event_id=$1", [id]); await blocker.query('COMMIT');
    const cancelled = await effects(), retry = await request(path(id), sessions[0], {action: 'confirm'}, 1, key);
    assert.equal(retry.status, 409); assert.equal(retry.data.code, 'attendance_unavailable'); assert.deepEqual(await effects(), cancelled);
    assert.equal(await stored(id), undefined); assert.equal((await attendanceJournal(id)).length, 0);
  } finally {await blocker.query('ROLLBACK'); blocker.release(); await attemptPool.end();}
});

test('a held subject user lock returns attendance_busy through the real HTTP 55P03 path without effects', async () => {
  const id = await fixture(), key = randomUUID(), blocker = await pool.connect(), before = await effects();
  const attemptPool = new Pool({connectionString: databaseUrl, options: `-c search_path=${schema} -c lock_timeout=0 -c statement_timeout=5000`, max: 2});
  const attemptApp = createApp(attemptPool, origin, 'local');
  try {
    await blocker.query('BEGIN'); await blocker.query('SELECT 1 FROM users WHERE user_id=$1 FOR UPDATE', [member]);
    const denied = await request(path(id), sessions[0], {action: 'confirm'}, 1, key, {}, attemptApp);
    assert.equal(denied.status, 409); assert.equal(denied.data.code, 'attendance_busy'); assert.deepEqual(await effects(), before);
    await blocker.query('ROLLBACK');
    assert.equal((await request(path(id), sessions[0], {action: 'confirm'}, 1, key)).status, 200);
    assert.equal((await attendanceJournal(id)).length, 1);
  } finally {await blocker.query('ROLLBACK'); blocker.release(); await attemptPool.end();}
});

test('real tier writer and attendance with reverse actor-target guild lock order finish without a deadlock', async () => {
  const id = await fixture(), key = randomUUID(), blocker = await pool.connect();
  await guild(host); await guild(member);
  await pool.query("UPDATE community_events SET visibility='guild',event_kind='guild_skill_exchange',guild_key='guild_member_operations' WHERE event_id=$1", [id]);
  await pool.query("INSERT INTO positioning_guild_officers(community_id,guild_key,user_id) VALUES($1,'guild_member_operations',$2)", [DEMO_COMMUNITY, member]);
  const attemptPool = new Pool({connectionString: databaseUrl, options: `-c search_path=${schema} -c lock_timeout=0 -c statement_timeout=5000`, max: 2});
  const attemptApp = createApp(attemptPool, origin, 'local');
  let tierWrite: ReturnType<typeof request<{member_tier: string; code?: string}>> | undefined;
  const before = await effects();
  try {
    await blocker.query('BEGIN');
    await blocker.query("SELECT 1 FROM positioning_profession_memberships WHERE community_id=$1 AND user_id=$2 AND guild_key='guild_member_operations' FOR UPDATE", [DEMO_COMMUNITY, member]);
    const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    // The actual tier route acquires guild-member/member before it waits on
    // this master membership row, then needs guild-member/host next.
    tierWrite = request<{member_tier: string; code?: string}>(`/guilds/guild_member_operations/members/${host}/tier`, sessions[1], {member_tier: 'intern'}, 1, randomUUID(), {}, attemptApp);
    await waitForBlocked(pid);
    const waiting = (await pool.query('SELECT query FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid])).rows;
    assert(waiting.some(row => /FROM positioning_profession_memberships[\s\S]*FOR UPDATE/.test(row.query)));
    const attendance = await request(path(id), sessions[0], {action: 'confirm'}, 1, key, {}, attemptApp);
    assert.equal(attendance.status, 409); assert.equal(attendance.data.code, 'attendance_busy'); assert.deepEqual(await effects(), before);
    await blocker.query('COMMIT');
    const tierResult = await tierWrite; assert.equal(tierResult.status, 200); assert.equal(tierResult.data.member_tier, 'intern');
    // The real tier command has completed. The old attendance tuple now sees
    // revoked organizer authority instead of producing a saved confirmation.
    const retry = await request(path(id), sessions[0], {action: 'confirm'}, 1, key);
    assert.equal(retry.status, 403); assert.equal(await stored(id), undefined); assert.equal((await attendanceJournal(id)).length, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM command_receipts WHERE idempotency_key=$1', [key])).rows[0].n, 0);
  } finally {await blocker.query('ROLLBACK'); blocker.release(); if (tierWrite) await tierWrite; await attemptPool.end();}
});

test('real SQL event-to-guild crossover ends through NOWAIT rollback rather than a 40P01 deadlock', async () => {
  const id = await fixture(), attendancePattern = await pool.connect(), eventWriter = await pool.connect();
  const before = await effects(); let waitingGuild: Promise<void> | undefined;
  // This deliberately reproduces the two real SQL lock orders. It does not
  // claim to execute updateEventSchedule/setEventWaitlistPolicy, and it does
  // not replace the neighboring real-HTTP 55P03 -> attendance_busy assertion.
  // Explicit control here establishes a crossover deterministically instead
  // of relying on a fast HTTP command reaching a guessed interleaving.
  try {
    await attendancePattern.query('BEGIN'); await eventWriter.query('BEGIN');
    for (const connection of [attendancePattern, eventWriter]) {
      await connection.query("SET LOCAL lock_timeout='0'");
      await connection.query("SET LOCAL statement_timeout='5s'");
    }
    for (const user of [host, member].sort()) await attendancePattern.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`guild-member/${DEMO_COMMUNITY}/${user}`]);
    await eventWriter.query('SELECT 1 FROM community_events WHERE event_id=$1 FOR UPDATE', [id]);
    const pid = (await attendancePattern.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    waitingGuild = eventWriter.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`guild-member/${DEMO_COMMUNITY}/${host}`]).then(() => undefined);
    await waitForBlocked(pid);
    const waiting = (await pool.query('SELECT query FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid])).rows;
    assert(waiting.some(row => row.query.includes('pg_advisory_xact_lock')), 'Event-first writer must be waiting for the held guild key');
    await assert.rejects(attendancePattern.query('SELECT 1 FROM community_events WHERE event_id=$1 FOR UPDATE NOWAIT', [id]),
      (error: unknown) => (error as {code: string}).code === '55P03', 'NOWAIT must fail immediately, never enter deadlock detection with 40P01');
    await attendancePattern.query('ROLLBACK'); await waitingGuild;
    await eventWriter.query('COMMIT');
    assert.deepEqual(await effects(), before, 'Neither SQL lock reproduction creates attendance or command facts');
  } finally {
    await attendancePattern.query('ROLLBACK'); attendancePattern.release();
    try {if (waitingGuild) await waitingGuild;} finally {await eventWriter.query('ROLLBACK'); eventWriter.release();}
  }
});

test('original attendees/guest/public DTOs are unchanged and contain no attendance or contact fields', async () => {
  const id = await fixture(); await pool.query(`INSERT INTO community_event_guest_rsvps(event_id,email,name,email_sent_at,state,confirmed_at) VALUES($1,'private-attendee@example.test','合成私有訪客',clock_timestamp(),'going',clock_timestamp())`, [id]);
  const before = (await request(`/events/${id}/attendees`)).data;
  assert.equal((await request(path(id), sessions[0], {action: 'confirm'}, 1)).status, 200);
  const attendees = await request<{items: Record<string, unknown>[]; total: number}>(`/events/${id}/attendees`); assert.deepEqual(attendees.data, before);
  for (const row of attendees.data.items) assert.deepEqual(Object.keys(row).sort(), row.kind === 'guest' ? ['kind', 'registered_at'] : ['avatar_url', 'kind', 'nickname', 'registered_at', 'user_id']);
  const publicResponse = await app.request(`${origin}/api/v1/public/events/${id}`), publicData = await publicResponse.json(); assert.equal(publicResponse.status, 200);
  const memberData = (await request(`/events/${id}`, sessions[2])).data;
  for (const dto of [publicData, memberData, attendees.data]) {
    const text = JSON.stringify(dto); assert.doesNotMatch(text, /attendance|recorded_by|recorded_at|retraction_reason|private-attendee|合成私有訪客|csrf|session_hash/);
  }
  const list = await page(id); assert.equal(list.total, 3); assert(!JSON.stringify(list).includes('@'));
  assert.equal((await request(`/events/${id}/rsvp`, sessions[1], {going: false}, 17)).status, 200);
  const paged = await request<AttendancePage>(`${listPath(id)}?limit=1&offset=0`); assert.equal(paged.data.total, 3); assert.equal(paged.data.next_offset, 1);
  const all: string[] = [];
  for (let offset = 0; offset < 3; offset++) all.push(...(await request<AttendancePage>(`${listPath(id)}?limit=1&offset=${offset}`)).data.items.map(row => row.member_ref));
  assert.equal(new Set(all).size, 3); assert(all.includes(member), 'Cancelled RSVP remains in the history union once');
});

test('verification accounts are excluded from new attendance but retained records remain correctable', async () => {
  const id = await fixture(); assert.equal((await request(path(id), sessions[0], {action: 'confirm'}, 1)).status, 200);
  await pool.query("UPDATE users SET email=user_id::text||'@example.invalid' WHERE user_id=ANY($1::uuid[])", [[member, peer]]);
  const history = await page(id); assert.equal(history.total, 2); assert(history.items.some(row => row.member_ref === member)); assert(!history.items.some(row => row.member_ref === peer));
  assert.equal((await request(path(id, peer), sessions[0], {action: 'confirm'}, 1)).status, 404);
  assert.equal((await request(path(id), sessions[0], {action: 'retract', reason: 'not_confirmed'}, 2)).status, 200);
  assert.equal((await stored(id)).state, 'retracted');
});

test('HTTP history rejects onboarding revoked between member boundary and the domain user lock', async () => {
  const id = await fixture(), blocker = await pool.connect(); let pending: ReturnType<typeof request> | undefined;
  try {
    await blocker.query('BEGIN'); await blocker.query('SELECT 1 FROM users WHERE user_id=$1 FOR UPDATE', [host]);
    const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    // At this point no eligibility value has changed. Authentication and the
    // HTTP boundary can read the committed eligible row, but the domain's
    // current-user SHARE lock must wait behind this genuine PostgreSQL lock.
    pending = request(listPath(id)); await waitForBlocked(pid);
    const waiting = (await pool.query('SELECT query FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid])).rows;
    assert(waiting.some(row => /SELECT user_id FROM users[\s\S]*FOR SHARE/.test(row.query)), 'The request must have passed the boundary and reached the domain user lock');
    await blocker.query('UPDATE users SET onboarding_required=true,onboarding_completed_at=NULL WHERE user_id=$1', [host]);
    await blocker.query('COMMIT');
    const denied = await pending; assert.equal(denied.status, 403); assert(!JSON.stringify(denied.data).includes('member_ref'), 'No private roster escapes the stale boundary snapshot');
    assert.equal((await attendanceJournal(id)).length, 0);
  } finally {await blocker.query('ROLLBACK'); blocker.release(); if (pending) await pending;}
});

test('private history GET rechecks session expiry after waiting for the event lock', async () => {
  const id = await fixture(), blocker = await pool.connect(); let pending: ReturnType<typeof request> | undefined;
  await pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE user_id=$1", [host]);
  try {
    await blocker.query('BEGIN'); await blocker.query('SELECT 1 FROM community_events WHERE event_id=$1 FOR UPDATE', [id]);
    const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending = request(listPath(id)); await waitForBlocked(pid);
    await blocker.query("SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM (max(expires_at)-clock_timestamp())))+0.05) FROM sessions WHERE user_id=$1", [host]);
    await blocker.query('COMMIT'); const denied = await pending; assert.equal(denied.status, 401); assert.equal(denied.data.code, 'session_expired'); assert(!JSON.stringify(denied.data).includes('member_ref'));
  } finally {await blocker.query('ROLLBACK'); blocker.release(); if (pending) await pending;}
});

test('database enforces composite identity, finite versions and immutable identity; normal RSVP parent cleanup remains possible', async () => {
  const id = await fixture(), other = await fixture(); assert.equal((await request(path(id), sessions[0], {action: 'confirm'}, 1)).status, 200);
  const row = await stored(id), before = await effects();
  for (const column of ['attendance_id', 'community_id', 'event_id', 'member_ref', 'rsvp_id']) await assert.rejects(pool.query(`UPDATE community_event_attendance SET ${column}=$2 WHERE attendance_id=$1`, [row.attendance_id, randomUUID()]), (error: unknown) => (error as {code: string}).code === '23514');
  for (const version of ['1', '9007199254740992']) await assert.rejects(pool.query('UPDATE community_event_attendance SET aggregate_version=$2 WHERE attendance_id=$1', [row.attendance_id, version]), (error: unknown) => (error as {code: string}).code === '23514');
  const wrongRsvp = (await pool.query('SELECT rsvp_id FROM community_event_rsvps WHERE event_id=$1 AND user_id=$2', [other, peer])).rows[0].rsvp_id;
  await assert.rejects(pool.query(`INSERT INTO community_event_attendance(attendance_id,community_id,event_id,member_ref,rsvp_id,state,recorded_by,updated_by) VALUES($1,$2,$3,$4,$5,'confirmed',$6,$6)`, [randomUUID(), DEMO_COMMUNITY, id, peer, wrongRsvp, host]), (error: unknown) => (error as {code: string}).code === '23503');
  const foreignCommunity = randomUUID(), foreignMember = randomUUID();
  await pool.query("INSERT INTO communities VALUES($1,'合成外社群')", [foreignCommunity]);
  await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref) VALUES($1,$2,$3,'合成外社群會員','unused-synthetic', $4)`, [foreignMember, foreignCommunity, `${foreignMember}@example.test`, randomUUID()]);
  const peerRsvp = (await pool.query('SELECT rsvp_id FROM community_event_rsvps WHERE event_id=$1 AND user_id=$2', [id, peer])).rows[0].rsvp_id;
  for (const [community, recorder] of [[foreignCommunity, host], [DEMO_COMMUNITY, foreignMember]]) await assert.rejects(pool.query(`INSERT INTO community_event_attendance(attendance_id,community_id,event_id,member_ref,rsvp_id,state,recorded_by,updated_by) VALUES($1,$2,$3,$4,$5,'confirmed',$6,$6)`, [randomUUID(), community, id, peer, peerRsvp, recorder]), (error: unknown) => (error as {code: string}).code === '23503');
  assert.deepEqual(await effects(), before);
  await pool.query('DELETE FROM community_event_rsvps WHERE event_id=$1', [id]); assert.equal(await stored(id), undefined);
  await pool.query('DELETE FROM community_events WHERE event_id=$1', [id]); assert.equal((await pool.query('SELECT 1 FROM community_events WHERE event_id=$1', [id])).rowCount, 0);
});

test('populated schema199 upgrades to 200 without backfilling attendance or changing historical SQL/ledger/data', async () => {
  const upgradeSchema = `${schema}_upgrade`, oldPool = new Pool({connectionString: databaseUrl, options: `-c search_path=${upgradeSchema}`, max: 2}); let created = false;
  const sources = readMigrationSources(fileURLToPath(new URL('../../migrations/', import.meta.url)));
  const historical = sources.filter((source: {name: string}) => Number(source.name.slice(0, 3)) <= 199);
  const profile = legacyMigrationProfile({first: 1, last: 199, known_gaps: [22]});
  // This upgrade fixture is self-contained in a shallow checkout. Preserve
  // the current historical files through the upgrade, without requiring a
  // local-only ancestor object or claiming comparison with an unavailable ref.
  const historicalFiles = new Map<string, {bytes: Buffer; sha256: string}>();
  for (const source of historical) {
    const bytes = await readFile(new URL(`../../migrations/${source.name}`, import.meta.url));
    historicalFiles.set(source.name, {bytes, sha256: createHash('sha256').update(bytes).digest('hex')});
  }
  try {
    await admin.query(`CREATE SCHEMA ${upgradeSchema}`); created = true; await runMigrationPlan(oldPool, {sources: historical, profile}); await seedLocal(oldPool); await fixture(oldPool);
    const tables = ['community_events', 'community_event_rsvps', 'users', 'transition_journal', 'command_receipts'];
    const snapshot = async () => Promise.all(tables.map(async table => (await oldPool.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
    const before = await snapshot(), ledger = (await oldPool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
    assert.equal((await oldPool.query("SELECT to_regclass('community_event_attendance') AS table_name")).rows[0].table_name, null);
    const upgraded = await runMigrationPlan(oldPool, {sources, profile: legacyMigrationProfile({...profile, last: 200})});
    assert.deepEqual(upgraded.applied, ['200_event_member_attendance.sql']); assert.deepEqual(await snapshot(), before);
    assert.deepEqual((await oldPool.query("SELECT * FROM schema_migrations WHERE name<'200_' ORDER BY name")).rows, ledger);
    assert.equal((await oldPool.query('SELECT count(*)::int AS n FROM community_event_attendance')).rows[0].n, 0);
    assert.deepEqual((await runMigrationPlan(oldPool, {sources, profile: legacyMigrationProfile({...profile, last: 200})})).applied, []);
    for (const [name, original] of historicalFiles) {
      const after = await readFile(new URL(`../../migrations/${name}`, import.meta.url));
      assert.deepEqual(after, original.bytes, `${name}: historical SQL bytes remain unchanged`);
      assert.equal(createHash('sha256').update(after).digest('hex'), original.sha256, name);
    }
  } finally {await oldPool.end(); if (created) await admin.query(`DROP SCHEMA ${upgradeSchema} CASCADE`);}
});
