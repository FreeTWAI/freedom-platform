import { validSkillPageDraft, type SkillPageDraft } from '../../../../modules/skill-submissions/page-draft.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { requireItems, type PortalClient } from '../api';
import { formatIsoLocal } from '../format';
import { logConsoleEvent } from '../game-console-core';
import { consoleChannel } from '../game-console-routing';
import { useModuleMutation } from './shared';
import { CHAT_JSON_MAX_BYTES, chatSkillInstruction, parseChatSkillJson, repositoryKey, type ChatSkillSeed } from './skill-upload-chat';
import { agentInstruction, SKILL_UPLOAD_GUIDE } from './skill-upload-instruction';
export { agentInstruction } from './skill-upload-instruction';
import './SkillUpload.css';
import './WorkSharing.css';
import { authoringDraftState, sharingMutationState, useAuthoringDraft } from './authoring-drafts';
import { PublishedSkillLinks, skillPublicationPath } from './SkillPublication';
import { validSkillPageContent, type SkillPageContent } from '../../../../modules/community/skill-page-content.js';
import { blankSkillPageFields, manualSkillPageContent, skillPageFields, SkillSubmissionPageFields, type ManualSkillPageFields } from './SkillSubmissionPageFields';
import { SkillSubmissionPagePreview } from './SkillSubmissionPagePreview';

type Relationship = 'author' | 'maintainer' | 'contributor' | 'curator';
export const relationshipLabels: Record<Relationship, string> = { author: '原作者', maintainer: '維護者', contributor: '貢獻者', curator: '推薦／整理者' };
type Step = 'url' | 'choice' | 'manual' | 'agent';
type Seed = Partial<ChatSkillSeed> & { title?: string; repository_url?: string };
type UploadGrant = { token: string; expires_at: string; submit_url: string };
type GrantResult = { submission: Submission; upload_grant?: UploadGrant | null };
type AgentSecret = { submissionId: string; token: string; expiresAt: string; submitUrl: string; repositoryUrl: string; seed?: Seed | null };
type UploadKey = { key_id: string; label: string; scope: 'skill:submit'; expires_at: string; revoked_at: string | null };
type HeldGrant = { id: string; token: string; submitUrl: string; version: number };
type Draft = { repository_url: string; title: string; description: string; use_notes: string; demo_url: string; relationship: Relationship; page?: ManualSkillPageFields };
type SubmissionPayload = Omit<Draft, 'demo_url' | 'page'> & { demo_url: string | null; share_introductions?: string[]; page_content?: SkillPageContent; page_content_draft?: SkillPageDraft };
type Submission = { project_id?: string | null; submission_id: string; status: string; can_edit?: boolean; aggregate_version: number | string; public_path: string | null; illustration_url?: string | null; grant_expires_at?: string | null; grant_revoked_at?: string | null; created_at?: string; updated_at?: string; seed?: Seed | null; upgrades_submission_id?: string | null; payload: SubmissionPayload | null };
function isExpired(iso: string | null | undefined) {
  if (!iso) return false;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms <= Date.now();
}
function sameOriginSubmitUrl(value: string) {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (!origin) return null;
    const url = new URL(value, origin);
    return url.origin === origin && !url.username && !url.password && /^\/agent-api\/v1\/skill-submissions\/[^/]+$/.test(url.pathname) && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}
