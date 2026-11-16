import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import ts from '@typescript/typescript6';

// Extraction snapshots started at 51dfe03c1; PR #1219 updated copy/read locks,
// and pass 8 (publish bar) intentionally updated Products, Publish, Settings,
// SettingsForm, and ProductForm (moving publish/next-step/copy out to
// HostedStorePublishBar, moving 停止公開 / 網址已固定。 to Settings, and
// removing republish clauses). Complete JSX includes every branch, attribute,
// text node and callback, even when hidden.
const baseline: Readonly<Record<string, string>> = {
  "store-products-panel": "9833d43d7fd8973cc32128c06dbe81f03696f8cc6471692be5224df212698a99",
  "store-cooperation-panel": "5b33264a138207bbe8f732d2c710798ca1bcb922881f01e2d2a1c685e86cf3a9",
  "store-publish-panel": "05c48eb9a85f8302025ae9010265686186ffbe50b09d6229eb281a2bbfd4edf5",
  "store-settings-panel": "790e3d31d5feee404258bd332fa5cba9b9ad4df50a69964ee1bb326e522c4d8a",
  "PublicationReview": "a8dcbae6aeed7bc722a2a25a5d841c24a7d4389d158a674085c83aa75d31b988",
  "ManualCopy": "76cdc0866f74582d365de26024391e0d4a6738328c1b85237c8cc8eb1453888a",
  "SettingsForm": "02c06f054ab66862d405c8ee2e98369ae1926bae1ad407a602194b57c55491d0",
  "ProductForm": "946c0db61aaed016b42ee23b738eb9a8c2621540a4bd9e54eacba93b89f0a1c0"
};
const directory = new URL('../../apps/portal-web/src/modules/', import.meta.url);
const printer = ts.createPrinter();
async function source(name: string) {
  return ts.createSourceFile(name, await readFile(new URL(name, directory), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function fingerprint(node: ts.Node, file: ts.SourceFile) {
  return createHash('sha256').update(printer.printNode(ts.EmitHint.Unspecified, node, file)).digest('hex');
}
function returned(file: ts.SourceFile, name: string) {
  const fn = file.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn?.body, name);
  const result = fn.body.statements.find(ts.isReturnStatement);
  assert.ok(result?.expression, name);
  return result.expression;
}
for (const area of ['Products', 'Cooperation', 'Publish', 'Settings'] as const) {
  test(`HostedStore${area}Area matches the reviewed complete panel markup and conditions`, async () => {
    const file = await source(`HostedStore${area}Area.tsx`);
    const panel = returned(file, `HostedStore${area}Area`);
    assert.equal(fingerprint(panel, file), baseline[`store-${area.toLowerCase()}-panel`]);
  });
}
for (const [name, module] of [['PublicationReview', 'hosted-store-area-shared.tsx'], ['ManualCopy', 'hosted-store-area-shared.tsx'], ['SettingsForm', 'HostedStoreSettingsArea.tsx'], ['ProductForm', 'HostedStoreProductsArea.tsx']] as const) {
  test(`${name} preserves its baseline markup`, async () => {
    const file = await source(module);
    assert.equal(fingerprint(returned(file, name), file), baseline[name]);
  });
}
test('StorePage preserves area inputs with explicit read-failure locks and no import cycle', async () => {
  const page = await source('HostedStore.tsx');
  const declarations: ts.VariableDeclaration[] = [];
  function collect(node: ts.Node) {
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    ts.forEachChild(node, collect);
  }
  collect(page);
  for (const [name, expression] of [
    ['readBlocked', 'loading || readFailed'],
    ['locked', 'busy || retry !== null || photoBlocking || loading || readFailed'],
  ]) {
    const matches = declarations.filter(node => node.name.getText(page) === name);
    assert.equal(matches.length, 1, name);
    assert.equal(matches[0].initializer?.getText(page), expression);
  }
  for (const area of ['Products', 'Cooperation', 'Publish', 'Settings']) {
    const name = `HostedStore${area}Area`;
    const file = await source(`${name}.tsx`);
    const fn = file.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(fn);
    const parameter = fn.parameters[0].name;
    assert.ok(ts.isObjectBindingPattern(parameter));
    const inputs = parameter.elements.map(item => item.name.getText(file)).sort();
    const calls: ts.JsxSelfClosingElement[] = [];
    function visit(node: ts.Node) {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(page) === name) calls.push(node);
      ts.forEachChild(node, visit);
    }
    visit(page);
    assert.equal(calls.length, 1, name);
    const attributes = calls[0].attributes.properties;
    assert.deepEqual(attributes.map(attribute => {
      assert.ok(ts.isJsxAttribute(attribute));
      assert.ok(attribute.initializer && ts.isJsxExpression(attribute.initializer));
      const prop = attribute.name.getText(page);
      const expected = prop === 'loading' && ['Products', 'Publish', 'Settings'].includes(area) ? 'readBlocked' : prop;
      assert.equal(attribute.initializer.expression?.getText(page), expected);
      return attribute.name.getText(page);
    }).sort(), inputs);
    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement)) assert.doesNotMatch(statement.moduleSpecifier.getText(file), /['"]\.\/HostedStore['"]/);
    }
    assert.equal(fn.body!.statements.filter(ts.isVariableStatement).length, 0, 'area must not own state');
  }
});
