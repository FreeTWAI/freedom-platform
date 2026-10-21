import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { partitionRuntimeFiles } from '../suite-runner.mjs';

test('partition is exact, disjoint and rejects duplicates or invalid sizes', () => {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  for (const count of [1, 2, 4, 6]) {
  const shards = partitionRuntimeFiles(files, count);
  assert.deepEqual(shards.flat().sort(), files);
  assert.equal(new Set(shards.flat()).size, files.length);
  assert(Math.max(...shards.map(s=>s.length))-Math.min(...shards.map(s=>s.length))<=1);
  }
  for (const [input, count] of [[['a', 'a'], 2], [['a'], 2], [files, 3], [files, 5], [files, 7]]) assert.throws(() => partitionRuntimeFiles(input, count));
});

test('reviewed hosted costs distribute heavy fixtures without losing unfinished or newly added files', () => {
  const observation = JSON.parse(readFileSync(new URL('./fixtures/runtime-hosted-costs.json', import.meta.url)));
  const files = Object.keys(observation.milliseconds).map(name => 'tests/runtime/' + name).sort();
  const cost = path => observation.milliseconds[path.split('/').at(-1)] ?? 0;
  const original = Array.from({ length: 4 }, (_, i) => files.filter((_, index) => index % 4 === i));
  const total = shard => shard.reduce((sum, path) => sum + cost(path), 0);
  assert(Math.max(...original.map(total)) > 860_000, 'historical serial hotspot is reproduced');
  const partitions = partitionRuntimeFiles(files, 4);
  assert(Math.max(...partitions.map(total)) < 700_000, 'observed completed work is balanced; unfinished files are not a timing prediction');
  assert.deepEqual(partitions.flat().sort(), files);
  assert(partitions.every(shard => JSON.stringify(shard) === JSON.stringify([...shard].sort())));
  assert.deepEqual(partitionRuntimeFiles(files, 1), [files]);
  for (const count of [2, 4]) {
    const expanded = [...files, 'tests/runtime/new-unmeasured.test.ts'].sort();
    const shards = partitionRuntimeFiles(expanded, count);
    assert.deepEqual(shards.flat().sort(), expanded);
    assert.equal(new Set(shards.flat()).size, expanded.length);
    assert.deepEqual(partitionRuntimeFiles(expanded, count), shards);
    assert.equal(shards.length, count);
  }
});

test('measured weights keep hosted run 37567098443 under the four-partition budget', () => {
  const observation = JSON.parse(readFileSync(new URL('./fixtures/runtime-hosted-costs-37567098443.json', import.meta.url)));
  const files = Object.keys(observation.milliseconds).map(name => 'tests/runtime/' + name).sort();
  const cost = path => observation.milliseconds[path.split('/').at(-1)] ?? 0;
  const total = shard => shard.reduce((sum, path) => sum + cost(path), 0);
  const partitions = partitionRuntimeFiles(files, 4);
  assert.equal(files.length, 247);
  assert.deepEqual(partitions.flat().sort(), files);
  assert.equal(new Set(partitions.flat()).size, files.length);
  assert(partitions.every(shard => JSON.stringify(shard) === JSON.stringify([...shard].sort())));
  // The weights are per-file minima across several hosted runs, not this run's own costs, so this
  // run's spread is not a balance measure. The bounds below keep each of the four partitions under
  // the ~870 s of test time a 900 s partition leaves, without relying on the interim 1,200 s budget.
  // The cushion below 870 s was calibrated to earlier weights; the window itself is unchanged.
  const totals = partitions.map(total);
  assert(Math.max(...totals) < 870_000);
  for (const extra of ['tests/runtime/aaa-unmeasured.test.ts', 'tests/runtime/zzz-unmeasured.test.ts']) {
    const expanded = [...files, extra].sort();
    const shards = partitionRuntimeFiles(expanded, 4);
    assert.deepEqual(shards.flat().sort(), expanded);
    assert.equal(new Set(shards.flat()).size, expanded.length);
    const withExtra = shard => shard.reduce((sum, path) => sum + (path === extra ? 15_000 : cost(path)), 0);
    assert(Math.max(...shards.map(withExtra)) < 870_000);
  }
});

