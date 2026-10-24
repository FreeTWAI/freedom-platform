import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { collectSnapshotEvidence } from '../../packages/db/snapshot-evidence.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !/^\/fp_[a-z0-9_]+$/.test(new URL(connectionString).pathname)) {
  throw new Error('Snapshot evidence RLS requires explicit disposable fp_* TEST_DATABASE_URL.');
}
const stamp = `${process.pid}_${Date.now()}`;
const schema = `e1ev_${stamp}`;
const otherSchema = `e1ev_other_${stamp}`;
const ownerRole = `e1eo_${stamp}`;
const readerRole = `e1er_${stamp}`;
const admin = new Pool({ connectionString });
function roleUrl(role: string) {
  const url = new URL(connectionString!);
  url.username = role;
  url.password = '';
  return url.toString();
}
const owner = new Pool({ connectionString: roleUrl(ownerRole), options: `-c search_path=${schema}`, max: 1 });
const writer = new Pool({ connectionString: roleUrl(ownerRole), options: `-c search_path=${schema}`, max: 1 });
const reader = new Pool({ connectionString: roleUrl(readerRole), options: `-c search_path=${schema}`, max: 1 });
let created = false;

async function snapshot(pool: Pool, tables = [{ schema, table: 'evidence_rows' }]) {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      return await collectSnapshotEvidence(client, tables);
    } finally {
      await client.query('ROLLBACK');
    }
  } finally {
    client.release();
  }
}

before(async () => {
  assert.ok(ownerRole.length < 63 && readerRole.length < 63);
  await admin.query(`CREATE ROLE ${ownerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
    CREATE ROLE ${readerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
    CREATE SCHEMA ${schema} AUTHORIZATION ${ownerRole};
    CREATE SCHEMA ${otherSchema} AUTHORIZATION ${ownerRole};
    GRANT USAGE ON SCHEMA ${schema} TO ${readerRole}`);
  created = true;
  await owner.query(`CREATE TABLE ${schema}.evidence_rows (id integer PRIMARY KEY)`);
  await owner.query(`INSERT INTO ${schema}.evidence_rows(id) VALUES (1),(2)`);
  await owner.query(`ALTER TABLE ${schema}.evidence_rows ENABLE ROW LEVEL SECURITY`);
  await owner.query(`CREATE POLICY evidence_rows_hide ON ${schema}.evidence_rows FOR SELECT TO PUBLIC USING (id = 1)`);
  await owner.query(`GRANT SELECT ON ${schema}.evidence_rows TO ${readerRole}`);
  await owner.query(`CREATE TABLE ${otherSchema}.evidence_rows (id bigint GENERATED ALWAYS AS IDENTITY, removed text, label text);
    ALTER TABLE ${otherSchema}.evidence_rows DROP COLUMN removed;
    INSERT INTO ${otherSchema}.evidence_rows(label) VALUES ('同名表'),(NULL);
    CREATE TABLE ${schema}."quoted""table" (value numeric(10,2));
    INSERT INTO ${schema}."quoted""table" VALUES (1.25),(NULL);
    CREATE TABLE ${schema}.empty_columns ();
    INSERT INTO ${schema}.empty_columns DEFAULT VALUES;
    CREATE VIEW ${schema}.evidence_view AS SELECT * FROM ${schema}.evidence_rows`);
});

after(async () => {
  await reader.end();
  await writer.end();
  await owner.end();
  try {
    if (created) await admin.query(`DROP SCHEMA ${schema},${otherSchema} CASCADE; DROP ROLE ${readerRole}; DROP ROLE ${ownerRole}`);
  } finally {
    await admin.end();
  }
});

test('T-024 snapshot evidence fails closed for a non-owner and returns every row for the owner', async () => {
  await assert.rejects(snapshot(reader), /^Error: snapshot_evidence_unavailable$/);
  const evidence = await snapshot(owner);
  assert.equal(evidence.tables.length, 1);
  assert.equal(evidence.tables[0].count, '2');
  assert.equal(evidence.tables[0].table, 'evidence_rows');
});

test('batched catalog preserves same-named tables, quoted names, physical column order and owned sequences', async () => {
  const tables = [{ schema: otherSchema, table: 'evidence_rows' }, { schema, table: 'quoted"table' },
    { schema, table: 'empty_columns' }, { schema, table: 'evidence_rows' }];
  const combined = await snapshot(owner, tables);
  const individual = (await Promise.all(tables.map(async table => (await snapshot(owner, [table])).tables[0])))
    .sort((a, b) => a.schema < b.schema ? -1 : a.schema > b.schema ? 1 : a.table < b.table ? -1 : 1);
  assert.deepEqual(combined.tables, individual);
  const sameName = combined.tables.find(t => t.schema === otherSchema)!;
  assert.deepEqual(sameName.columns, [{ name: 'id', type: 'bigint' }, { name: 'label', type: 'text' }]);
  assert.equal(sameName.count, '2');
  assert.deepEqual(sameName.sequences, [{ schema: otherSchema, name: 'evidence_rows_id_seq', lastValue: '2', isCalled: true }]);
  const empty = combined.tables.find(t => t.table === 'empty_columns')!;
  assert.deepEqual(empty.columns, []); assert.equal(empty.count, '1');
  assert.deepEqual((await snapshot(owner, [])).tables, []);
});

test('batched catalog rejects a missing table, a view and duplicate targets without partial evidence', async () => {
  for (const table of ['missing_table', 'evidence_view']) {
    await assert.rejects(snapshot(owner, [{ schema, table: 'evidence_rows' }, { schema, table }]), /^Error: snapshot_evidence_unavailable$/);
  }
  await assert.rejects(snapshot(owner, [{ schema, table: 'evidence_rows' }, { schema, table: 'evidence_rows' }]), /^Error: snapshot_evidence_unavailable$/);
});

test('snapshot catalog locks prevent definition changes while allowing writes outside the original snapshot', async () => {
  const client = await owner.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tables = [{ schema, table: 'evidence_rows' }];
    const before = await collectSnapshotEvidence(client, tables);
    await writer.query(`INSERT INTO ${schema}.evidence_rows VALUES (3)`);
    await writer.query("SET lock_timeout='100ms'");
    await assert.rejects(writer.query(`ALTER TABLE ${schema}.evidence_rows ADD COLUMN late text`), (error: any) => error.code === '55P03');
    assert.deepEqual(await collectSnapshotEvidence(client, tables), before);
  } finally {
    await client.query('ROLLBACK'); client.release();
    await writer.query('RESET lock_timeout');
    await writer.query(`DELETE FROM ${schema}.evidence_rows WHERE id=3`);
  }
});
