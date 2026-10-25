import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import ts from '@typescript/typescript6';

// Structural snapshots captured from 51dfe03c1 before extraction. The complete JSX
// includes every branch, attribute, text node and callback, even when hidden.
const baseline: Readonly<Record<string, string>> = {
  "store-products-panel": "a2608a7b7c2b1e66efd8d72a543e59ddd743857842e1a0cec123bda47e72b4b7",
  "store-cooperation-panel": "5b33264a138207bbe8f732d2c710798ca1bcb922881f01e2d2a1c685e86cf3a9",
  "store-publish-panel": "8ae3e80b6f7f187ccc4372a3efe4b6b3ce27c4513bcf1c0e53df3a517842be47",
  "store-settings-panel": "3cddf7ab800006413f4ff6c1dccc6f5256c46aff98bf861f459b8f69f797668d",
  "PublicationReview": "a8dcbae6aeed7bc722a2a25a5d841c24a7d4389d158a674085c83aa75d31b988",
  "ManualCopy": "76cdc0866f74582d365de26024391e0d4a6738328c1b85237c8cc8eb1453888a",
  "SettingsForm": "c5f3aa3014667d6fbdec7a1871a9d615c9b3fe99317b98123fba1ff4954c5b1f",
  "ProductForm": "0ca3c42deeeddd87050250764979bb25cb3e13481e05fd363ea5e8d9fbdf425e"
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
  test(`HostedStore${area}Area preserves the complete baseline panel markup and conditions`, async () => {
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
test('StorePage passes every area input through unchanged and areas have no import cycle', async () => {
  const page = await source('HostedStore.tsx');
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
      assert.equal(attribute.initializer.expression?.getText(page), attribute.name.getText(page));
      return attribute.name.getText(page);
    }).sort(), inputs);
    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement)) assert.doesNotMatch(statement.moduleSpecifier.getText(file), /['"]\.\/HostedStore['"]/);
    }
    assert.equal(fn.body!.statements.filter(ts.isVariableStatement).length, 0, 'area must not own state');
  }
});
