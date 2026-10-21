import {test, before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {seedLocal, DEMO_USERS, DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {hashPassword, verifyMemberPassword} from '../../modules/identity-membership/service.js';
import {ApplicationPageSchema} from '../../contracts/guild-launchpad/v1/module-registry.js';
import {createRegistryHarness, type RegistryHarness} from './module-registry-harness.js';

const commerce = 'guild_commerce_sales';
const supplier = 'guild_product_quality_supply';
const production = 'guild_commercial_production';
let h: RegistryHarness;
before(async () => {
  h = await createRegistryHarness('fp_store_offer');
  assert.deepEqual((await platformOffer()).map(row=>[row.release_ref,row.status]), [['hosted-store@1.0.0','withdrawn'],['hosted-store@1.1.0','offered']], 'Migration preserves the withdrawn release and offers its successor');
});
after(async () => {await h.stop();});
beforeEach(async () => {await h.reset();});
async function platformOffer() {
  return (await h.pool.query(`SELECT community_id,guild_key,application_key,release_ref,status,display_order,launch_policy_ref,version::text AS version
    FROM guild_application_offerings WHERE community_id IS NULL AND guild_key IS NULL AND application_key='hosted-store' ORDER BY release_ref`)).rows;
}
test('migration and seed keep exactly one platform hosted-store offering with the definition policy', async () => {
  const policy = (await h.pool.query("SELECT launch_policy_ref FROM application_definitions WHERE release_ref='hosted-store@1.1.0'")).rows[0].launch_policy_ref;
  assert.deepEqual(await platformOffer(), [{community_id: null, guild_key: null, application_key: 'hosted-store', release_ref: 'hosted-store@1.1.0', status: 'offered', display_order: 10, launch_policy_ref: policy, version: '1'}]);
  assert.deepEqual(policy, {policy_key: 'hosted-store.launch', version: '1'});
});
test('seedLocal restores the hosted offering after community truncation and stays idempotent', async () => {
  await h.pool.query('TRUNCATE communities CASCADE');
  assert.deepEqual(await platformOffer(), []);
  await seedLocal(h.pool); const first = await platformOffer();
  assert.equal(first.length, 1);
  await seedLocal(h.pool); assert.deepEqual(await platformOffer(), first);
});
test('repeated demo seeding preserves independent salts, real password checks and existing password changes', async () => {
  const q = await h.pool.connect();
  try {
    for (let reset = 0; reset < 2; reset++) {
      await h.reset();
      const rows = (await q.query('SELECT password_hash FROM users WHERE user_id=ANY($1::uuid[])', [DEMO_USERS.map(user => user.user_id)])).rows;
      assert.equal(rows.length, 3);
      assert.equal(new Set(rows.map(row => row.password_hash.split(':')[0])).size, 3);
      for (const user of DEMO_USERS) {
        assert.equal(await verifyMemberPassword(q, user.user_id, DEMO_PASSWORD), true);
        assert.equal(await verifyMemberPassword(q, user.user_id, 'incorrect-demo-password'), false);
      }
      const changed = hashPassword('changed-local-demo-password');
      await q.query('UPDATE users SET password_hash=$1 WHERE user_id=$2', [changed, DEMO_USERS[0].user_id]);
      await seedLocal(h.pool);
      assert.equal((await q.query('SELECT password_hash FROM users WHERE user_id=$1', [DEMO_USERS[0].user_id])).rows[0].password_hash, changed);
      assert.equal(await verifyMemberPassword(q, DEMO_USERS[0].user_id, 'changed-local-demo-password'), true);
      assert.equal(await verifyMemberPassword(q, DEMO_USERS[0].user_id, DEMO_PASSWORD), false);
    }
  } finally { q.release(); }
});
test('commerce and supplier recommend hosted-store then manual-workspace while production keeps manual-workspace', async () => {
  const session = (await h.person('商店會員')).session;
  for (const [guild, expected] of [[commerce, ['hosted-store', 'manual-workspace']], [supplier, ['hosted-store', 'manual-workspace']], [production, ['manual-workspace']]] as const) {
    await h.fullMember(session.user.user_id, guild);
    const result = await h.call('GET', `/guilds/${guild}/launchpad`, session);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.config.body.application_refs.map((ref: {application_key: string}) => ref.application_key), expected);
    assert.equal(result.data.config.revision, '5'); assert.equal(result.data.config.pointer_version, '1');
  }
});
for (const guild of [commerce, supplier]) test(`full and intern ${guild} members can start with no space`, async () => {
  const session = (await h.person('商店資格會員')).session;
  await h.fullMember(session.user.user_id, guild);
  async function eligibility() {
    const result = await h.call('GET', `/applications?guild_key=${guild}`, session);
    assert.equal(result.status, 200);
    const item = ApplicationPageSchema.parse(result.data).items.find(app => app.application_key === 'hosted-store');
    assert.ok(item?.eligibility); return item.eligibility;
  }
  const requiredTier = 'intern';
  assert.deepEqual(await eligibility(), {can_launch: false, reason_codes: ['tenant_manage_required'], required_guild_tier: requiredTier, tenant_action: 'create', policy_revision: '1'});
  await h.createTenant(session, '選物工作室');
  assert.deepEqual(await eligibility(), {can_launch: true, reason_codes: [], required_guild_tier: requiredTier, tenant_action: 'select', policy_revision: '1'});
  await h.fullMember(session.user.user_id, guild, 'intern');
  const expected = {can_launch: true, reason_codes: [], required_guild_tier: 'intern', tenant_action: 'select', policy_revision: '1'};
  assert.deepEqual(await eligibility(), expected);
  const launchpad = await h.call('GET', `/guilds/${guild}/launchpad`, session);
  assert.deepEqual(launchpad.data.applications.find((app: {application_key: string}) => app.application_key === 'hosted-store').eligibility, expected);
  assert.deepEqual(launchpad.data.applications.find((app: {application_key: string}) => app.application_key === 'manual-workspace').eligibility,
    {can_launch: false, reason_codes: ['guild_full_member_required'], required_guild_tier: 'full', tenant_action: 'denied', policy_revision: '1'});
});
test('withdrawn hosted offering makes the commerce default fall back to manual-workspace', async () => {
  const session = (await h.person('商店撤回會員')).session;
  await h.fullMember(session.user.user_id, commerce);
  await h.pool.query("UPDATE guild_application_offerings SET status='withdrawn',version=version+1 WHERE community_id IS NULL AND guild_key IS NULL AND release_ref='hosted-store@1.1.0'");
  const result = await h.call('GET', `/guilds/${commerce}/launchpad`, session);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.config.body.application_refs, [{application_key: 'manual-workspace', release_ref: 'manual-workspace@1.0.0', order: 0}]);
});


