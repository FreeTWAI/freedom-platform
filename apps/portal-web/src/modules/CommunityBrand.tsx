import {communityLinks} from '../../../../modules/community-hub/index';
import {useLanguage} from '../language';

export function BrandPoster({ compact = false }: { compact?: boolean }) {
  return <div className={`brand-poster brand-poster-original${compact ? ' brand-poster-compact' : ''}`}><img src="/brand/freedom-workshop.webp" alt="自由工坊 — 自由創作，一起實現" width="1280" height="720" fetchPriority={compact ? 'auto' : 'high'}/></div>;
}

export {communityLinks};

export function CommunityLinks() {
  const {t}=useLanguage();
  return <footer className="community-footer"><div><strong>自由工坊</strong><p>{t('community.tagline')}</p></div><nav aria-label={t('community.links')} data-guide-anchor="community:links">{communityLinks.map(link => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{link.label} <span aria-hidden="true">↗</span></a>)}</nav></footer>;
}
