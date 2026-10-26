import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from '@typescript/typescript6';
import type { InstanceCapabilitiesInput, InviteRole, MemberView, TenantView } from '../../contracts/guild-launchpad/v1/tenant.js';
import { TenantMembersSection } from '../../apps/portal-web/src/modules/TenantMembersSection.js';
import { grantsForRole, removedGrants, grantSummary } from '../../apps/portal-web/src/modules/tenant-member-grants.js';

type Props = Parameters<typeof TenantMembersSection>[0];
type Element = ReactElement<Record<string, any>>;
const tenant: TenantView = {
  tenant_id: 'tenant-a', community_id: 'community-a', display_name: '合成業務空間', public_slug: null,
  status: 'active', version: '7', authorization_revision: '8', default_workspace_id: 'workspace-a',
  my_membership: { principal_id: 'manager', role: 'owner', version: '3' }, capabilities: [],
};
const grants: InstanceCapabilitiesInput = [
  { instance_id: 'instance-first-123456', capabilities: ['work:write', 'work:read', 'work:result.write'] },
  { instance_id: 'instance-second-654321', capabilities: ['notes:read', 'notes:write'] },
];
const member = (changes: Partial<MemberView> = {}): MemberView => ({
  principal_id: 'member-a', display_name: '合成成員', role: 'operator', status: 'active',
  instance_capabilities: structuredClone(grants), version: '9', ...changes,
});
function harness(changes: Partial<Props> = {}) {
  const updates: unknown[][] = [], writes: unknown[][] = [], confirmations: unknown[] = [];
  const props: Props = {
    members: [member()], tenant, canManage: true, changingMember: null, roleChange: null,
    inviteChoices: ['admin', 'operator', 'viewer'],
    updateRole: (...args) => { updates.push(args); },
    changeMember: async (...args) => { writes.push(args); },
    setRoleChange: value => { confirmations.push(value); }, ...changes,
  };
  return { props, updates, writes, confirmations, tree: () => TenantMembersSection(props) };
}
function elements(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap(child => isValidElement<Record<string, any>>(child)
    ? [child, ...elements(child.props.children)] : []);
}
function text(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<Record<string, any>>(child)
    ? text(child.props.children) : String(child)).join('');
}
function button(tree: ReactNode, label: string) {
  const found = elements(tree).find(node => node.type === 'button' && text(node.props.children) === label);
  assert.ok(found, `missing button: ${label}`);
  return found;
}

test('role projections keep current order, never restore removed keys and leave the input unchanged', () => {
  const value = member(), before = structuredClone(value);
  assert.deepEqual(grantsForRole(value, 'admin'), []);
  assert.deepEqual(grantsForRole(value, 'operator'), grants);
  const viewer = grantsForRole(value, 'viewer');
  assert.deepEqual(viewer, [
    { instance_id: grants[0].instance_id, capabilities: ['work:read'] },
    { instance_id: grants[1].instance_id, capabilities: ['notes:read'] },
  ]);
  assert.deepEqual(grantsForRole(member({ instance_capabilities: viewer }), 'operator'), viewer);
  assert.deepEqual(grantsForRole(member({ instance_capabilities: [{ instance_id: 'write-only', capabilities: ['notes:write'] }] }), 'viewer'), []);
  assert.deepEqual(value, before);
  assert.notEqual(viewer[0], value.instance_capabilities[0]);
  assert.notEqual(viewer[0].capabilities, value.instance_capabilities[0].capabilities);
});

test('removed grants compare the exact instance as well as the key and retain display order', () => {
  const value = member(), before = structuredClone(value);
  assert.deepEqual(removedGrants(value, grantsForRole(value, 'viewer')), [
    { instance_id: grants[0].instance_id, capabilities: ['work:write', 'work:result.write'] },
    { instance_id: grants[1].instance_id, capabilities: ['notes:write'] },
  ]);
  assert.deepEqual(removedGrants(value, [{ instance_id: 'other-instance', capabilities: [...grants[0].capabilities] }]), grants);
  assert.deepEqual(removedGrants(value, grants), []);
  assert.deepEqual(removedGrants(value, []), grants);
  assert.deepEqual(value, before);
});