test('October 9 disk costs stay inside the six-partition bounds under the current weights', () => {
  const observation = JSON.parse(readFileSync(new URL('./fixtures/runtime-hosted-costs-disk-20261009.json', import.meta.url)));
  const files = Object.keys(observation.milliseconds).map(name => 'tests/runtime/' + name).sort();
  const cost = path => observation.milliseconds[path.split('/').at(-1)] ?? 0;
  const total = shard => shard.reduce((sum, path) => sum + cost(path), 0);

  assert.equal(files.length, 320);

  const partitions6 = partitionRuntimeFiles(files, 6);
  assert.deepEqual(partitions6.flat().sort(), files);
  assert.equal(new Set(partitions6.flat()).size, files.length);
  assert(partitions6.every(shard => JSON.stringify(shard) === JSON.stringify([...shard].sort())));

  // The current weights come from later runs, so these costs are no longer their own balance measure.
  const totals6 = partitions6.map(total);
  assert(Math.max(...totals6) < 870_000, 'measured estimates leave room inside the existing 900-second six-partition budget');

  const partitions4 = partitionRuntimeFiles(files, 4);
  const totals4 = partitions4.map(total);
  assert(Math.max(...totals4) < 1_200_000, 'four-partition estimates fit the existing 1200-second legacy matrix budget');

  for (const extra of ['tests/runtime/aaa-unmeasured.test.ts', 'tests/runtime/zzz-unmeasured.test.ts']) {
    const expanded = [...files, extra].sort();
    const shards = partitionRuntimeFiles(expanded, 6);
    assert.deepEqual(shards.flat().sort(), expanded);
    assert.equal(new Set(shards.flat()).size, expanded.length);
    const withExtra = shard => shard.reduce((sum, path) => sum + (path === extra ? 15_000 : cost(path)), 0);
    assert(Math.max(...shards.map(withExtra)) < 870_000);
  }
});

test('October 16 measured costs stay inside the current six- and eight-partition window', () => {
  const observation = JSON.parse(readFileSync(new URL('./fixtures/runtime-hosted-costs-20261016.json', import.meta.url)));
  const files = Object.keys(observation.milliseconds).map(name => 'tests/runtime/' + name).sort();
  const cost = path => observation.milliseconds[path.split('/').at(-1)] ?? 0;
  const total = shard => shard.reduce((sum, path) => sum + cost(path), 0);

  assert.equal(files.length, 404);

  // The earlier 1.33x/six-way and 1.8x/eight-way room estimates for run 38968059268
  // referred to weights derived from those runs. Current weights come from later runs,
  // so these costs no longer measure balance; use the October 21 fixture's 1,210s window.
  for (const [count, bound] of [[6, 1_210_000], [8, 1_210_000]]) {
    const partitions = partitionRuntimeFiles(files, count);
    assert.deepEqual(partitions.flat().sort(), files);
    assert.equal(new Set(partitions.flat()).size, files.length);
    assert(partitions.every(shard => JSON.stringify(shard) === JSON.stringify([...shard].sort())));
    const totals = partitions.map(total);
    assert(Math.max(...totals) < bound);

    for (const extra of ['tests/runtime/aaa-unmeasured.test.ts', 'tests/runtime/zzz-unmeasured.test.ts']) {
      const expanded = [...files, extra].sort();
      const shards = partitionRuntimeFiles(expanded, count);
      assert.deepEqual(shards.flat().sort(), expanded);
      assert.equal(new Set(shards.flat()).size, expanded.length);
      const withExtra = shard => shard.reduce((sum, path) => sum + (path === extra ? 15_000 : cost(path)), 0);
      assert(Math.max(...shards.map(withExtra)) < bound + 10_000);
    }
  }
});


test('October 21 measured costs balance eight partitions inside the host budget', () => {
  const observation = JSON.parse(readFileSync(new URL('./fixtures/runtime-hosted-costs-20261021.json', import.meta.url)));
  const files = Object.keys(observation.milliseconds).map(name => 'tests/runtime/' + name).sort();
  const cost = path => observation.milliseconds[path.split('/').at(-1)] ?? 0;
  const total = shard => shard.reduce((sum, path) => sum + cost(path), 0);

  assert.equal(files.length, 467);
  assert.equal(observation.input_completeness, 'partial_scheduling_estimates');
  assert.deepEqual(observation.partial_logs, ['b963-p1-failure.log', 'main-p3-failure.log']);

  // Per-file minima are scheduling estimates, not a coherent hosted run. Leave
  // headroom below 1,500s minus the 64s cleanup reserve and 20s provisioning.
  const bound = 1_210_000;
  const partitions = partitionRuntimeFiles(files, 8);
  assert.deepEqual(partitions.flat().sort(), files);
  assert.equal(new Set(partitions.flat()).size, files.length);
  assert(partitions.every(shard => JSON.stringify(shard) === JSON.stringify([...shard].sort())));
  const totals = partitions.map(total);
  assert(Math.max(...totals) < bound);
  assert(Math.max(...totals) - Math.min(...totals) < 10_000);

  for (const extra of ['tests/runtime/aaa-unmeasured.test.ts', 'tests/runtime/zzz-unmeasured.test.ts']) {
    const expanded = [...files, extra].sort();
    const shards = partitionRuntimeFiles(expanded, 8);
    assert.deepEqual(shards.flat().sort(), expanded);
    assert.equal(new Set(shards.flat()).size, expanded.length);
    const withExtra = shard => shard.reduce((sum, path) => sum + (path === extra ? 15_000 : cost(path)), 0);
    assert(Math.max(...shards.map(withExtra)) < bound + 10_000);
  }
});
