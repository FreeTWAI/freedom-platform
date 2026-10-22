import {escapeHtml as escape} from '../../packages/shared/html.js';
import {skillAccountHref} from '../../packages/shared/skill-acquisition.js';

/** Shared by catalog and currently published submissions; this adds no publication authority. */
export function publicSkillAcquisition(path: string, intro?: number | null) {
  const join = skillAccountHref(path, intro, true), login = skillAccountHref(path, intro, false);
  if (!join || !login) return '';
  return `<section id="join-workshop" class="public-skill-acquisition" aria-labelledby="skill-join-title" data-skill-acquisition>
<h2 id="skill-join-title">這本直接看，更多資源一起探索</h2>
<p>這本技能書的公開介紹與使用說明，不用註冊就能閱讀。喜歡這類資源，歡迎加入自由工坊。</p>
<ul><li>到技能書架探索更多免費公開資源。</li><li>選擇感興趣的公會，依加入資格領取指定技能書。</li><li>分享自己的作品，認識創作者與合作夥伴。</li></ul>
<div class="skill-acquisition-actions">
<a class="skill-acquisition-primary" data-skill-join href="${escape(join)}">免費加入，探索更多資源</a>
<a data-skill-login href="${escape(login)}">已有帳號，登入</a>
<a class="skill-acquisition-primary" data-skill-library href="/#skills" hidden>前往技能書架</a>
<a data-skill-guilds href="/#guilds" hidden>選擇公會與領取資源</a>
<a href="#skill-use-title">繼續閱讀這本技能書</a>
</div>
<p class="skill-acquisition-status" data-skill-account-status role="status" aria-live="polite"></p>
<p class="skill-acquisition-note">加入不會自動替你加星、加入公會或發布作品。外部工具、模型與服務的授權及費用，以原作者說明為準。</p>
</section>`;
}
export const skillAcquisitionCss = `.public-skill-acquisition{margin:28px 0;padding:22px;border:1px solid #535e77;border-radius:16px;background:#14161b}.public-skill-acquisition h2{margin-top:0;font-size:1.25rem}.public-skill-acquisition ul{padding-left:22px}.public-skill-acquisition li{margin:8px 0}.skill-acquisition-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.skill-acquisition-actions a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;box-sizing:border-box;padding:6px 16px;border:1px solid #535e77;border-radius:999px;text-decoration:none;line-height:1.6;font-size:.95rem}.skill-acquisition-actions a.skill-acquisition-primary{background:#c4ff20;color:#101500;border-color:#c4ff20}.skill-acquisition-actions [hidden]{display:none}.skill-acquisition-note,.skill-acquisition-status{font-size:.875rem;color:#aeb5c2}.skill-acquisition-status:empty{display:none}#skill-use-title,#join-workshop{scroll-margin-top:20px}@media(max-width:600px){.public-skill-acquisition{padding:16px}.skill-acquisition-actions .skill-acquisition-primary{width:100%}}`;
