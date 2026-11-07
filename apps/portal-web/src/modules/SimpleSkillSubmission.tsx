import { validSkillPageDraft, type SkillPageDraft } from '../../../../modules/skill-submissions/page-draft.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { requireItems, type PortalClient } from '../api';
import { useModuleMutation } from './shared';
import { relationshipLabels } from './SkillUpload';
import './WorkSharing.css';
import { authoringDraftState, sharingMutationState, useAuthoringDraft } from './authoring-drafts';
import { PublishedSkillLinks, skillPublicationPath } from './SkillPublication';
import { validSkillPageContent, type SkillPageContent } from '../../../../modules/community/skill-page-content.js';
import { blankSkillPageFields, manualSkillPageContent, skillPageFields, SkillSubmissionPageFields, type ManualSkillPageFields } from './SkillSubmissionPageFields';
import { SkillSubmissionPagePreview } from './SkillSubmissionPagePreview';

type Relationship = keyof typeof relationshipLabels;
type Draft = { repository_url: string; title: string; description: string; use_notes: string; demo_url: string; relationship: Relationship; page?: ManualSkillPageFields };
type SubmissionPayload = Omit<Draft, 'demo_url' | 'page'> & { demo_url: string | null; page_content?: SkillPageContent; page_content_draft?: SkillPageDraft };
type Submission = { project_id?: string|null; submission_id: string; status: string; can_edit?: boolean; aggregate_version: number | string; public_path: string | null; seed?: unknown; payload: SubmissionPayload | null };
const blank: Draft = { repository_url: '', title: '', description: '', use_notes: '', demo_url: '', relationship: 'curator', page: blankSkillPageFields() };
const defaultNotes = '請先閱讀原作 README，依其中的安裝步驟開始使用；使用條件與授權以原作文件為準。';
function fromPayload(payload: SubmissionPayload): Draft {
  return { repository_url: payload.repository_url, title: payload.title, description: payload.description, use_notes: payload.use_notes,
    demo_url: payload.demo_url ?? '', relationship: payload.relationship,
    ...(validSkillPageContent(payload.page_content) ? { page: skillPageFields(payload.page_content) } : validSkillPageDraft(payload.page_content_draft) ? { page: payload.page_content_draft } : {}),
  };
}
function comparable(value: unknown): string {
  const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, field]) => [key, ordered(field)])) : item;
  return JSON.stringify(ordered(value));
}

// Opt into the existing mutation attempt history: a later 429 must not erase
// an earlier ambiguous save or rotate its idempotency key before reconciliation.
function manualSubmission(value: unknown): Submission {
  const item = value as Submission | null;
  if (!item || typeof item.submission_id !== 'string' || !item.submission_id || item.status !== 'ready_for_review'
    || item.can_edit !== true || item.public_path !== null || !['number', 'string'].includes(typeof item.aggregate_version)
    || !Number.isSafeInteger(Number(item.aggregate_version)) || Number(item.aggregate_version) < 1
    || !item.payload || !['repository_url', 'title', 'description', 'use_notes'].every(key => typeof item.payload?.[key as keyof SubmissionPayload] === 'string')
    || (item.payload.page_content_draft !== undefined && !validSkillPageDraft(item.payload.page_content_draft))
    || (item.payload.page_content !== undefined && !validSkillPageContent(item.payload.page_content))
    || !Object.hasOwn(relationshipLabels, item.payload.relationship) || !(item.payload.demo_url === null || typeof item.payload.demo_url === 'string')) {
    throw Error('私人草稿回應格式不符。');
  }
  return item;
}

// Required text feedback only; repository URL policy, source and licensing
// are checked by the API so valid URL syntax can reach its authoritative errors.
function validateField(field: HTMLInputElement | HTMLTextAreaElement) {
  const value = field.value.trim();
  const message = field.required && !value ? '請填寫這個欄位，不能只有空白。' : '';
  field.setCustomValidity(message);
}