test('grant summaries preserve the existing labels, suffixes, unknown-key fallback and empty state', () => {
  assert.equal(grantSummary(grants), '人工工作 …123456：編輯、讀取、上傳成果；…654321：notes:read、notes:write');
  assert.equal(grantSummary([]), '');
  assert.equal(grantSummary([{ instance_id: 'empty', capabilities: [] }]), '');
});

test('the rendered section preserves member order, role/status text and host-supplied choices', () => {
  const h = harness({ members: [member(), member({ principal_id: 'second', display_name: '第二位', role: 'viewer', status: 'revoked', instance_capabilities: [] })], inviteChoices: ['operator', 'viewer'] });
  const html = renderToStaticMarkup(createElement(TenantMembersSection, h.props));
  assert.match(html, /aria-label="成員"/);
  assert.match(html, /合成成員・操作者・使用中/);
  assert.match(html, /第二位・檢視者・已撤銷/);
  assert.ok(html.indexOf('合成成員') < html.indexOf('第二位'));
  const controls = elements(h.tree());
  assert.deepEqual(controls.filter(node => node.type === 'option').map(node => node.props.value), ['operator', 'viewer']);
  assert.equal(controls.filter(node => node.type === 'select').length, 1);
  assert.equal(controls.filter(node => node.props.className === 'field-hint tenant-member-grants').length, 1);
  assert.equal(controls.find(node => node.type === 'label')?.props.htmlFor, 'tenant-member-role-member-a');
});

test('management controls stay absent for non-managers, owners, self and revoked members', () => {
  for (const changes of [
    { canManage: false },
    { members: [member({ role: 'owner' })] },
    { members: [member({ principal_id: tenant.my_membership.principal_id })] },
    { members: [member({ status: 'revoked' })] },
  ] satisfies Partial<Props>[]) {
    const h = harness(changes);
    assert.equal(elements(h.tree()).filter(node => node.type === 'select' || node.type === 'button').length, 0);
    assert.deepEqual(h.updates, []); assert.deepEqual(h.writes, []);
  }
});

test('the host busy state disables role, revoke, confirm and cancel controls without creating leaf state', () => {
  const target = member();
  const h = harness({ changingMember: 'other-member', roleChange: { member: target, role: 'viewer', removed: removedGrants(target, grantsForRole(target, 'viewer')) } });
  const controls = elements(h.tree()).filter(node => node.type === 'select' || node.type === 'button');
  assert.equal(controls.length, 4);
  assert.ok(controls.every(node => node.props.disabled === true));
  h.props.changingMember = null;
  assert.ok(elements(h.tree()).filter(node => node.type === 'select' || node.type === 'button').every(node => node.props.disabled === false));
});

test('only the matching row displays the exact removed-grants confirmation and proposed role', () => {
  const target = member();
  const h = harness({ members: [target, member({ principal_id: 'second', display_name: '第二位' })], roleChange: { member: target, role: 'viewer', removed: removedGrants(target, grantsForRole(target, 'viewer')) } });
  const nodes = elements(h.tree()), confirmation = nodes.filter(node => node.props['aria-label'] === '確認角色變更');
  assert.equal(confirmation.length, 1);
  assert.equal(confirmation[0].props['aria-live'], 'polite');
  assert.equal(text(confirmation[0].props.children).includes('改為檢視者將移除以下實例權限：人工工作 …123456：編輯、上傳成果；…654321：notes:write。'), true);
  assert.deepEqual(nodes.filter(node => node.type === 'select').map(node => node.props.value), ['viewer', 'operator']);
});

test('actual leaf handlers forward the original member and role to host callbacks and do no work while rendering', async () => {
  const target = member(), snapshot = member({ version: '8' });
  const h = harness({ members: [target], roleChange: { member: snapshot, role: 'viewer', removed: grants } });
  const tree = h.tree();
  assert.deepEqual(h.updates, []); assert.deepEqual(h.writes, []); assert.deepEqual(h.confirmations, []);
  elements(tree).find(node => node.type === 'select')!.props.onChange({ target: { value: 'viewer' } });
  button(tree, '撤銷').props.onClick();
  button(tree, '確認變更').props.onClick();
  button(tree, '取消').props.onClick();
  await Promise.resolve();
  assert.equal(h.updates[0][0], target); assert.deepEqual(h.updates[0], [target, 'viewer']);
  assert.equal(h.writes[0][0], target); assert.deepEqual(h.writes[0], [target, 'revoked']);
  assert.equal(h.writes[1][0], snapshot); assert.deepEqual(h.writes[1], [snapshot, 'active', 'viewer']);
  assert.deepEqual(h.confirmations, [null]);
});

