import type { InviteRole, MemberView, TenantView } from '../../../../contracts/guild-launchpad/v1/tenant';
import { roleLabel } from './TenantSelector';
import { grantSummary, type RoleChange } from './tenant-member-grants';

type TenantMembersSectionProps = {
  members: MemberView[];
  tenant: TenantView;
  canManage: boolean;
  changingMember: string | null;
  roleChange: RoleChange | null;
  inviteChoices: readonly InviteRole[];
  updateRole: (member: MemberView, role: InviteRole) => void;
  changeMember: (member: MemberView, status: 'active' | 'revoked', role?: InviteRole) => Promise<void>;
  setRoleChange: (value: RoleChange | null) => void;
};

// Presentation only: state, command locks and every write remain in TenantSettings.
export function TenantMembersSection({ members, tenant, canManage, changingMember, roleChange, inviteChoices, updateRole, changeMember, setRoleChange }: TenantMembersSectionProps) {
  return <section className="stack" aria-label="成員">
        <h2>成員</h2>
        <ul className="stack tenant-rows">{members.map(member => <li key={member.principal_id} className="tenant-row">
          <p>{member.display_name}・{roleLabel(member.role)}・{member.status === 'active' ? '使用中' : '已撤銷'}</p>
          {grantSummary(member.instance_capabilities) && <p className="field-hint tenant-member-grants">{grantSummary(member.instance_capabilities)}</p>}
          {canManage && member.status === 'active' && member.role !== 'owner' && member.principal_id !== tenant.my_membership.principal_id && <div className="actions tenant-member-actions">
            <div className="field tenant-member-role">
              <label htmlFor={`tenant-member-role-${member.principal_id}`}>角色</label>
              <select id={`tenant-member-role-${member.principal_id}`} value={roleChange?.member.principal_id === member.principal_id ? roleChange.role : member.role} disabled={changingMember !== null} onChange={event => updateRole(member, event.target.value as InviteRole)}>
                {inviteChoices.map(role => <option key={role} value={role}>{roleLabel(role)}</option>)}
              </select>
            </div>
            <button type="button" className="btn btn-ghost" disabled={changingMember !== null} onClick={() => void changeMember(member, 'revoked')}>撤銷</button>
          </div>}
          {roleChange?.member.principal_id === member.principal_id && <section aria-label="確認角色變更" aria-live="polite">
            <p>改為{roleLabel(roleChange.role)}將移除以下實例權限：{grantSummary(roleChange.removed)}。</p>
            <div className="actions">
              <button type="button" className="btn btn-ghost" disabled={changingMember !== null} onClick={() => void changeMember(roleChange.member, 'active', roleChange.role)}>確認變更</button>
              <button type="button" className="btn btn-ghost" disabled={changingMember !== null} onClick={() => setRoleChange(null)}>取消</button>
            </div>
          </section>}
        </li>)}</ul>
      </section>;
}