export function SimpleSkillSubmission({ client, userId, resumeId = null, withdrawnProjectIds = [], onPublished, onOpenDraft }: { client: PortalClient; userId: string; resumeId?: string | null; withdrawnProjectIds?:string[]; onPublished: () => Promise<void>; onOpenDraft?: (id: string, mode: 'preview' | 'complete') => void }) {
  const [draft, setDraft, current] = useAuthoringDraft<Draft>(userId, 'skill:draft', { ...blank });
  const [review, setReview] = useAuthoringDraft(userId, 'skill:review', false), [consent, setConsent] = useAuthoringDraft(userId, 'skill:consent', false);
  const [saved, setSaved] = useAuthoringDraft<Submission | null>(userId, 'skill:saved', null), [published, setPublished] = useAuthoringDraft<Submission | null>(userId, 'skill:published', null);
  const [publishAttempted, setPublishAttempted] = useAuthoringDraft(userId, 'skill:publish-attempted', false);
  const [saving, setSaving] = useAuthoringDraft(userId, 'skill:saving', false);
  const [saveUnknown, setSaveUnknown] = useAuthoringDraft(userId, 'skill:save-unknown', false);
  const [lastCommand, setLastCommand] = useAuthoringDraft<'save' | 'publish' | null>(userId, 'skill:last-command', null);
  useEffect(()=>{if(published?.project_id&&withdrawnProjectIds.includes(published.project_id)){setPublished(null);setCopied('');}},[published?.project_id,withdrawnProjectIds.join(',')]);
  const [ready, setReady] = useState<Submission[]>([]), [loadError, setLoadError] = useState('');
  const [copied, setCopied] = useState('');
  const { mutate, busy, error, setError, lastFailureUnknown } = useModuleMutation(client, { userId, type: 'skill' });
  const upgrade = useModuleMutation(client, { userId, type: 'skill:upgrade' });
  const lock = useRef(false), [working, setWorking] = useAuthoringDraft(userId, 'skill:working', false);
  const previewHeading = useRef<HTMLHeadingElement>(null), success = useRef<HTMLElement>(null);
  const [resumedId, setResumedId] = useState<string | null>(null), [resumeRetry, setResumeRetry] = useState(0);
  const [resumedAdvanced,setResumedAdvanced] = useState(false);
  const requestedResume = useRef(resumeId); requestedResume.current = resumeId;
  const pending = busy || working || upgrade.busy;
  const publishUnknown = lastCommand === 'publish' && lastFailureUnknown;
  useEffect(() => {
    if (!resumeId) { setResumedId(null); return; }
    // Navigation may arrive while a previous mount is still saving/publishing.
    // Resume only after it settles; an already consumed URL must not reload on
    // that draft's own later publish/revoke transitions.
    if (resumedId === resumeId || pending || saveUnknown || publishUnknown || lock.current) return;
    const writing = authoringDraftState(userId, 'skill:working', false);
    const submission = sharingMutationState({ userId, type: 'skill' });
    const upgrading = sharingMutationState({ userId, type: 'skill:upgrade' });
    const controller = new AbortController(), generation = client.sessionGeneration;
    // Read the existing stores here, rather than a render-time busy snapshot,
    // so a late response cannot replace the draft between mutation and render.
    const live = () => !controller.signal.aborted && requestedResume.current === resumeId && generation === client.sessionGeneration && current()
      && !lock.current && !writing.read() && !submission.snapshot.busy && !upgrading.snapshot.busy;
    if (!live()) return;
    setLoadError('');
    void client.get<Submission>(`/me/skill-submissions/${encodeURIComponent(resumeId)}`, { signal: controller.signal })
      .then(item => {
        if (!live()) return;
        if (item.submission_id !== resumeId) throw new Error('私人投稿回應不符，請重新載入。');
        if (item.seed || !item.payload || item.status !== 'ready_for_review') { setResumedAdvanced(true); onOpenDraft?.(item.submission_id, item.status === 'ready_for_review' ? 'preview' : 'complete'); }
        else {
          const payload = item.payload;
          setResumedAdvanced(false);
          setDraft(fromPayload(payload));
          // Resumed drafts retain the existing retry label; consent is always renewed.
          setSaved(item); setPublished(null); setPublishAttempted(true); setConsent(false); setReview(!payload.page_content_draft); setError(null);
        }
        setResumedId(resumeId);
      }).catch(cause => { if (live()) setLoadError(cause instanceof Error ? cause.message : '私人投稿暫時無法載入。'); });
    return () => controller.abort();
  }, [client, userId, resumeId, resumeRetry, resumedId, pending, saveUnknown, publishUnknown]);
  async function loadDrafts() {
    setLoadError('');
    try { const items = requireItems<Submission>(await client.get('/me/skill-submissions'), '投稿草稿'); if (current()) setReady(items.filter(item => item.status === 'ready_for_review' && item.payload && !item.seed)); }
    catch { if (current()) setLoadError('私人草稿暫時無法載入。'); }
  }
  useEffect(() => { setReady([]); void loadDrafts(); }, [client, userId]);
  useEffect(() => { if (review) previewHeading.current?.focus(); }, [review]);
  useEffect(() => { if (published) success.current?.focus(); }, [published]);
  function preview(event: FormEvent) {
    event.preventDefault(); if (pending || saveUnknown || publishUnknown || !current() || !validPageDraft()) return; setPublished(null); setError(null); setConsent(false); setReview(true);
  }
  function validPageDraft() {
    if (!draft.page || (draft.use_notes.trim() && validSkillPageContent(manualSkillPageContent(draft.page)))) return true;
    setError('請依欄位提示補齊效益主標、問題、原理、三個不同成果、三個完整步驟與起步方法；請用純文字，不填網址。');
    return false;
  }
  function resume(item: Submission) {
    if (!item.payload || pending || saveUnknown || publishUnknown || !current()) return;
    const payload = item.payload;
    setDraft(fromPayload(payload));
    setSaved(item); setPublished(null); setPublishAttempted(true); setError(null); setConsent(false); setReview(!payload.page_content_draft);
  }
  function draftBody() {
    return {
      repository_url: draft.repository_url.trim(), relationship: draft.relationship, title: draft.title.trim(), description: draft.description.trim(),
      use_notes: draft.use_notes.trim() || (draft.page ? '' : defaultNotes), demo_url: draft.demo_url.trim() || null,
      ...(draft.page ? validSkillPageContent(manualSkillPageContent(draft.page)) && draft.use_notes.trim()
        ? { page_content: manualSkillPageContent(draft.page) } : { page_content_draft: draft.page } : {}),
    };
  }
  const dirty = !saved?.payload || Object.entries(draftBody()).some(([key, value]) => comparable(saved.payload?.[key as keyof SubmissionPayload]) !== comparable(value));
  async function persistDraft() {
    const body = draftBody();
    if (saved && (!saved.can_edit || !dirty)) return saved;
    setLastCommand('save');
    return saved ? mutate<Submission>(`/me/skill-submissions/${saved.submission_id}/manual`, body, Number(saved.aggregate_version), manualSubmission)
      : mutate<Submission>('/me/skill-submissions/manual', body, undefined, manualSubmission);
  }
  async function saveDraft() {
    if (lock.current || pending || publishUnknown || !current() || (saved && !saved.can_edit)) return;
    lock.current = true; setWorking(true); setSaving(true); setError(null);
    try {
      const submission = await persistDraft();
      if (!current()) return;
      if (!submission) {
        setSaveUnknown(saveUnknown || sharingMutationState({ userId, type: 'skill' }).snapshot.lastFailureUnknown);
        return;
      }
      if (submission.payload) setDraft(fromPayload(submission.payload));
      setSaved(submission); setSaveUnknown(false); setPublished(null); setConsent(false); setReview(!submission.payload?.page_content_draft);
      void loadDrafts();
    } finally { lock.current = false; if (current()) { setWorking(false); setSaving(false); } }
  }
  async function publish(event: FormEvent) {
    event.preventDefault();
    if (lock.current || pending || saveUnknown || !consent || !current() || (!publishUnknown && !validPageDraft())) return;
    lock.current = true; setWorking(true);
    try {
      // An unknown publish may already have advanced the server version. Replay
      // that exact publish tuple before attempting any revision of the draft.
      const submission = publishUnknown ? saved : await persistDraft();
      if (!current()) return;
      if (!submission) {
        setSaveUnknown(sharingMutationState({ userId, type: 'skill' }).snapshot.lastFailureUnknown);
        return;
      }
      if (submission.payload) setDraft(fromPayload(submission.payload));
      setSaved(submission);
      setPublishAttempted(true);
      setLastCommand('publish');
      const result = await mutate<Submission>(`/me/skill-submissions/${submission.submission_id}/publish`, { consent_to_share: true }, Number(submission.aggregate_version));
      if (!result || !current()) return;
      setPublished(result); setReview(false); setSaved(null); setPublishAttempted(false); setConsent(false); setCopied(''); setDraft({ ...blank });
      void loadDrafts(); await onPublished();
    } finally { lock.current = false; if (current()) setWorking(false); }
  }
  async function startUpgrade() {
    if (!published) return;
    const draft = await upgrade.mutate<Submission>(`/me/skill-submissions/${published.submission_id}/upgrade`, {});
    if (draft && current()) onOpenDraft?.(draft.submission_id, 'complete');
  }
  async function withdraw() {
    if (!saved || pending || saveUnknown || publishUnknown) return;
    const result = await upgrade.mutate<Submission>(`/me/skill-submissions/${encodeURIComponent(saved.submission_id)}/revoke`, {}, Number(saved.aggregate_version));
    if (result) { setSaved(null); setPublishAttempted(false); setReview(false); setConsent(false); await loadDrafts(); }
  }
  async function copyLink() {
    const path = published ? skillPublicationPath(published) : null;
    if (!path) return;
    try { await navigator.clipboard.writeText(`${window.location.origin}${path}`); setCopied('已複製作品連結。'); }
    catch { setCopied('請開啟作品頁，複製瀏覽器網址即可分享。'); }
  }
  if (resumeId && resumedId !== resumeId && !saveUnknown && !publishUnknown) return <section className="card stack" aria-label="載入私人投稿">{loadError ? <><p role="alert">{loadError}</p><button type="button" className="btn btn-secondary btn-small community-search-action" onClick={() => setResumeRetry(value => value + 1)}>重試載入私人投稿</button></> : <p role="status">正在載入這份私人投稿，完成後才可編輯。</p>}</section>;
  if (resumeId && resumedAdvanced) return <section className="card stack"><p role="status">這份投稿已在下方進階工具開啟，原始內容與狀態會保留。</p></section>;
  return <section className="card stack work-sharing-form" aria-label="投稿開源工具">
    <ol className="work-sharing-progress" data-guide-anchor="opensource:progress" aria-label="投稿進度"><li aria-current={!review && !published ? 'step' : undefined}>1 填寫介紹</li><li aria-current={review ? 'step' : undefined}>2 預覽／保存草稿</li><li aria-current={published ? 'step' : undefined}>3 分享連結</li></ol>
    {published ? <section ref={success} tabIndex={-1} className="work-sharing-success stack" aria-label="投稿完成">
      <h2>你的工具已分享！</h2><p>已公開為社群技能書，夥伴現在就能閱讀與分享。公會指定技能書另有選書流程。</p>
      <p>這本技能書已可使用。可再補上 100 則分享介紹，示意圖選填；新版公開前，現在的版本保持不變。</p>
      <PublishedSkillLinks submission={published}/>{published.project_id&&<a className="btn btn-secondary btn-small" href={`#opensource?project=${encodeURIComponent(published.project_id)}`}>管理這份作品</a>}<div className="actions"><button type="button" className="btn btn-ghost" disabled={upgrade.busy} onClick={() => void startUpgrade()}>補充分享介紹（示意圖選填）</button><button type="button" className="btn btn-ghost" onClick={() => void copyLink()}>複製作品連結</button><a className="btn btn-ghost" href="#cocreation">找人一起開發</a></div>
      {upgrade.error && <p className="banner banner-error" role="alert">{upgrade.error}</p>}
      {copied && <p role="status">{copied}</p>}<button type="button" className="btn btn-ghost" onClick={() => setPublished(null)}>再投稿一個工具</button>
    </section> : review ? <form className="stack" onSubmit={event => void publish(event)} aria-busy={pending}>
      <h2 ref={previewHeading} tabIndex={-1}>確認這樣分享，好嗎？</h2>
      <h3>{draft.title}</h3><p className="work-sharing-preview">{draft.description}</p>
      <SkillSubmissionPagePreview source={{ title: draft.title, description: draft.description, use_notes: draft.use_notes || defaultNotes, ...(draft.page ? { page_content: manualSkillPageContent(draft.page) } : {}) }}/>
      <dl className="meta"><div><dt>專案網址</dt><dd className="work-sharing-preview">{draft.repository_url}</dd></div><div><dt>與作品的關係</dt><dd>{relationshipLabels[draft.relationship]}（自行聲明）</dd></div></dl>
      <details><summary>使用說明與展示網址</summary><div className="stack"><p className="work-sharing-preview">{draft.use_notes || defaultNotes}</p>{draft.demo_url && <p className="work-sharing-preview">{draft.demo_url}</p>}</div></details>
      <p className="hint">確認後即公開為社群技能書。系統會讀取 GitHub 的公開版本與授權；來源關係仍為本人自行聲明。</p>
      <label className="choice"><input type="checkbox" required checked={consent} disabled={pending} onChange={event => setConsent(event.target.checked)}/>我同意公開這份作品介紹與來源關係</label>
      <div className="actions"><button className="btn btn-primary" disabled={pending || saveUnknown || !consent}>{pending ? saving ? '正在儲存私人草稿…' : '正在確認公開來源與授權…' : publishAttempted ? '重試公開投稿' : '確認並公開'}</button>{(!saved || saved.can_edit) && <button type="button" className="btn btn-ghost" disabled={pending || saveUnknown || publishUnknown} onClick={() => { setReview(false); setError(null); }}>修改內容</button>}</div>
      {saved && <p role="status" className="hint">{publishUnknown || (lastCommand === 'publish' && pending) ? '已保存草稿；公開結果尚未確認，請先確認原公開操作。' : '已保存私人草稿，待本人預覽；尚未送審或公開，來源與授權尚未核可。可稍後從下方草稿繼續。'}</p>}
      {saved && <div className="actions"><button type="button" className="btn btn-ghost" disabled={pending || saveUnknown || publishUnknown || upgrade.busy} onClick={() => void withdraw()}>撤銷這份私人投稿</button></div>}
    </form> : <form className="stack" onSubmit={event => {
      if ((event.nativeEvent as SubmitEvent).submitter?.getAttribute('data-action') === 'save') {
        event.preventDefault();
        const fields = [...event.currentTarget.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-manual-source]')];
        fields.forEach(validateField);
        const invalid = fields.find(field => !field.checkValidity());
        if (invalid) { invalid.reportValidity(); return; }
        void saveDraft(); return;
      }
      event.currentTarget.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(validateField);
      if (!event.currentTarget.reportValidity()) { event.preventDefault(); return; }
      preview(event);
    }} onInput={event => {
      const field = event.target;
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) validateField(field);
    }}>
      <div className="section-head"><h2>投稿你的開源工具</h2><p>填寫真實用途與三步流程，先預覽再公開。</p></div>
      <fieldset disabled={pending || saveUnknown || publishUnknown} className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <label className="field">GitHub 專案網址<input name="repository_url" data-manual-source required type="url" maxLength={300} placeholder="https://github.com/你的帳號/專案名稱" data-guide-anchor="opensource:repository" value={draft.repository_url} onChange={event => setDraft({ ...draft, repository_url: event.target.value })}/></label>
      <label className="field">作品名稱<input data-manual-source required maxLength={120} placeholder="例如：自動整理會議筆記" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })}/></label>
      <label className="field">一句話介紹<textarea aria-label="一句話介紹" data-manual-source required maxLength={2000} rows={3} placeholder="它能幫誰，解決什麼問題？" value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })}/></label>
      {draft.page ? <SkillSubmissionPageFields value={draft.page} onChange={page => setDraft({ ...draft, page })}/> : <div className="stack"><p className="hint">這是先前保存的介紹，原文會保留；可以補上問題、原理與流程圖。</p><button type="button" className="btn btn-secondary btn-small" onClick={() => setDraft({ ...draft, page: blankSkillPageFields() })}>補齊完整介紹頁</button></div>}
      {draft.page && <label className="field">如何開始使用<textarea aria-label="如何開始使用" required maxLength={3000} rows={4} placeholder="依原作文件寫出第一次操作的方法：開啟哪個入口或執行什麼指令、準備哪些資料、如何看到結果。" value={draft.use_notes} onChange={event => setDraft({ ...draft, use_notes: event.target.value })}/><span className="field-hint">提供可照著操作的真實起步步驟。</span></label>}
      <label className="field">我與作品的關係<select value={draft.relationship} onChange={event => setDraft({ ...draft, relationship: event.target.value as Relationship })}>{Object.entries(relationshipLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><span className="field-hint">推薦別人的工具也可以，原作者與授權都會保留。這是你的聲明，不是作者身分驗證。</span></label>
      <details><summary>補充使用說明與展示網址（選填）</summary><div className="stack">{!draft.page && <label className="field">如何開始使用<textarea aria-label="如何開始使用" maxLength={3000} rows={3} placeholder={defaultNotes} value={draft.use_notes} onChange={event => setDraft({ ...draft, use_notes: event.target.value })}/></label>}<label className="field">展示網址（選填）<input type="url" maxLength={2000} placeholder="https://…" value={draft.demo_url} onChange={event => setDraft({ ...draft, demo_url: event.target.value })}/></label></div></details>
      <p className="hint">預覽不會寫入資料。儲存私人草稿後可重載續寫；尚未儲存的內容只保留在目前登入的頁面中。</p><div className="actions"><button className="btn btn-primary">預覽投稿</button><button className="btn btn-secondary btn-small" data-action="save" formNoValidate disabled={publishUnknown}>儲存私人草稿</button></div>
      </fieldset>
    </form>}
    {!published && review && (!saved || saved.can_edit) && <div className="actions"><button type="button" className="btn btn-secondary btn-small" disabled={pending || saveUnknown || publishUnknown} onClick={() => void saveDraft()}>儲存私人草稿</button></div>}
    {!published && saved?.payload?.page_content_draft && !review && <p role="status">未完成的介紹已保存為私人草稿；補齊後才能預覽公開。</p>}
    {!published && saved && dirty && <p role="status">目前修改尚未儲存。</p>}
    {saveUnknown && <div className="stack"><p role="alert">儲存結果尚未確認，請先重試原請求；內容與操作識別碼已保留，不會公開。</p><button type="button" className="btn btn-secondary btn-small" disabled={pending} onClick={() => void saveDraft()}>重試儲存私人草稿</button></div>}
    {error && <p className="banner banner-error" role="alert">{error}</p>}
    {upgrade.error && !published && <p className="banner banner-error" role="alert">{upgrade.error}</p>}
    {loadError && <p role="alert">{loadError} <button type="button" className="btn btn-ghost" onClick={() => void loadDrafts()}>重新載入草稿</button></p>}
    {ready.length > 0 && !review && <details className="work-sharing-advanced"><summary>繼續未公開的草稿（{ready.length}）</summary><div className="stack">{ready.map(item => <div className="actions" key={item.submission_id}><span>{item.payload?.title}</span><button className="btn btn-ghost" type="button" disabled={pending || saveUnknown || publishUnknown} onClick={() => resume(item)}>繼續投稿：{item.payload?.title}</button></div>)}</div></details>}
  </section>;
}