function instructionSeed(seed: Seed | null | undefined): ChatSkillSeed | null {
  if (!seed || typeof seed.title !== 'string' || typeof seed.description !== 'string' || typeof seed.use_notes !== 'string' || typeof seed.relationship !== 'string') return null;
  return {
    title: seed.title,
    description: seed.description,
    use_notes: seed.use_notes,
    relationship: seed.relationship,
    demo_url: seed.demo_url ?? null,
    ...(seed.page_content ? { page_content: seed.page_content } : {}),
  };
}
function plainGrantUsable(item: Submission) {
  return item.status === 'awaiting_upload' && !item.seed && !item.grant_revoked_at && !(item.grant_expires_at && isExpired(item.grant_expires_at));
}
function localPath(value: string | null | undefined) {
  return value && /^\/(?!\/)[^\s\\]*$/.test(value) ? value : null;
}
function draftStateLabel(item: Submission) {
  if (item.status === 'awaiting_upload') {
    if (item.seed) return '待補分享介紹';
    if (item.grant_revoked_at) return '上傳憑證已撤銷';
    if (isExpired(item.grant_expires_at)) return '上傳憑證已過期';
    return '等待 Agent 上傳';
  }
  if (item.payload?.page_content_draft) return '草稿未完成';
  return '待預覽公開';
}
const blank: Draft = { repository_url: '', title: '', description: '', use_notes: '', demo_url: '', relationship: 'curator', page: blankSkillPageFields() };
const defaultNotes = '請先閱讀原作 README，依其中的安裝步驟開始使用；使用條件與授權以原作文件為準。';
function fromPayload(payload: SubmissionPayload): Draft {
  return {
    repository_url: payload.repository_url, title: payload.title, description: payload.description, use_notes: payload.use_notes,
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

export function SkillSubmission({ client, userId, resumeId = null, resumeTrigger = 0, withdrawnProjectIds = [], onPublished }: { client: PortalClient; userId: string; resumeId?: string | null; resumeTrigger?: number; withdrawnProjectIds?: string[]; onPublished: () => Promise<void> }) {
  const [step, setStep] = useAuthoringDraft<Step>(userId, 'skill:step', 'url');
  const [draft, setDraft, current] = useAuthoringDraft<Draft>(userId, 'skill:draft', { ...blank });
  const [review, setReview] = useAuthoringDraft(userId, 'skill:review', false), [consent, setConsent] = useAuthoringDraft(userId, 'skill:consent', false);
  const [saved, setSaved] = useAuthoringDraft<Submission | null>(userId, 'skill:saved', null), [published, setPublished] = useAuthoringDraft<Submission | null>(userId, 'skill:published', null);
  const [publishAttempted, setPublishAttempted] = useAuthoringDraft(userId, 'skill:publish-attempted', false);
  const [saving, setSaving] = useAuthoringDraft(userId, 'skill:saving', false);
  const [saveUnknown, setSaveUnknown] = useAuthoringDraft(userId, 'skill:save-unknown', false);
  const [lastCommand, setLastCommand] = useAuthoringDraft<'save' | 'publish' | null>(userId, 'skill:last-command', null);
  const withdrawnKey = withdrawnProjectIds.join(',');
  const ignoreWithdrawnFor = useRef<string | null>(null);
  useEffect(() => {
    if (ignoreWithdrawnFor.current && !withdrawnProjectIds.includes(ignoreWithdrawnFor.current)) {
      ignoreWithdrawnFor.current = null;
    }
    if (published?.project_id && withdrawnProjectIds.includes(published.project_id) && ignoreWithdrawnFor.current !== published.project_id) {
      setPublished(null);
      setCopied('');
    }
  }, [published?.project_id, withdrawnKey]);
  const [drafts, setDrafts] = useState<Submission[]>([]), [loadingDrafts, setLoadingDrafts] = useState(false), [loadError, setLoadError] = useState('');
  const [copied, setCopied] = useState('');
  const [agentSecret, setAgentSecret] = useState<AgentSecret | null>(null);
  const [agentIssue, setAgentIssue] = useState<string | null>(null);
  const [agentNotice, setAgentNotice] = useState<string | null>(null);
  const [agentCopied, setAgentCopied] = useState('');
  const agentField = useRef<HTMLTextAreaElement>(null), agentHeading = useRef<HTMLHeadingElement>(null), agentEpoch = useRef(0);
  const [agentFocus, setAgentFocus] = useState(0);
  const [keys, setKeys] = useState<UploadKey[]>([]), [keysError, setKeysError] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState({ label: '', expires_in_days: '30' });
  const [issuedKey, setIssuedKey] = useState<{ id: string; label: string; token: string } | null>(null);
  const [keyCopied, setKeyCopied] = useState('');
  const keyField = useRef<HTMLTextAreaElement>(null);
  const [chatRepo, setChatRepo] = useState(''), [chatJson, setChatJson] = useState('');
  const [chatError, setChatError] = useState<string | null>(null), [chatBusy, setChatBusy] = useState(false);
  const [chatCopied, setChatCopied] = useState(''), [chatTargetId, setChatTargetId] = useState<string | null>(null);
  const chatFile = useRef<HTMLInputElement>(null), heldRef = useRef<HeldGrant | null>(null), chatRepoInit = useRef(false);
  const [activeAgentDraft, setActiveAgentDraft] = useState<Submission | null>(null);
  const { mutate, busy, error, setError, lastFailureUnknown } = useModuleMutation(client, { userId, type: 'skill' });
  const upgrade = useModuleMutation(client, { userId, type: 'skill:upgrade' });
  const agentMutation = useModuleMutation(client, { userId, type: 'skill:agent' });
  const credentials = useModuleMutation(client, { userId, type: 'skill:keys' });
  const lock = useRef(false), [working, setWorking] = useAuthoringDraft(userId, 'skill:working', false);
  const previewHeading = useRef<HTMLHeadingElement>(null), success = useRef<HTMLElement>(null);
  const [resumedId, setResumedId] = useState<string | null>(null), [handledTrigger, setHandledTrigger] = useState(resumeTrigger), [resumeRetry, setResumeRetry] = useState(0);
  const requestedResume = useRef(resumeId); requestedResume.current = resumeId;
  const needsResume = Boolean(resumeId && (resumedId !== resumeId || handledTrigger !== resumeTrigger));
  const needsResumeRef = useRef(false); needsResumeRef.current = needsResume;
  const pending = busy || working || upgrade.busy || agentMutation.busy;
  const publishUnknown = lastCommand === 'publish' && lastFailureUnknown;
  const activeStep: Step = saved || saveUnknown || publishUnknown ? 'manual' : step;

  useEffect(() => {
    if (!resumeId) { setResumedId(null); setHandledTrigger(resumeTrigger); return; }
    // Navigation may arrive while a previous mount is still saving/publishing.
    // Resume only after it settles; an already consumed URL must not reload on
    // that draft's own later publish/revoke transitions.
    if (!needsResume || pending || saveUnknown || publishUnknown || lock.current) return;
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
        if (item.status === 'awaiting_upload') {
          openAgentForDraft(item);
        } else if (item.status === 'published') {
          clearAgentState();
          setSaved(null); setReview(false); setPublished(item); setError(null);
        } else if (!item.payload || item.status !== 'ready_for_review') {
          clearAgentState();
          setSaved(null); setPublished(null); setReview(false); setStep('url');
          setError('這份私人投稿已撤銷或無法載入，請重新開始。');
        } else {
          const payload = item.payload;
          clearAgentState();
          setDraft(fromPayload(payload));
          // Resumed drafts retain the existing retry label; consent is always renewed.
          setSaved(item); setPublished(null); setPublishAttempted(true); setConsent(false); setStep('manual'); setReview(!payload.page_content_draft); setError(null);
        }
        setResumedId(resumeId);
        setHandledTrigger(resumeTrigger);
      }).catch(cause => { if (live()) setLoadError(cause instanceof Error ? cause.message : '私人投稿暫時無法載入。'); });
    return () => controller.abort();
  }, [client, userId, resumeId, resumeTrigger, needsResume, resumeRetry, resumedId, pending, saveUnknown, publishUnknown]);

  async function loadDrafts() {
    setLoadError('');
    setLoadingDrafts(true);
    try { const items = requireItems<Submission>(await client.get('/me/skill-submissions'), '投稿草稿'); if (current()) setDrafts(items.filter(item => item.status === 'awaiting_upload' || item.status === 'ready_for_review')); }
    catch { if (current()) setLoadError('私人草稿暫時無法載入。'); }
    finally { if (current()) setLoadingDrafts(false); }
  }
  useEffect(() => {
    agentEpoch.current += 1;
    setDrafts([]); setKeys([]); setKeysError(null); setIssuedKey(null); setKeyCopied('');
    setAgentSecret(null); setAgentIssue(null); setAgentNotice(null); setAgentCopied('');
    setActiveAgentDraft(null); setChatTargetId(null); setChatJson(''); setChatError(null); setChatCopied(''); heldRef.current = null;
    void loadDrafts();
  }, [client, userId]);
  useEffect(() => {
    if (!agentSecret || typeof window === 'undefined') return;
    const timer = window.setInterval(() => {
      if (isExpired(agentSecret.expiresAt)) {
        setAgentSecret(null);
        setAgentIssue('一次性上傳憑證已過期，請重新產生指令。');
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [agentSecret]);
  useEffect(() => {
    if (activeStep !== 'agent' || !agentSecret || published || review || typeof window === 'undefined') return;
    const watched = agentSecret.submissionId;
    let stopped = false;
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void (async () => {
        try {
          const loaded = requireItems<Submission>(await client.get('/me/skill-submissions'), '投稿草稿');
          if (stopped || !current()) return;
          setDrafts(loaded.filter(item => item.status === 'awaiting_upload' || item.status === 'ready_for_review'));
          const matched = loaded.find(item => item.submission_id === watched);
          const expired = Boolean(matched?.grant_expires_at && isExpired(matched.grant_expires_at));
          if (!matched || matched.status === 'revoked' || matched.grant_revoked_at || expired) {
            setAgentSecret(curr => curr?.submissionId === watched ? null : curr);
            if (!matched || matched.status === 'revoked') setActiveAgentDraft(curr => curr?.submission_id === watched ? null : curr);
            return;
          }
          if (matched.status === 'ready_for_review') {
            setAgentSecret(curr => curr?.submissionId === watched ? null : curr);
            setActiveAgentDraft(curr => curr?.submission_id === watched ? null : curr);
            setAgentNotice(`Agent 已上傳「${matched.payload?.title ?? ''}」，請在下方草稿預覽並公開。`);
          }
        } catch { /* Retry on next visible tick. */ }
      })();
    }, 10_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [activeStep, agentSecret, published, review, client]);

  function clearAgentState() {
    agentEpoch.current += 1;
    setAgentSecret(null); setAgentIssue(null); setAgentNotice(null); setAgentCopied('');
    setActiveAgentDraft(null); setChatTargetId(null);
    setIssuedKey(null); setKeyCopied(''); setChatError(null); setChatCopied(''); heldRef.current = null;
    chatRepoInit.current = false;
    agentMutation.setError(null);
    credentials.setError(null);
  }
  function acceptAgentGrant(result: GrantResult | undefined, repositoryUrl: string) {
    if (!result?.submission) return;
    setDrafts(list => [result.submission, ...list.filter(item => item.submission_id !== result.submission.submission_id)]
      .filter(item => item.status === 'awaiting_upload' || item.status === 'ready_for_review'));
    const grant = result.upload_grant, submitUrl = grant ? sameOriginSubmitUrl(grant.submit_url) : null;
    if (!grant) { setAgentSecret(null); setAgentIssue('草稿已建立，但憑證只在第一次回應顯示。請重新產生指令。'); return; }
    if (!submitUrl) { setAgentSecret(null); setAgentIssue('上傳網址不是本站位址，已停止顯示憑證。請重新產生指令。'); return; }
    if (isExpired(grant.expires_at)) { setAgentSecret(null); setAgentIssue('一次性上傳憑證已過期，請重新產生指令。'); return; }
    setAgentIssue(null); setAgentCopied('');
    setAgentSecret({ submissionId: result.submission.submission_id, token: grant.token, expiresAt: grant.expires_at, submitUrl, repositoryUrl: result.submission.seed?.repository_url ?? repositoryUrl, seed: result.submission.seed ?? null });
  }
  async function startAgent() {
    if (lock.current || pending || !current()) return;
    const epoch = agentEpoch.current;
    setError(null); setAgentIssue(null); setAgentNotice(null); setAgentCopied(''); agentMutation.setError(null);
    setActiveAgentDraft(null); setChatTargetId(null); setChatRepo(draft.repository_url.trim()); setChatError(null); setChatCopied('');
    const result = await agentMutation.mutate<GrantResult>('/me/skill-submissions', {});
    if (!current() || !result?.submission || epoch !== agentEpoch.current) return;
    setActiveAgentDraft(result.submission);
    acceptAgentGrant(result, draft.repository_url.trim());
    setStep('agent');
    setAgentFocus(value => value + 1);
    void loadDrafts();
  }
  async function regrantDraft(target: Submission) {
    if (lock.current || pending || !current()) return;
    const epoch = agentEpoch.current;
    setError(null); setAgentIssue(null); setAgentNotice(null); setAgentCopied(''); agentMutation.setError(null);
    const result = await agentMutation.mutate<GrantResult>(`/me/skill-submissions/${encodeURIComponent(target.submission_id)}/grant`, {}, Number(target.aggregate_version));
    if (!current() || !result?.submission || epoch !== agentEpoch.current) return;
    setActiveAgentDraft(result.submission);
    acceptAgentGrant(result, result.submission.seed?.repository_url ?? (target.seed?.repository_url || draft.repository_url.trim()));
    void loadDrafts();
  }
  async function revokeAgentDraft() {
    if (!activeAgentDraft || lock.current || pending || !current()) return;
    const epoch = agentEpoch.current;
    const target = activeAgentDraft;
    setAgentIssue(null); setAgentCopied('');
    const result = await agentMutation.mutate<Submission>(`/me/skill-submissions/${encodeURIComponent(target.submission_id)}/revoke`, {}, Number(target.aggregate_version));
    if (!result || !current() || epoch !== agentEpoch.current) return;
    setDrafts(list => list.filter(item => item.submission_id !== target.submission_id));
    if (agentSecret?.submissionId === target.submission_id) setAgentSecret(null);
    if (heldRef.current?.id === target.submission_id) heldRef.current = null;
    if (chatTargetId === target.submission_id) { setChatTargetId(null); setChatRepo(draft.repository_url.trim()); }
    setActiveAgentDraft(null);
    setAgentNotice('草稿已撤銷，憑證無法再上傳。');
    await loadDrafts();
  }
  function openAgentForDraft(item: Submission, { issueGrant = false }: { issueGrant?: boolean } = {}) {
    if (pending || saveUnknown || publishUnknown || !current()) return;
    clearAgentState();
    setError(null); setSaved(null); setPublished(null); setReview(false); setConsent(false); setPublishAttempted(false);
    setActiveAgentDraft(item);
    const repo = item.seed?.repository_url ?? item.payload?.repository_url ?? '';
    setChatTargetId(item.submission_id);
    setChatRepo(repo);
    chatRepoInit.current = true;
    setStep('agent');
    setAgentFocus(value => value + 1);
    if (issueGrant) void regrantDraft(item);
  }
  async function copyAgentInstruction() {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const value = agentSecret ? agentInstruction(origin, agentSecret, instructionSeed(agentSecret.seed), agentSecret.repositoryUrl) : '';
    if (!value) return;
    try { await navigator.clipboard.writeText(value); setAgentCopied('已複製，只貼給你選擇的 Agent。'); }
    catch { agentField.current?.select(); setAgentCopied('無法自動複製，已選取內容，請手動複製。'); }
  }
  async function loadKeys() {
    const epoch = agentEpoch.current;
    setKeysError(null);
    try { const loaded = requireItems<UploadKey>(await client.get('/me/skill-upload-keys'), '上傳金鑰'); if (current() && epoch === agentEpoch.current) setKeys(loaded); }
    catch (cause) { if (current() && epoch === agentEpoch.current) setKeysError(cause instanceof Error ? cause.message : '無法載入上傳金鑰。'); }
  }
  async function issueKey(event: FormEvent) {
    event.preventDefault(); setIssuedKey(null); setKeyCopied('');
    const epoch = agentEpoch.current;
    const result = await credentials.mutate<{ key: UploadKey; token?: string | null }>('/me/skill-upload-keys', { label: keyDraft.label.trim(), expires_in_days: Number(keyDraft.expires_in_days) });
    if (!result || !current() || epoch !== agentEpoch.current) return;
    if (result.token) { setIssuedKey({ id: result.key.key_id, label: result.key.label, token: result.token }); setKeyDraft({ label: '', expires_in_days: '30' }); }
    else credentials.setError('金鑰已建立，但只在第一次回應顯示。請撤銷這把金鑰後重新建立。');
    await loadKeys();
  }
  async function revokeKey(key: UploadKey) {
    const epoch = agentEpoch.current;
    const result = await credentials.mutate<UploadKey>(`/me/skill-upload-keys/${encodeURIComponent(key.key_id)}/revoke`, {});
    if (!result || !current() || epoch !== agentEpoch.current) return;
    if (issuedKey?.id === key.key_id) { setIssuedKey(null); setKeyCopied(''); }
    await Promise.all([loadKeys(), loadDrafts()]);
  }
  async function copyIssuedKey() {
    if (!issuedKey) return;
    try { await navigator.clipboard.writeText(issuedKey.token); setKeyCopied('已複製，只貼給你選擇的 Agent。'); }
    catch { keyField.current?.select(); setKeyCopied('無法自動複製，已選取內容，請手動複製。'); }
  }
  function rememberGrant(result: GrantResult | undefined): HeldGrant | null {
    if (result?.submission) {
      setDrafts(list => [result.submission, ...list.filter(item => item.submission_id !== result.submission.submission_id)]
        .filter(item => item.status === 'awaiting_upload' || item.status === 'ready_for_review'));
    }
    const grant = result?.upload_grant, submitUrl = grant ? sameOriginSubmitUrl(grant.submit_url) : null;
    if (!result || !grant || !submitUrl || isExpired(grant.expires_at)) { heldRef.current = null; return null; }
    const next = { id: result.submission.submission_id, token: grant.token, submitUrl, version: Number(result.submission.aggregate_version) };
    heldRef.current = next;
    return next;
  }
  function heldGrant(): HeldGrant | null {
    const held = heldRef.current;
    if (!held) return null;
    const item = drafts.find(entry => entry.submission_id === held.id);
    if (item && (item.status !== 'awaiting_upload' || item.grant_revoked_at || (item.grant_expires_at && isExpired(item.grant_expires_at)))) {
      heldRef.current = null;
      return null;
    }
    return held;
  }
  async function rotateHeld(id: string, version: number) {
    if (agentSecret?.submissionId === id) setAgentSecret(null);
    const result = await client.post<GrantResult>(`/me/skill-submissions/${encodeURIComponent(id)}/grant`, {}, { ifMatch: version });
    const grant = rememberGrant(result);
    if (!grant) throw new Error('無法取得新的上傳授權。請按「重新產生指令」後再貼一次 JSON。');
    return grant;
  }
  async function grantForPaste(repositoryUrl: unknown) {
    const key = repositoryKey(typeof repositoryUrl === 'string' ? repositoryUrl : null);
    const target = chatTargetId ? (drafts.find(item => item.submission_id === chatTargetId) ?? (activeAgentDraft?.submission_id === chatTargetId ? activeAgentDraft : undefined)) : undefined;
    const seeded = key ? drafts.find(item => item.status === 'awaiting_upload' && item.seed && repositoryKey(item.seed.repository_url) === key) : undefined;
    const plain = drafts.find(plainGrantUsable);
    const chosen = target?.status === 'awaiting_upload' ? target : seeded ?? plain;
    const held = heldGrant();
    if (chosen) return held?.id === chosen.submission_id ? held : rotateHeld(chosen.submission_id, Number(chosen.aggregate_version));
    if (held && !drafts.some(item => item.submission_id === held.id && item.seed)) return held;
    const created = await client.post<GrantResult>('/me/skill-submissions', {});
    const grant = rememberGrant(created);
    if (!grant) throw new Error('草稿已建立，但沒有可使用的上傳授權。請按「重新產生指令」後再貼一次 JSON。');
    return grant;
  }
  async function agentDetail(response: Response) {
    try {
      const body = await response.json() as { detail?: unknown };
      if (typeof body.detail === 'string' && body.detail.trim()) return body.detail.trim();
    } catch { /* Status fallback is sufficient. */ }
    if (response.status === 401) return '上傳授權已失效。請按「重新產生指令」後再貼一次 JSON。';
    return `上傳沒有完成（${response.status}）。`;
  }
  async function submitChat(event: FormEvent) {
    event.preventDefault();
    const epoch = agentEpoch.current;
    setChatError(null);
    const parsed = parseChatSkillJson(chatJson);
    if (!parsed.ok) { setChatError(parsed.message); return; }
    if (!validSkillPageContent(parsed.value.page_content)) { setChatError('請讓 AI 依說明補齊 page_content：一句主張、問題、運作原理、三個成果與三個操作步驟，再貼上完整 JSON。'); return; }
    setChatBusy(true);
    try {
      let grant = await grantForPaste(parsed.value.repository_url);
      if (!current() || epoch !== agentEpoch.current) return;
      const send = (active: HeldGrant) => fetch(active.submitUrl, {
        method: 'POST', credentials: 'same-origin',
        headers: { Authorization: `Bearer ${active.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: parsed.text,
      });
      let response = await send(grant);
      if (response.status === 401) {
        if (!current() || epoch !== agentEpoch.current) return;
        grant = await rotateHeld(grant.id, grant.version);
        if (!current() || epoch !== agentEpoch.current) return;
        response = await send(grant);
      }
      if (!current() || epoch !== agentEpoch.current) return;
      if (!response.ok) { setChatError(await agentDetail(response)); return; }
      heldRef.current = null;
      setChatJson(''); setChatError(null); setAgentSecret(null);
      const uploaded = await client.get<Submission>(`/me/skill-submissions/${encodeURIComponent(grant.id)}`);
      if (!current() || epoch !== agentEpoch.current) return;
      await loadDrafts();
      if (uploaded?.payload && epoch === agentEpoch.current) resume(uploaded);
    } catch (cause) {
      if (current() && epoch === agentEpoch.current) setChatError(cause instanceof Error ? cause.message : '上傳沒有完成。');
    } finally { if (current()) setChatBusy(false); }
  }
  async function loadChatFile(file: File) {
    setChatError(null);
    if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') { setChatError('請選擇 .json 檔。'); return; }
    if (file.size > CHAT_JSON_MAX_BYTES) { setChatError('JSON 超過 800 KB 上限。請讓 AI 縮小內容，不要附上過大的示意圖。'); return; }
    const text = await file.text();
    if (!current()) return;
    setChatJson(text);
    const parsed = parseChatSkillJson(text);
    if (!parsed.ok) setChatError(parsed.message);
  }
  async function copyChat() {
    const value = chatSkillInstruction(chatRepo, instructionSeed(chatTarget?.seed));
    try { await navigator.clipboard.writeText(value); setChatCopied('已複製給聊天 AI 的說明。'); }
    catch { setChatCopied('無法自動複製，請選取說明後手動複製。'); }
  }
  useEffect(() => { if (review) previewHeading.current?.focus(); }, [review]);
  useEffect(() => { if (published) success.current?.focus(); }, [published]);
  useEffect(() => { if (agentFocus > 0 && activeStep === 'agent' && !review && !published) agentHeading.current?.focus(); }, [agentFocus, activeStep, review, published]);

  function preview(event: FormEvent) {
    event.preventDefault(); if (pending || saveUnknown || publishUnknown || !current() || !validPageDraft()) return; setPublished(null); setError(null); setConsent(false); setReview(true);
  }
  function validPageDraft() {
    if ((saved && saved.can_edit === false) || !draft.page || (draft.use_notes.trim() && validSkillPageContent(manualSkillPageContent(draft.page)))) return true;
    setError('請依欄位提示補齊效益主標、問題、原理、三個不同成果、三個完整步驟與起步方法；請用純文字，不填網址。');
    return false;
  }
  function resume(item: Submission) {
    if (!item.payload || pending || saveUnknown || publishUnknown || !current()) return;
    const payload = item.payload;
    clearAgentState();
    setDraft(fromPayload(payload));
    setSaved(item); setPublished(null); setPublishAttempted(true); setError(null); setConsent(false); setStep('manual'); setReview(!payload.page_content_draft);
  }
  function draftBody() {
    return {
      repository_url: draft.repository_url.trim(), relationship: draft.relationship, title: draft.title.trim(), description: draft.description.trim(),
      use_notes: draft.use_notes.trim() || (draft.page ? '' : defaultNotes), demo_url: draft.demo_url.trim() || null,
      ...(draft.page ? validSkillPageContent(manualSkillPageContent(draft.page)) && draft.use_notes.trim()
        ? { page_content: manualSkillPageContent(draft.page) } : { page_content_draft: draft.page } : {}),
    };
  }
  const dirty = saved?.can_edit === false ? false : (!saved?.payload || Object.entries(draftBody()).some(([key, value]) => comparable(saved.payload?.[key as keyof SubmissionPayload]) !== comparable(value)));
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
      setSaved(submission); setSaveUnknown(false); setPublished(null); setConsent(false); setStep('manual'); setReview(!submission.payload?.page_content_draft);
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
      logConsoleEvent({ id: `skill:${result.submission_id}`, createdAt: result.updated_at, channel: consoleChannel('skill_published'), level: 'success', kind: 'broadcast', source: '技能書發布', message: `技能書「${result.payload?.title ?? '未命名技能'}」已建立公開介紹頁。` });
      ignoreWithdrawnFor.current = result.project_id ?? null;
      setPublished(result); setReview(false); setSaved(null); setPublishAttempted(false); setConsent(false); setCopied(''); setDraft({ ...blank }); setStep('url');
      void loadDrafts(); await onPublished();
    } finally { lock.current = false; if (current()) setWorking(false); }
  }
  async function startUpgrade() {
    if (!published) return;
    const upgraded = await upgrade.mutate<Submission>(`/me/skill-submissions/${published.submission_id}/upgrade`, {});
    if (upgraded && current() && !needsResumeRef.current) {
      setDrafts(list => [upgraded, ...list.filter(item => item.submission_id !== upgraded.submission_id)]);
      openAgentForDraft(upgraded);
    }
  }
  async function withdraw() {
    if (!saved || pending || saveUnknown || publishUnknown) return;
    const wasReadOnly = saved.can_edit === false;
    const result = await upgrade.mutate<Submission>(`/me/skill-submissions/${encodeURIComponent(saved.submission_id)}/revoke`, {}, Number(saved.aggregate_version));
    if (result) {
      setSaved(null); setPublishAttempted(false); setReview(false); setConsent(false);
      if (wasReadOnly) { setDraft({ ...blank }); setStep('url'); }
      await loadDrafts();
    }
  }
  async function copyLink() {
    const path = published ? skillPublicationPath(published) : null;
    if (!path) return;
    try { await navigator.clipboard.writeText(`${window.location.origin}${path}`); setCopied('已複製作品連結。'); }
    catch { setCopied('請開啟作品頁，複製瀏覽器網址即可分享。'); }
  }

  useEffect(() => {
    if (activeStep === 'agent' && !chatRepoInit.current) {
      chatRepoInit.current = true;
      setChatRepo(curr => curr || draft.repository_url.trim());
    }
  }, [activeStep]);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const chatTarget = drafts.find(item => item.submission_id === chatTargetId) ?? (activeAgentDraft?.submission_id === chatTargetId ? activeAgentDraft : null);
  const agentPrompt = agentSecret ? agentInstruction(origin, agentSecret, instructionSeed(agentSecret.seed), agentSecret.repositoryUrl) : '';

  return needsResume && !saveUnknown && !publishUnknown ? <section className="card stack" aria-label="載入私人投稿">
      {loadError ? <><p role="alert">{loadError}</p><button type="button" className="btn btn-secondary btn-small community-search-action" onClick={() => setResumeRetry(value => value + 1)}>重試載入私人投稿</button></> : <p role="status">正在載入這份私人投稿，完成後才可編輯。</p>}
    </section> : <section className="card stack work-sharing-form" aria-label="投稿開源工具">
    <ol className="work-sharing-progress" data-guide-anchor="opensource:progress" aria-label="投稿進度">
      <li aria-current={!published && !review && activeStep === 'url' ? 'step' : undefined}>1 專案網址</li>
      <li aria-current={!published && !review && activeStep === 'choice' ? 'step' : undefined}>2 選擇方式</li>
      <li aria-current={!published && !review && (activeStep === 'manual' || activeStep === 'agent') ? 'step' : undefined}>3 填寫介紹</li>
      <li aria-current={!published && review ? 'step' : undefined}>4 預覽／公開</li>
      <li aria-current={published ? 'step' : undefined}>5 分享連結</li>
    </ol>
    {published ? <section ref={success} tabIndex={-1} className="work-sharing-success stack" aria-label="投稿完成">
      <h2>你的工具已分享！</h2><p>已公開為社群技能書，夥伴現在就能閱讀與分享。公會指定技能書另有選書流程。</p>
      <p>這本技能書已可使用。可再補上 100 則分享介紹，示意圖選填；新版公開前，現在的版本保持不變。</p>
      <PublishedSkillLinks submission={published}/>{published.project_id && <a className="btn btn-secondary btn-small" href={`#opensource?project=${encodeURIComponent(published.project_id)}`}>管理這份作品</a>}<div className="actions"><button type="button" className="btn btn-ghost" disabled={upgrade.busy} onClick={() => void startUpgrade()}>補充分享介紹（示意圖選填）</button><button type="button" className="btn btn-ghost" onClick={() => void copyLink()}>複製作品連結</button><a className="btn btn-ghost" href="#cocreation">找人一起開發</a></div>
      {upgrade.error && <p className="banner banner-error" role="alert">{upgrade.error}</p>}
      {copied && <p role="status">{copied}</p>}<button type="button" className="btn btn-ghost" onClick={() => { ignoreWithdrawnFor.current = null; setPublished(null); setStep('url'); setDraft({ ...blank }); }}>再投稿一個工具</button>
    </section> : review ? <form className="stack" onSubmit={event => void publish(event)} aria-busy={pending}>
      <h2 ref={previewHeading} tabIndex={-1}>確認這樣分享，好嗎？</h2>
      <h3>{draft.title}</h3><p className="work-sharing-preview">{draft.description}</p>
      <SkillSubmissionPagePreview source={{ title: draft.title, description: draft.description, use_notes: draft.use_notes || defaultNotes, ...(draft.page ? { page_content: manualSkillPageContent(draft.page) } : {}) }}/>
      {localPath(saved?.illustration_url) && <img className="skill-upload-illustration" src={localPath(saved?.illustration_url)!} alt={`${draft.title}的投稿插圖`}/>}
      <dl className="meta"><div><dt>專案網址</dt><dd className="work-sharing-preview">{draft.repository_url}</dd></div><div><dt>與作品的關係</dt><dd>{relationshipLabels[draft.relationship]}（自行聲明）</dd></div></dl>
      <details><summary>使用說明與展示網址</summary><div className="stack"><p className="work-sharing-preview">{draft.use_notes || defaultNotes}</p>{draft.demo_url && <p className="work-sharing-preview">{draft.demo_url}</p>}</div></details>
      {(saved?.payload?.share_introductions?.length ?? 0) > 0 && <details className="skill-upload-blurbs"><summary>分享短文 {saved!.payload!.share_introductions!.length} 則</summary><ol>{saved!.payload!.share_introductions!.map((text, index) => <li className="multiline-text" key={index}>{text}</li>)}</ol></details>}
      {(saved?.seed || saved?.upgrades_submission_id) && <p className="field-hint">送出後會取代簡易版；原本的作品連結會自動轉到完整版。</p>}
      <p className="hint">確認後即公開為社群技能書。系統會讀取 GitHub 的公開版本與授權；來源關係仍為本人自行聲明。</p>
      <label className="choice"><input type="checkbox" required checked={consent} disabled={pending} onChange={event => setConsent(event.target.checked)}/>我同意公開這份作品介紹與來源關係</label>
      <div className="actions"><button className="btn btn-primary" disabled={pending || saveUnknown || !consent}>{pending ? saving ? '正在儲存私人草稿…' : '正在確認公開來源與授權…' : publishAttempted ? '重試公開投稿' : '確認並公開'}</button>{(!saved || saved.can_edit) && <button type="button" className="btn btn-ghost" disabled={pending || saveUnknown || publishUnknown} onClick={() => { setReview(false); setError(null); }}>修改內容</button>}</div>
      {saved && <p role="status" className="hint">{publishUnknown || (lastCommand === 'publish' && pending) ? '已保存草稿；公開結果尚未確認，請先確認原公開操作。' : '已保存私人草稿，待本人預覽；尚未送審或公開，來源與授權尚未核可。可稍後從下方草稿繼續。'}</p>}
      {saved && <div className="actions"><button type="button" className="btn btn-ghost" disabled={pending || saveUnknown || publishUnknown || upgrade.busy} onClick={() => void withdraw()}>撤銷這份私人投稿</button></div>}
    </form> : activeStep === 'url' ? <form className="stack" onSubmit={event => {
      event.preventDefault();
      const fields = [...event.currentTarget.querySelectorAll<HTMLInputElement>('input[name="repository_url"]')];
      fields.forEach(validateField);
      if (!event.currentTarget.reportValidity()) return;
      setDraft({ ...draft, repository_url: draft.repository_url.trim() });
      setError(null);
      setStep('choice');
    }} onInput={event => {
      const field = event.target;
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) validateField(field);
    }}>
      <div className="section-head"><h2>投稿你的開源工具</h2><p>先貼上公開專案網址，再選擇自己填寫或交給 Agent 整理。</p></div>
      <label className="field">GitHub 專案網址<input name="repository_url" data-manual-source required type="url" maxLength={300} placeholder="https://github.com/你的帳號/專案名稱" data-guide-anchor="opensource:repository" value={draft.repository_url} onChange={event => setDraft({ ...draft, repository_url: event.target.value })}/></label>
      <div className="actions"><button className="btn btn-primary">下一步</button></div>
    </form> : activeStep === 'choice' ? <div className="stack">
      <div className="section-head"><h2>選擇填寫方式</h2><p>專案網址：<span className="work-sharing-preview">{draft.repository_url.trim()}</span></p></div>
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => { setError(null); clearAgentState(); setStep('manual'); }}>我自己填</button>
        <button type="button" className="btn btn-secondary btn-small" disabled={pending} onClick={() => void startAgent()}>{agentMutation.busy ? '產生中…' : '交給我的 agent'}</button>
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => { setError(null); clearAgentState(); setStep('url'); }}>修改網址</button>
      </div>
      {agentMutation.error && <p role="alert" className="banner banner-error">{agentMutation.error}</p>}
    </div> : activeStep === 'agent' ? <div className="stack">
      <div className="section-head">
        <h2 ref={agentHeading} tabIndex={-1}>交給我的 agent</h2>
        <p className="field-hint">Agent 只會上傳一份私人草稿，回到這裡預覽並確認後才會公開。</p>
      </div>
      {activeAgentDraft?.seed && <p className="status-note">正在補完：{activeAgentDraft.seed.title}</p>}
      {agentIssue && <p role="alert" className="banner banner-error">{agentIssue}</p>}
      {agentMutation.error && <p role="alert" className="banner banner-error">{agentMutation.error}</p>}
      {agentNotice && <p role="status" className="status-note">{agentNotice}</p>}
      {agentSecret ? <div className="skill-upload-secret">
        <label className="field">給 Agent 的私人上傳指令
          <textarea aria-label="給 Agent 的私人上傳指令" ref={agentField} readOnly rows={8} value={agentPrompt} spellCheck={false} autoComplete="off" data-private="true"/>
        </label>
        <p className="field-hint">憑證 {formatIsoLocal(agentSecret.expiresAt)} 到期，只能上傳這份草稿；只貼給你選擇的 Agent。</p>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => void copyAgentInstruction()}>複製給 agent</button>
          <a href={`${SKILL_UPLOAD_GUIDE}/SKILL.md`} target="_blank" rel="noopener noreferrer">公開指南 ↗</a>
          {activeAgentDraft?.status === 'awaiting_upload' && <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => void revokeAgentDraft()}>撤銷這份草稿</button>}
          {draft.repository_url.trim()
            ? <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => { clearAgentState(); setStep('choice'); }}>返回選擇方式</button>
            : <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => { clearAgentState(); setStep('url'); }}>返回</button>}
        </div>
        {agentCopied && <p role="status" className="field-hint">{agentCopied}</p>}
      </div> : <div className="actions">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => activeAgentDraft ? void regrantDraft(activeAgentDraft) : void startAgent()}>{agentMutation.busy ? '產生中…' : activeAgentDraft && !agentIssue ? '產生私人上傳指令' : '重新產生指令'}</button>
        <a href={`${SKILL_UPLOAD_GUIDE}/SKILL.md`} target="_blank" rel="noopener noreferrer">公開指南 ↗</a>
        {activeAgentDraft?.status === 'awaiting_upload' && <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => void revokeAgentDraft()}>撤銷這份草稿</button>}
        {draft.repository_url.trim()
          ? <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => { clearAgentState(); setStep('choice'); }}>返回選擇方式</button>
          : <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => { clearAgentState(); setStep('url'); }}>返回</button>}
      </div>}
      <details className="skill-upload-cli" onToggle={event => { if ((event.currentTarget as HTMLDetailsElement).open) void loadKeys(); }}>
        <summary>更多</summary>
        <div className="stack">
          <section className="stack" aria-label="長期上傳金鑰">
            <h3>長期上傳金鑰</h3>
            <div className="actions"><a className="btn btn-ghost" href="/downloads/freedom-skill-client.tgz" download>下載上傳工具</a><a href={SKILL_UPLOAD_GUIDE} target="_blank" rel="noopener noreferrer">安裝說明 ↗</a></div>
            <pre className="skill-upload-command"><code>{`npm install -g ${origin}/downloads/freedom-skill-client.tgz`}</code></pre>
            <p className="field-hint">金鑰只能建立並上傳你自己的技能草稿；不能送出公開、不能修改帳號，也不是通用 Agent 授權。最長 90 天。</p>
            <p className="field-hint">也可以只用一把 Agent 金鑰：到 <a href="#automation/agent">自動化 → 我的 Agent</a> 建立時勾「分享」，Agent 就能交私人草稿；發布仍由你按。</p>
            <form className="skill-upload-key-form" onSubmit={event => void issueKey(event)}>
              <label className="field">金鑰名稱<input required maxLength={80} value={keyDraft.label} placeholder="例如：我的筆電" onChange={event => setKeyDraft(curr => ({ ...curr, label: event.target.value }))}/></label>
              <label className="field">有效天數<input required type="number" min={1} max={90} value={keyDraft.expires_in_days} onChange={event => setKeyDraft(curr => ({ ...curr, expires_in_days: event.target.value }))}/></label>
              <button className="btn btn-secondary btn-small" disabled={credentials.busy}>建立金鑰</button>
            </form>
            {credentials.error && <p role="alert" className="banner banner-error">{credentials.error}</p>}
            {issuedKey && <div className="skill-upload-secret">
              <label className="field">金鑰：{issuedKey.label}<textarea aria-label={`金鑰：${issuedKey.label}`} ref={keyField} readOnly rows={3} value={issuedKey.token} spellCheck={false} autoComplete="off" data-private="true"/></label>
              <p className="field-hint">只顯示這一次；關閉或重新整理後無法再查看，遺失請撤銷後重建。</p>
              <div className="actions"><button type="button" className="btn btn-secondary btn-small" onClick={() => void copyIssuedKey()}>複製金鑰</button>{keyCopied && <span role="status" className="field-hint">{keyCopied}</span>}</div>
            </div>}
            {keysError && <p role="alert" className="banner banner-error">{keysError} <button type="button" className="btn btn-ghost" onClick={() => void loadKeys()}>重新載入</button></p>}
            <ul className="skill-upload-list" aria-label="已建立的金鑰">{keys.map(key => <li key={key.key_id} className="skill-upload-item">
              <div className="skill-upload-item-copy"><strong>{key.label}</strong><span className="field-hint">{key.revoked_at ? `已撤銷 · ${formatIsoLocal(key.revoked_at)}` : isExpired(key.expires_at) ? `已過期 · ${formatIsoLocal(key.expires_at)}` : `${formatIsoLocal(key.expires_at)} 到期`}</span></div>
              {!key.revoked_at && !isExpired(key.expires_at) && <button type="button" className="btn btn-ghost" disabled={credentials.busy} aria-label={`撤銷金鑰：${key.label}`} onClick={() => void revokeKey(key)}>撤銷金鑰</button>}
            </li>)}</ul>
          </section>
          <section className="skill-upload-chat stack" aria-label="用聊天機器人產生">
            <h3>用聊天機器人產生</h3>
            <p className="field-hint">ChatGPT、Claude、Gemini 網頁版不能替你上傳。把說明貼給它，再把回覆的 JSON 貼回來。說明裡沒有授權，也不含上傳網址。</p>
            {chatTarget?.seed && <div className="skill-upload-target"><p>正在補完：{chatTarget.seed.title}</p><button type="button" className="btn btn-ghost" onClick={() => { setChatTargetId(null); setChatRepo(draft.repository_url.trim()); }}>改為新草稿</button></div>}
            <label className="field">公開儲存庫網址<input value={chatRepo} maxLength={300} placeholder="https://github.com/擁有者/儲存庫" autoComplete="off" spellCheck={false} onChange={event => setChatRepo(event.target.value)}/></label>
            <label className="field">給聊天 AI 的說明<textarea aria-label="給聊天 AI 的說明" readOnly rows={7} value={chatSkillInstruction(chatRepo, instructionSeed(chatTarget?.seed))} spellCheck={false}/></label>
            <div className="actions"><button type="button" className="btn btn-ghost" onClick={() => void copyChat()}>複製給聊天 AI</button>{chatCopied && <span role="status" className="field-hint">{chatCopied}</span>}</div>
            <form className="stack" onSubmit={event => void submitChat(event)}>
              <label className="field">貼上 JSON<textarea aria-label="貼上 JSON" rows={7} value={chatJson} spellCheck={false} placeholder={'貼上聊天 AI 回覆的 JSON。若包在 ```json 裡，整段貼上即可。'} onChange={event => { setChatJson(event.target.value); setChatError(null); }}/></label>
              <div className="actions">
                <button type="button" className="btn btn-ghost" onClick={() => chatFile.current?.click()}>選擇 JSON 檔</button>
                <input ref={chatFile} className="skill-upload-file" type="file" accept=".json,application/json" aria-label="選擇 JSON 檔" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void loadChatFile(file); }}/>
                <button className="btn btn-secondary btn-small" disabled={chatBusy}>{chatBusy ? '正在送出…' : '用這份 JSON 建立草稿'}</button>
              </div>
            </form>
            {chatError && <p role="alert" className="banner banner-error">{chatError}</p>}
          </section>
        </div>
      </details>
    </div> : <form className="stack" onSubmit={event => {
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
      <label className="field">GitHub 專案網址<input name="repository_url" data-manual-source required type="url" maxLength={300} placeholder="https://github.com/你的帳號/專案名稱" value={draft.repository_url} onChange={event => setDraft({ ...draft, repository_url: event.target.value })}/></label>
      <label className="field">作品名稱<input data-manual-source required maxLength={120} placeholder="例如：自動整理會議筆記" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })}/></label>
      <label className="field">一句話介紹<textarea aria-label="一句話介紹" data-manual-source required maxLength={2000} rows={3} placeholder="它能幫誰，解決什麼問題？" value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })}/></label>
      {draft.page ? <SkillSubmissionPageFields value={draft.page} onChange={page => setDraft({ ...draft, page })}/> : <div className="stack"><p className="hint">這是先前保存的介紹，原文會保留；可以補上問題、原理與流程圖。</p><button type="button" className="btn btn-secondary btn-small" onClick={() => setDraft({ ...draft, page: blankSkillPageFields() })}>補齊完整介紹頁</button></div>}
      {draft.page && <label className="field">如何開始使用<textarea aria-label="如何開始使用" required maxLength={3000} rows={4} placeholder="依原作文件寫出第一次操作的方法：開啟哪個入口或執行什麼指令、準備哪些資料、如何看到結果。" value={draft.use_notes} onChange={event => setDraft({ ...draft, use_notes: event.target.value })}/><span className="field-hint">提供可照著操作的真實起步步驟。</span></label>}
      <label className="field">我與作品的關係<select value={draft.relationship} onChange={event => setDraft({ ...draft, relationship: event.target.value as Relationship })}>{Object.entries(relationshipLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><span className="field-hint">推薦別人的工具也可以，原作者與授權都會保留。這是你的聲明，不是作者身分驗證。</span></label>
      <details><summary>補充使用說明與展示網址（選填）</summary><div className="stack">{!draft.page && <label className="field">如何開始使用<textarea aria-label="如何開始使用" maxLength={3000} rows={3} placeholder={defaultNotes} value={draft.use_notes} onChange={event => setDraft({ ...draft, use_notes: event.target.value })}/></label>}<label className="field">展示網址（選填）<input type="url" maxLength={2000} placeholder="https://…" value={draft.demo_url} onChange={event => setDraft({ ...draft, demo_url: event.target.value })}/></label></div></details>
      <p className="hint">預覽不會寫入資料。儲存私人草稿後可重載續寫；尚未儲存的內容只保留在目前登入的頁面中。</p><div className="actions"><button className="btn btn-primary">預覽投稿</button><button className="btn btn-secondary btn-small" data-action="save" formNoValidate disabled={publishUnknown}>儲存私人草稿</button>{!saved && !saveUnknown && !publishUnknown && <button type="button" className="btn btn-ghost" onClick={() => { setError(null); setStep('choice'); }}>返回選擇方式</button>}</div>
      </fieldset>
    </form>}
    {!published && review && (!saved || saved.can_edit) && <div className="actions"><button type="button" className="btn btn-secondary btn-small" disabled={pending || saveUnknown || publishUnknown} onClick={() => void saveDraft()}>儲存私人草稿</button></div>}
    {!published && saved?.payload?.page_content_draft && !review && <p role="status">未完成的介紹已保存為私人草稿；補齊後才能預覽公開。</p>}
    {!published && saved && dirty && <p role="status">目前修改尚未儲存。</p>}
    {saveUnknown && <div className="stack"><p role="alert">儲存結果尚未確認，請先重試原請求；內容與操作識別碼已保留，不會公開。</p><button type="button" className="btn btn-secondary btn-small" disabled={pending} onClick={() => void saveDraft()}>重試儲存私人草稿</button></div>}
    {error && <p className="banner banner-error" role="alert">{error}</p>}
    {upgrade.error && !published && <p className="banner banner-error" role="alert">{upgrade.error}</p>}
    {loadError && <p role="alert">{loadError} <button type="button" className="btn btn-ghost" onClick={() => void loadDrafts()}>重新載入草稿</button></p>}
    {drafts.length > 0 && !review && <section className="work-sharing-advanced stack" aria-label="我的投稿草稿">
      <div className="skill-upload-row">
        <h3>我的投稿草稿（{drafts.length}）</h3>
        <button type="button" className="btn btn-ghost" disabled={pending || loadingDrafts} onClick={() => void loadDrafts()}>重新整理</button>
      </div>
      <ul className="skill-upload-list">{drafts.map(item => {
        const title = item.seed?.title ? `升級：${item.seed.title}` : (item.payload?.title ?? '尚未上傳內容');
        const state = draftStateLabel(item);
        const detail = item.payload?.repository_url ?? item.seed?.repository_url ?? (item.created_at ? formatIsoLocal(item.created_at) : '');
        const isReadyToPreview = item.status === 'ready_for_review' && Boolean(item.payload) && !item.payload?.page_content_draft;
        const actionLabel = isReadyToPreview ? '預覽並公開' : '繼續';
        const onAction = () => {
          if (item.status === 'ready_for_review' && item.payload) {
            resume(item);
            return;
          }
          openAgentForDraft(item, { issueGrant: !item.seed });
        };
        return <li key={item.submission_id} className="skill-upload-item" data-status={item.status}>
          <div className="skill-upload-item-copy">
            <strong>{title}</strong>
            <span className="field-hint">{detail ? `${state} · ${detail}` : state}</span>
          </div>
          <div className="actions">
            <button className="btn btn-secondary btn-small" type="button" disabled={pending || saveUnknown || publishUnknown} aria-label={`${actionLabel}：${title}`} onClick={onAction}>{actionLabel}</button>
          </div>
        </li>;
      })}</ul>
    </section>}
  </section>;
}
