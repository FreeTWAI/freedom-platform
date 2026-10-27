import type {ReactNode} from 'react';
import type {VisitorProfileData} from '../../../../packages/shared/member-profile';

/** One renderer for local draft preview and server-authorized visitor data. */
export function ProfileDesign({profile,coverUrl,recognition}:{profile:VisitorProfileData;coverUrl?:string|null;recognition?:ReactNode}){
 const layout=profile.layout;
 const blocks={
  about:layout.about?<section className="profile-design-block"><h3>關於我</h3><p className="profile-about">{layout.about}</p></section>:null,
  featured:layout.featured.length?<section className="profile-design-block"><h3>精選作品</h3><p className="profile-design-hint">本人挑選的外部作品連結</p><div className="profile-featured-grid">{layout.featured.map((work,index)=><a className="profile-featured-card" key={index} href={work.url} target="_blank" rel="noopener noreferrer"><h4>{work.title}<span aria-hidden="true"> ↗</span></h4>{work.description&&<p>{work.description}</p>}</a>)}</div></section>:null,
  links:profile.links.length?<section className="profile-design-block"><h3>我的連結</h3><ul className="profile-links">{profile.links.map((link,index)=><li key={index}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}<span aria-hidden="true"> ↗</span></a></li>)}</ul></section>:null,
  recognition:recognition?<section className="profile-design-block"><h3>稱號與社群認證</h3>{recognition}</section>:null,
 };
 return <div className="profile-design" data-profile-theme={layout.theme} data-profile-accent={layout.accent}>
  <div className="profile-design-cover" data-profile-cover={layout.cover_style}>{coverUrl?<img src={coverUrl} alt={layout.cover_alt} width="1600" height="600" decoding="async"/>:<span aria-hidden="true" className="profile-cover-pattern"/>}</div>
  <header className="profile-design-intro"><span className="profile-design-monogram" aria-hidden="true">{Array.from(profile.display_name)[0]??'・'}</span><div><h2 className="profile-name">{profile.display_name}</h2>{profile.bio&&<p className="profile-bio">{profile.bio}</p>}</div></header>
  <div className="profile-design-body">{layout.blocks.filter(block=>block.visible).map(block=><div key={block.id} data-profile-block={block.id}>{blocks[block.id]}</div>)}</div>
 </div>;
}