test('another guild full membership cannot substitute for commerce eligibility or first launch', async () => {
  const person = await h.person('其他公會正式會員');
  await h.fullMember(person.id, production);
  const space = await h.createTenant(person.session, '不可繞過電商資格');
  const page = await h.call('GET', `/applications?guild_key=${production}`, person.session);
  const eligible = ApplicationPageSchema.parse(page.data).items.find(app => app.application_key === 'hosted-store')!.eligibility!;
  assert.deepEqual(eligible, {can_launch: false, reason_codes: ['commerce_guild_member_required'], required_guild_tier: 'intern', tenant_action: 'denied', policy_revision: '1'});
  const plan = await h.plan(person.session, space.tenantId, h.planBody(production, space.workspaceId, 'hosted-store', 'hosted-store@1.1.0'));
  assert.equal(plan.status, 403); assert.equal(plan.data.code, 'commerce_guild_member_required');
  assert.equal(await h.count('module_launch_plans', 'WHERE tenant_id=$1', [space.tenantId]), 0);
});

for (const [guild, change, allowed] of [[supplier, 'intern', true], [supplier, 'left', false], [commerce, 'intern', true], [commerce, 'left', false]] as const) {
  test(`${guild} launch rechecks ${change} after waiting on the workspace`, {timeout: 20000}, async () => {
    const person = await h.person('等待資格核對');
    await h.fullMember(person.id, guild);
    const space = await h.createTenant(person.session, '等待後重新核對');
    const plan = await h.plan(person.session, space.tenantId, h.planBody(guild, space.workspaceId, 'hosted-store', 'hosted-store@1.1.0'));
    assert.equal(plan.status, 201, JSON.stringify(plan.data));
    const holder = await h.pool.connect();
    let pending: ReturnType<typeof h.launch> | undefined;
    try {
      await holder.query('BEGIN');
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await holder.query('SELECT workspace_id FROM workspaces WHERE workspace_id=$1 FOR UPDATE', [space.workspaceId]);
      pending = h.launch(person.session, space.tenantId, plan);
      let waiting = false;
      for (let i = 0; i < 200; i++) {
        if ((await h.pool.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid])).rowCount) {waiting = true; break;}
        await delay(10);
      }
      assert.ok(waiting, 'launch reached the held workspace lock');
      if (change === 'left') await h.pool.query("UPDATE positioning_profession_memberships SET state='left' WHERE user_id=$1", [person.id]);
      else await h.fullMember(person.id, guild, 'intern');
      await holder.query('COMMIT');
      const result = await pending;
      if (allowed) {assert.ok([200,202].includes(result.status), JSON.stringify(result.data)); assert.equal(result.data.state, 'succeeded');}
      else {
        assert.equal(result.status, 403, JSON.stringify(result.data));
        assert.equal(result.data.code, guild === supplier ? 'guild_member_required' : 'commerce_guild_member_required');
        assert.equal(await h.count('application_installations', 'WHERE tenant_id=$1', [space.tenantId]), 0);
        assert.equal(await h.count('module_instances', 'WHERE tenant_id=$1', [space.tenantId]), 0);
      }
    } finally {await holder.query('ROLLBACK'); holder.release(); await pending?.catch(() => {});}
  });
}
