import type { InstanceCapabilitiesInput, InviteRole, MemberView } from '../../../../contracts/guild-launchpad/v1/tenant';

// UI projection only. The existing server remains responsible for granting authority.
export type RoleChange = { member: MemberView; role: InviteRole; removed: InstanceCapabilitiesInput };

const WORK_PERMISSION_LABELS: Record<string, string> = {
  'work:read': '讀取', 'work:create': '建立', 'work:write': '編輯', 'work:archive': '封存', 'work:result.write': '上傳成果',
};

export function grantsForRole(member: MemberView, role: InviteRole): InstanceCapabilitiesInput {
  if (role === 'admin') return [];
  return member.instance_capabilities.map(grant => ({
    instance_id: grant.instance_id,
    capabilities: grant.capabilities.filter(key => role === 'operator' || key.endsWith(':read')),
  })).filter(grant => grant.capabilities.length > 0);
}

export function removedGrants(member: MemberView, next: InstanceCapabilitiesInput): InstanceCapabilitiesInput {
  return member.instance_capabilities.map(grant => ({
    instance_id: grant.instance_id,
    capabilities: grant.capabilities.filter(key => !next.some(entry => entry.instance_id === grant.instance_id && entry.capabilities.includes(key))),
  })).filter(grant => grant.capabilities.length > 0);
}

export function grantSummary(grants: MemberView['instance_capabilities']) {
  return grants.filter(grant => grant.capabilities.length > 0).map(grant => {
    const moduleName = grant.capabilities.some(key => key.startsWith('work:')) ? '人工工作 ' : '';
    return `${moduleName}…${grant.instance_id.slice(-6)}：${grant.capabilities.map(key => WORK_PERMISSION_LABELS[key] ?? key).join('、')}`;
  }).join('；');
}
