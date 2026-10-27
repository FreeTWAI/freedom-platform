import type {CertificationBadge} from '../../../../packages/shared/community-certification';
import './CommunityCertificationBadge.css';
export function CommunityCertificationBadge({badge}:{badge:CertificationBadge}){
 return <span className="community-certification-badge"><span aria-hidden="true" className="community-certification-check">✓</span><span>{badge.label}</span><span className="community-certification-description">{badge.description}</span></span>;
}
