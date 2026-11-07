import { useMemo } from 'react';
import { escapeHtml } from '../../../../packages/shared/html.js';
import { submissionPageMarkup, SKILL_SUBMISSION_PREVIEW_CSS_PATH, type SubmissionPageSource } from '../../../../modules/skill-submissions/page-content.js';

/** Only the fixed same-site stylesheet loads; draft content remains in this sandboxed document. */
export function skillSubmissionPreviewDocument(source: SubmissionPageSource, origin: string) {
  const stylesheet = new URL(SKILL_SUBMISSION_PREVIEW_CSS_PATH, origin).href;
  return '<!doctype html><html lang="zh-Hant" class="skill-page"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src ' + escapeHtml(stylesheet) + '; img-src \'none\'; form-action \'none\'; base-uri \'none\'">'
    + '<title>' + escapeHtml(source.title) + ' · 私人介紹頁預覽</title><link rel="stylesheet" referrerpolicy="no-referrer" href="' + escapeHtml(stylesheet) + '"></head><body><main>'
    + submissionPageMarkup(source) + '</main></body></html>';
}

export function SkillSubmissionPagePreview({ source }: { source: SubmissionPageSource }) {
  const document = useMemo(() => skillSubmissionPreviewDocument(source, window.location.origin), [source.title, source.description, source.use_notes, source.page_content]);
  return <iframe className="skill-submission-page-preview" title={`私人介紹頁預覽：${source.title}`} sandbox="" referrerPolicy="no-referrer" srcDoc={document}
    style={{ width: '100%', height: 'min(75vh, 800px)', minHeight: 360, border: '1px solid var(--border)', borderRadius: 12 }}/>;
}
