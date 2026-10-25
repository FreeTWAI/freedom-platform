import {groupsByPlatform, pendingLinks, isSafeInviteUrl, COMMUNITY_WORK} from '../../../../modules/community-hub/index';
import {useLanguage} from '../language';
import './CommunityHub.css';

/** Static public content; internal destinations retain their existing access rules. */
export function CommunityHub() {
  const {t}=useLanguage();
  return <section className="module-panel community-hub stack">
    <p>{t('communityHub.intro')}</p>
    <section className="stack" aria-labelledby="community-hub-groups">
      <h2 id="community-hub-groups">{t('communityHub.groups')}</h2>
      <p className="field-hint">{t('communityHub.pendingCount',{count:pendingLinks()})}</p>
      <div className="community-hub-platforms">{groupsByPlatform().map(({platform,groups})=><section key={platform} className="card stack" aria-labelledby={`community-hub-${platform}`}>
        <h3 id={`community-hub-${platform}`}>{platform}</h3>
        <ul className="community-hub-list">{groups.map(group=><li key={group.id} data-group-id={group.id} data-link-status={group.status}>
          <strong>{group.id.startsWith('facebook-')?t('communityHub.unknownFacebook'):group.id==='discord-pending'?t('communityHub.unknownDiscord'):group.name}</strong>
          {group.url!==null&&isSafeInviteUrl(group.url)?<a className="btn btn-ghost btn-small community-hub-link" href={group.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{group.name} <span aria-hidden="true">↗</span><span className="community-hub-sr-only">{t('communityHub.newTab')}</span></a>:<span className="field-hint">{t('communityHub.pending')}</span>}
        </li>)}</ul>
      </section>)}</div>
    </section>
    <section className="stack" aria-labelledby="community-hub-work">
      <h2 id="community-hub-work">{t('communityHub.work')}</h2>
      <p className="field-hint">{t('communityHub.workIntro')}</p>
      <ul className="community-hub-work">{COMMUNITY_WORK.map(item=><li key={item.id} className="card stack">
        <a className="btn btn-ghost btn-small community-hub-link" href={`#${item.tab}`}>{t(`nav.${item.tab}`)}</a>
        <p>{t(item.descriptionKey)}</p>
      </li>)}</ul>
    </section>
  </section>;
}
