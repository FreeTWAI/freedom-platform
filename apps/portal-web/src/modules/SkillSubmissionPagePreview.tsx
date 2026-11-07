import { useMemo } from 'react';
import { escapeHtml } from '../../../../packages/shared/html.js';
import { skillPageCss } from '../../../../modules/development/skill-page.js';
import { submissionPageMarkup, type SubmissionPageSource } from '../../../../modules/skill-submissions/page-content.js';

/** No scripts, requests, custom markup or publication: this document exists only in this view. */
export function skillSubmissionPreviewDocument(source: SubmissionPageSource) {
  return '<!doctype html><html lang="zh-Hant" class="skill-page"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\'; form-action \'none\'; base-uri \'none\'">'
    + '<title>' + escapeHtml(source.title) + ' · 私人介紹頁預覽</title><style>' + skillPageCss + '</style></head><body><main>'
    + submissionPageMarkup(source) + '</main></body></html>';
}

export function SkillSubmissionPagePreview({ source }: { source: SubmissionPageSource }) {
  const document = useMemo(() => skillSubmissionPreviewDocument(source), [source.title, source.description, source.use_notes, source.page_content]);
  return <iframe className="skill-submission-page-preview" title={`私人介紹頁預覽：${source.title}`} sandbox="" srcDoc={document}
    style={{ width: '100%', height: 'min(75vh, 800px)', minHeight: 360, border: '1px solid var(--border)', borderRadius: 12 }}/>;
}