// Captured from the actual 3dd3850a59d2d3690feed88ba6878371a9bbf527 source before
// extraction. These guard the complete JSX and unchanged host, not browser/ACL behavior.
const baseline = {
  section: 'abefc02fc56adac74cca5abbb258abede6060b09c566050d19b618246e1178f8',
  host: '73412a715fe5a76c115ebd5bc49f2036562f090f30604174aa770d198937f7a1',
  helpers: {
    grantsForRole: '22b14fcb1881149d65618f94cdd28d714fbf1b54396bb7ede2ca4a64dfaa6b90',
    removedGrants: '49c94a55b37e2f72be9cd077238d2920043b386a4e7606141a6b19db93d179a7',
    grantSummary: '4df33bb6c837810f7715a83d4fa34fd0eb2939e85d5d5086384198f5d56a002a',
  },
};
const directory = new URL('../../apps/portal-web/src/modules/', import.meta.url);
const printer = ts.createPrinter({ removeComments: true });
async function source(name: string) {
  return ts.createSourceFile(name, await readFile(new URL(name, directory), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function fingerprint(node: ts.Node, file: ts.SourceFile) {
  return createHash('sha256').update(printer.printNode(ts.EmitHint.Unspecified, node, file).replace(/^export /, '')).digest('hex');
}
function declaration(file: ts.SourceFile, name: string) {
  const fn = file.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn?.body, name); return fn;
}

test('complete member markup and pure helper implementations match the pre-extraction baseline', async () => {
  const leaf = await source('TenantMembersSection.tsx'), fn = declaration(leaf, 'TenantMembersSection');
  const returned = fn.body!.statements.find(ts.isReturnStatement);
  assert.ok(returned?.expression);
  assert.equal(fingerprint(returned.expression, leaf), baseline.section);
  const helpers = await source('tenant-member-grants.ts');
  for (const [name, expected] of Object.entries(baseline.helpers)) assert.equal(fingerprint(declaration(helpers, name), helpers), expected, name);
});

test('host state, capability checks and async commands are unchanged outside the extracted member section', async () => {
  const host = await source('TenantSettings.tsx'), fn = declaration(host, 'TenantSettings');
  let count = 0;
  const result = ts.transform(fn, [context => function visit(node): ts.Node {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(host) === 'TenantMembersSection') {
      count++;
      return ts.factory.createJsxSelfClosingElement(ts.factory.createIdentifier('TenantMembersBoundary'), undefined, ts.factory.createJsxAttributes([]));
    }
    return ts.visitEachChild(node, visit, context);
  }]);
  try { assert.equal(count, 1); assert.equal(fingerprint(result.transformed[0], host), baseline.host); }
  finally { result.dispose(); }
});

test('host forwards every leaf prop unchanged and the leaf has no client, state or reverse-host import', async () => {
  const leaf = await source('TenantMembersSection.tsx'), host = await source('TenantSettings.tsx');
  const fn = declaration(leaf, 'TenantMembersSection'), binding = fn.parameters[0].name;
  assert.ok(ts.isObjectBindingPattern(binding));
  const inputs = binding.elements.map(item => item.name.getText(leaf)).sort();
  const calls: ts.JsxSelfClosingElement[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(host) === 'TenantMembersSection') calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(host); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].attributes.properties.map(attribute => {
    assert.ok(ts.isJsxAttribute(attribute));
    assert.ok(attribute.initializer && ts.isJsxExpression(attribute.initializer));
    assert.equal(attribute.initializer.expression?.getText(host), attribute.name.getText(host));
    return attribute.name.getText(host);
  }).sort(), inputs);
  assert.equal(fn.body!.statements.length, 1, 'leaf body only returns the existing markup');
  const runtimeImports = leaf.statements.filter(ts.isImportDeclaration).filter(node => !node.importClause?.isTypeOnly)
    .map(node => (node.moduleSpecifier as ts.StringLiteral).text);
  assert.deepEqual(runtimeImports, ['./TenantSelector', './tenant-member-grants']);
  const helpers = await source('tenant-member-grants.ts');
  assert.ok(helpers.statements.filter(ts.isImportDeclaration).every(node => node.importClause?.isTypeOnly));
});
