import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {hasLoneSurrogate, type FieldError} from '../../../../contracts/guild-launchpad/v1/config';
import {convertV1, type Config, type ConfigView} from '../../../../contracts/guild-launchpad/v2/config';
import type {GuildBlockLoaders} from '../guild-blocks/runtime';
import type {LaunchpadApplication} from '../../../../contracts/guild-launchpad/v1/module-registry';
import {ApiError, type PortalClient} from '../api';
import {formatIsoLocal} from '../format';
import {BLOCK_LABEL, GuildLaunchpadReading, OPTIONAL, asConfig, type AnnouncementRef, type BookRef, type ConfigProblem} from './GuildLaunchpadReading';

const CONTROL = /[\u0000-\u001F\u007F\u0080-\u009F]/;
const FIELD_MESSAGE: Record<string, string> = {
  too_short: '不能是空白',
  too_long: '超過長度上限',
  version_invalid: '版本號格式不正確',
  control_character: '不能包含換行或控制字元',
  lone_surrogate: '包含不成對的字元',
  invalid_order: '順序必須是 0 到 1000 的不重複整數',
  enabled_locked: '這個區塊不能關閉',
  unsupported_url: '只接受 https:// 開頭、不含帳號密碼的網址',
  unknown_field: '不能包含未定義的欄位',
  block_kind_invalid: '區塊種類不正確',
  block_kind_duplicate: '區塊種類重複',
  block_kind_missing: '缺少必要的區塊',
  block_set_invalid: '版面必須包含七種區塊各一次',
  block_version_unavailable: '這個區塊版本尚未核准或已無法使用',
  application_release_unknown: '這個應用版本尚未核准',
  application_duplicate: '這個應用已在推薦清單中',
  guild_key_mismatch: '公會代碼與網址不一致',
  schema_version_invalid: '配置版本不正確',
  config_too_large: '配置內容過大',
  stable_key_invalid: '識別碼格式不正確',
  capability_duplicate: '能力不能重複',
  capabilities_invalid: '能力清單不正確',
  delegation_recipient_invalid: '授權對象必須是這個公會的有效成員',
  delegation_expiry_invalid: '授權到期時間必須是未來的時間',
};
const CAPABILITY_LABEL: Record<string, string> = {
  'guild.content.edit': '編輯內容', 'guild.config.preview': '預覽配置', 'guild.config.publish': '發布配置',
};

type EditorPanel = 'layout' | 'tools' | 'versions' | 'delegations';
const EDITOR_LABEL: Record<EditorPanel, string> = {layout: '版面與使命', tools: '工具與提示', versions: '版本紀錄', delegations: '成員授權'};
function editorErrorPanel(errors: FieldError[]): EditorPanel | null {
  if (['mission_override', 'blocks'].some(path => fieldHits(errors, path).length)) return 'layout';
  if (['application_refs', 'starter', 'support'].some(path => fieldHits(errors, path).length)) return 'tools';
  if (['principal_id', 'capabilities', 'expires_at'].some(path => fieldHits(errors, path).length)) return 'delegations';
  return null;
}

type RevisionMeta = {revision: string; status: string; source: string; created_at: string; revert_reason: string | null; reverted_from_revision: string | null};
type DelegationRow = {delegation_id: string; principal_id: string; capabilities: string[]; expires_at: string; expired: boolean; status: string; version: string; display_name: string};
type Candidate = {display_name: string; principal_id: string | null};
type LeaderConfig = ConfigView & {
  viewer_can_edit_config: boolean;
  viewer_can_preview_config: boolean;
  viewer_can_publish_config: boolean;
  viewer_can_manage_delegations: boolean;
  revisions: RevisionMeta[];
  config_problem: ConfigProblem;
  delegations?: DelegationRow[];
  delegation_candidates?: Candidate[];
};
type PreviewResult = {effective_config: Config; validation: FieldError[]; preview_data_origin: 'synthetic_fixture'};

function fieldHits(errors: FieldError[], path: string): FieldError[] {
  return errors.filter(error => error.path === path || error.path.endsWith(`.${path}`) || error.path.startsWith(`${path}.`) || error.path.startsWith(`body.${path}.`));
}
function fieldMessage(code: string): string {
  return FIELD_MESSAGE[code] ?? '這個欄位格式不正確';
}
function describedBy(errors: FieldError[], path: string, errorId: string, hintId?: string): string | undefined {
  const ids: string[] = [];
  if (hintId) ids.push(hintId);
  if (fieldHits(errors, path).length) ids.push(errorId);
  return ids.length ? ids.join(' ') : undefined;
}
function looseText(error: FieldError, draft: Config): string {
  const message = fieldMessage(error.code);
  const path = error.path.replace(/^body\./, '');
  const indexed = /^blocks\.(\d+)(?:\.|$)/.exec(path);
  if (indexed) {
    const kind = draft.blocks[Number(indexed[1])]?.kind;
    const label = kind && Object.hasOwn(BLOCK_LABEL, kind) ? `${BLOCK_LABEL[kind]}區塊` : '區塊';
    return `${label}：${message}`;
  }
  if (path === 'blocks' || path.startsWith('blocks.')) return `版面區塊：${message}`;
  const application = /^application_refs\.(\d+)(?:\.|$)/.exec(path);
  if (application) return `推薦應用 ${draft.application_refs[Number(application[1])]?.application_key ?? ''}：${message}`;
  if (path === 'application_refs' || path.startsWith('application_refs.')) return `推薦應用清單：${message}`;
  return message;
}
function blockedReason(value: string): boolean {
  return value.trim().length < 3 || CONTROL.test(value) || hasLoneSurrogate(value);
}

export function GuildLaunchpadEditor({
  client, guildKey, guild, announcements = [], skillBooks = [], applications, blockLoaders, supplierConsoleEnabled = false, hidden, access, shellConfigProblem,
  canAdoptLayout: canAdoptLayoutProp, canLeave, onDraftChange, onDirtyChange, onPublished,
}: {
  client: PortalClient;
  guildKey: string;
  guild?: {name: string; purpose: string};
  announcements?: AnnouncementRef[];
  skillBooks?: BookRef[];
  applications: LaunchpadApplication[];
  blockLoaders: GuildBlockLoaders;
  supplierConsoleEnabled?: boolean;
  hidden: boolean;
  access: {edit: boolean; preview: boolean; publish: boolean; delegate: boolean};
  shellConfigProblem: ConfigProblem;
  canAdoptLayout: (current: Config | null, next: Config) => boolean;
  canLeave: () => boolean;
  onDraftChange?: (config: Config) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onPublished?: () => Promise<void> | void;
}) {
  const [editorPanel, setEditorPanel] = useState<EditorPanel>('layout');
  const [openBlockId, setOpenBlockId] = useState<string | null>(null);
  const editorRoot = useRef<HTMLFormElement>(null);
  const pendingEditorFocus = useRef<EditorPanel | null>(null);
  const [recommendationChoice, setRecommendationChoice] = useState('');
  const [extensionChoice, setExtensionChoice] = useState('');
  const [extensionTitles, setExtensionTitles] = useState<Record<string, string>>({});
  const [configProblem, setConfigProblem] = useState<ConfigProblem>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [saved, setSaved] = useState<ConfigView | null>(null);
  const [savedJson, setSavedJson] = useState('');
  const [pointer, setPointer] = useState('1');
  const [leader, setLeader] = useState<LeaderConfig | null>(null);
  const [status, setStatus] = useState('');
  const [banner, setBanner] = useState('');
  const [conflict, setConflict] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{mode: 'public' | 'member' | 'my_work'; result: PreviewResult} | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [revertTarget, setRevertTarget] = useState<string | null>(null);
  const [revertReason, setRevertReason] = useState('');
  const [grantPrincipal, setGrantPrincipal] = useState('');
  const [grantCaps, setGrantCaps] = useState<string[]>(['guild.content.edit']);
  const [grantExpiry, setGrantExpiry] = useState('');
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const previewDialog = useRef<HTMLDialogElement>(null);
  const publishDialog = useRef<HTMLDialogElement>(null);
  const revertDialog = useRef<HTMLDialogElement>(null);
  const revokeDialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const previewMenu = useRef<HTMLDetailsElement>(null);
  const previewSummary = useRef<HTMLElement>(null);
  const keys = useRef(new Map<string, string>());
  const generation = useRef(0);

  const dirty = Boolean(draft && JSON.stringify(draft) !== savedJson);
  const canPublish = Boolean(saved?.status === 'draft' && saved.config_id && !dirty);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);
  useEffect(() => {
    if (draft) onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  useEffect(() => {
    let live = true;
    void Promise.all(Object.entries(blockLoaders).map(async ([id, load]) => {
      try {return [id, (await load()).title] as const;} catch {return null;}
    })).then(entries => {if (live) setExtensionTitles(Object.fromEntries(entries.filter(entry => entry !== null)));});
    return () => {live = false;};
  }, [blockLoaders]);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const canAdoptLayout = (next: Config) => {
    const allowed = canAdoptLayoutProp(draftRef.current, next);
    if (!allowed) setBanner('版面尚未變更。請回到原工作區確認未儲存內容或待確認的操作，再調整版面。');
    return allowed;
  };

  function remember(view: ConfigView, announce = true) {
    const next = asConfig(guildKey, view.body);
    // Check current mounted editors at adoption: this response may predate pending work.
    if (!canAdoptLayoutProp(draftRef.current, next)) {
      setBanner('最新配置尚未套用。請先確認原操作，再重新載入最新版本。'); setConflict(true);
      return false;
    }
    setDraft(next); setSaved(view); setSavedJson(JSON.stringify(next)); setPointer(view.pointer_version); setErrors([]); setConflict(false);
    if (announce && view.status === 'published' && view.source === 'guild_editor') setStatus(`已發布版本 ${view.revision}`);
    return true;
  }
  function openDialog(dialog: HTMLDialogElement | null, button: HTMLElement | null) {
    opener.current = button; dialog?.showModal();
  }
  function closeDialog(dialog: HTMLDialogElement | null) { dialog?.close(); opener.current?.focus(); }

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    setBanner(''); setRecommendationChoice('');
    const load = async () => {
      const config = await client.get<LeaderConfig>(`/guilds/${guildKey}/launchpad-config`, {signal: controller.signal});
      if (current !== generation.current) return;
      setLeader(config); setConfigProblem(config.config_problem); remember(config);
    };
    void load().catch(error => {
      if (current !== generation.current || (error instanceof ApiError && error.code === 'aborted')) return;
      setBanner(error instanceof Error ? error.message : '啟動台設定暫時無法載入。');
    });
    return () => { controller.abort(); generation.current += 1; };
  }, [client, guildKey]);

  async function reload() {
    if (busy) return;
    setBusy(true); setBanner('');
    try {
      const config = await client.get<LeaderConfig>(`/guilds/${guildKey}/launchpad-config`);
      setLeader(config); setConfigProblem(config.config_problem); remember(config);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : '重新載入失敗。');
    } finally { setBusy(false); }
  }
  async function command<T>(action: string, path: string, body: unknown, ifMatch?: string): Promise<T> {
    const fingerprint = `${action}\n${ifMatch ?? ''}\n${JSON.stringify(body)}`;
    const key = keys.current.get(fingerprint) ?? crypto.randomUUID();
    keys.current.set(fingerprint, key);
    try {
      const result = await client.post<T>(path, body, {idempotencyKey: key, ifMatch});
      keys.current.delete(fingerprint);
      return result;
    } catch (error) {
      if (!(error instanceof ApiError) || !error.network) keys.current.delete(fingerprint);
      throw error;
    }
  }
  function fail(error: unknown) {
    if (error instanceof ApiError && error.status === 412) setConflict(true);
    if (error instanceof ApiError && error.errors?.length) {
      setErrors(error.errors);
      const panel = editorErrorPanel(error.errors);
      // Dialog validation stays in its modal; a late response must not steal focus from another page.
      if (panel && !publishDialog.current?.open && !revertDialog.current?.open && !revokeDialog.current?.open && !previewDialog.current?.open) {
        setEditorPanel(panel);
        pendingEditorFocus.current = !hidden ? panel : null;
      }
    }
    setBanner(error instanceof Error ? error.message : '操作未完成。');
  }
  async function saveDraft() {
    if (!draft || busy) return;
    setBusy(true); setBanner(''); setErrors([]);
    try {
      const view = await command<ConfigView>('draft', `/guilds/${guildKey}/launchpad-config/drafts`, {body: draft}, pointer);
      if (!remember(view, false)) return;
      setStatus(`已儲存草稿版本 ${view.revision}`);
      const config = await client.get<LeaderConfig>(`/guilds/${guildKey}/launchpad-config`);
      setLeader(config); setPointer(view.pointer_version);
    } catch (error) { fail(error); } finally { setBusy(false); }
  }
  async function publish() {
    if (!saved?.config_id || !canPublish || busy) return;
    setBusy(true); setBanner(''); setErrors([]);
    try {
      const view = await command<ConfigView>('publish', `/guilds/${guildKey}/launchpad-config/${saved.config_id}/publish`, {expected_body_sha256: saved.body_sha256}, pointer);
      const adopted = remember(view); closeDialog(publishDialog.current); setConfirmPublish(false);
      if (!adopted) return;
      const config = await client.get<LeaderConfig>(`/guilds/${guildKey}/launchpad-config`);
      setLeader(config); setPointer(view.pointer_version);
      await onPublished?.();
    } catch (error) { fail(error); } finally { setBusy(false); }
  }
  async function revert() {
    if (!revertTarget || busy || blockedReason(revertReason)) return;
    setBusy(true); setBanner(''); setErrors([]);
    try {
      const view = await command<ConfigView>('revert', `/guilds/${guildKey}/launchpad-config/revert`, {to_revision: revertTarget, reason: revertReason.trim()}, pointer);
      const adopted = remember(view); closeDialog(revertDialog.current); setRevertTarget(null); setRevertReason('');
      if (!adopted) return;
      const config = await client.get<LeaderConfig>(`/guilds/${guildKey}/launchpad-config`);
      setLeader(config); setPointer(view.pointer_version);
      await onPublished?.();
    } catch (error) { fail(error); } finally { setBusy(false); }
  }
  async function runPreview(previewMode: 'public' | 'member' | 'my_work', button: HTMLElement | null) {
    if (!draft || busy) return;
    setBusy(true); setBanner(''); setErrors([]);
    try {
      const result = await client.post<PreviewResult>(`/guilds/${guildKey}/launchpad-config/preview`, {body: draft, preview_mode: previewMode});
      setPreview({mode: previewMode, result}); openDialog(previewDialog.current, button);
    } catch (error) { fail(error); } finally { setBusy(false); }
  }
  async function grant() {
    if (!grantPrincipal || !grantExpiry || grantCaps.length === 0 || busy) return;
    const expires = new Date(grantExpiry);
    if (Number.isNaN(expires.getTime())) { setBanner('請選擇授權到期時間。'); return; }
    setBusy(true); setBanner('');
    try {
      await command('grant', `/guilds/${guildKey}/launchpad-delegations`, {principal_id: grantPrincipal, capabilities: grantCaps, expires_at: expires.toISOString()});
      const config = await client.get<LeaderConfig>(`/guilds/${guildKey}/launchpad-config`);
      setLeader(config); setStatus('已新增授權。');
    } catch (error) { fail(error); } finally { setBusy(false); }
  }
  async function revoke() {
    const row = leader?.delegations?.find(item => item.delegation_id === revokeId);
    if (!row || blockedReason(revokeReason) || busy) return;
    setBusy(true); setBanner('');
    try {
      await command('revoke', `/guilds/${guildKey}/launchpad-delegations/${row.delegation_id}/revoke`, {reason: revokeReason.trim()}, row.version);
      const config = await client.get<LeaderConfig>(`/guilds/${guildKey}/launchpad-config`);
      setLeader(config); closeDialog(revokeDialog.current); setRevokeId(null); setRevokeReason(''); setStatus('已撤銷授權。');
    } catch (error) { fail(error); } finally { setBusy(false); }
  }
  function updateBlock(index: number, patch: Partial<Pick<Config['blocks'][number], 'title' | 'enabled' | 'order'>>) {
    const current = draftRef.current;
    if (!current) return;
    const next = {...current, blocks: current.blocks.map((block, blockIndex) => blockIndex === index ? {...block, ...patch} : block)} as Config;
    if (canAdoptLayout(next)) setDraft(next);
  }
  function moveBlock(index: number, delta: number) {
    setDraft(current => {
      if (!current) return current;
      const next = index + delta;
      if (next < 0 || next >= current.blocks.length) return current;
      const blocks = current.blocks.slice();
      const [item] = blocks.splice(index, 1);
      blocks.splice(next, 0, item);
      return {...current, blocks: blocks.map((block, order) => ({...block, order}))} as Config;
    });
  }
  function moveRecommendation(index: number, delta: number) {
    setDraft(current => {
      if (!current || index + delta < 0 || index + delta >= current.application_refs.length) return current;
      const refs = [...current.application_refs];
      const [ref] = refs.splice(index, 1);
      refs.splice(index + delta, 0, ref);
      return {...current, application_refs: refs.map((item, order) => ({...item, order}))};
    });
  }

  const addableApplications = applications.filter(app => !app.eligibility.reason_codes.includes('application_not_available')
    && !draft?.application_refs.some(ref => ref.application_key === app.application_key));
  const selectedApplication = addableApplications.find(app => JSON.stringify([app.application_key, app.release_ref]) === recommendationChoice);
  const activeEditorPanel = (editorPanel === 'versions' && !access.publish) || (editorPanel === 'delegations' && !access.delegate) ? 'layout' : editorPanel;
  useLayoutEffect(() => {
    const panel = pendingEditorFocus.current;
    pendingEditorFocus.current = null;
    if (!panel || hidden || panel !== activeEditorPanel) return;
    editorRoot.current?.querySelector<HTMLElement>(`[data-editor-panel="${panel}"] > h3`)?.focus();
  }, [errors, activeEditorPanel, hidden]);

  const looseErrors = errors.filter(error => !['mission_override', 'starter.title_label', 'starter.objective_hint', 'starter.note_hint', 'support.public_url', 'reason'].some(path => error.path === path || error.path.endsWith(`.${path}`)) && !/blocks\.\d+\.(title|enabled|order)/.test(error.path));

  return <>
    {status && <p className="field-hint guild-launchpad-editor-status" role="status" aria-live="polite">{status}</p>}
    {configProblem && !shellConfigProblem && <p className="banner" role="status">這個公會的啟動台設定版本目前無法顯示，先顯示上一個可用版本。</p>}
    {banner && <p className="banner banner-error" role="alert">{banner}</p>}
    {conflict && <p><button type="button" className="btn btn-ghost" onClick={() => void reload()} disabled={busy}>重新載入最新版本</button></p>}
    {draft && <form ref={editorRoot} hidden={hidden} className="card guild-launchpad-editor" onSubmit={event => event.preventDefault()}>
      <h2>調整版面</h2>
      <nav className="guild-editor-nav" aria-label="公會管理設定">
        {(['layout', 'tools', ...(access.publish ? ['versions'] : []), ...(access.delegate && leader?.delegations ? ['delegations'] : [])] as EditorPanel[]).map(panel => <button key={panel} type="button" className="btn btn-ghost btn-small" aria-pressed={activeEditorPanel === panel} onClick={() => setEditorPanel(panel)}>{EDITOR_LABEL[panel]}</button>)}
      </nav>
      {looseErrors.length > 0 && <ul>{looseErrors.map(error => <li key={`${error.path}:${error.code}`}>{looseText(error, draft)}</li>)}</ul>}
      {errors.some(error => editorErrorPanel([error])) && <div className="guild-editor-errors" role="status"><p>有設定需要修正；可切換到對應區域查看。</p><div className="guild-launchpad-actions">{([...new Set(errors.map(error => editorErrorPanel([error])).filter((panel): panel is EditorPanel => panel !== null))]).filter(panel => panel !== 'delegations' || access.delegate).map(panel => <button key={panel} type="button" className="btn btn-ghost btn-small" onClick={() => setEditorPanel(panel)}>檢查{EDITOR_LABEL[panel]}</button>)}</div></div>}
      <section className="guild-editor-panel" data-editor-panel="layout" hidden={activeEditorPanel !== 'layout'} aria-labelledby="guild-editor-layout-title">
      <h3 id="guild-editor-layout-title" tabIndex={-1}>版面與使命</h3>
      <label className="field" htmlFor="launchpad-mission">公會使命補充
        <input id="launchpad-mission" aria-describedby={describedBy(errors, 'mission_override', 'launchpad-mission-error')} value={draft.mission_override ?? ''} maxLength={1200} onChange={event => {const value = event.target.value.replace(/[\r\n]+/g, ' '); setDraft({...draft, mission_override: value === '' ? null : value});}}/>
      </label>
      <FieldNote id="launchpad-mission-error" errors={errors} path="mission_override"/>
      <fieldset className="fieldset">
        <legend>版面區塊</legend>
        {draft.schema_version === 'guild-launchpad.config/v1' ? <div className="actions">
          <button type="button" className="btn btn-ghost btn-small" disabled={busy || !access.edit} onClick={() => {if (canLeave()) setDraft(convertV1(draft));}}>啟用可組裝版面</button>
        </div> : <div className="stack">
          <label className="field" htmlFor="launchpad-extension">加入公會工具</label>
          <select id="launchpad-extension" value={extensionChoice} disabled={busy || !access.edit} onChange={event => setExtensionChoice(event.target.value)}>
            <option value="">選擇已核准的區塊</option>{Object.entries(extensionTitles).map(([id, title]) => <option key={id} value={id}>{title}</option>)}
          </select>
          <div className="actions"><button type="button" className="btn btn-ghost btn-small" disabled={busy || !access.edit || !Object.hasOwn(extensionTitles, extensionChoice) || draft.blocks.length >= 24} onClick={() => {
            if (!canLeave() || draft.schema_version !== 'guild-launchpad.config/v2' || !Object.hasOwn(extensionTitles, extensionChoice)) return;
            const id = `extension_${crypto.randomUUID()}`;
            setDraft({...draft, blocks: [...draft.blocks, {id, kind: 'extension', extension_id: extensionChoice, title: extensionTitles[extensionChoice], order: draft.blocks.length, enabled: true, settings: {}}]});
            setOpenBlockId(id);
            setExtensionChoice('');
          }}>新增公會區塊</button></div>
        </div>}
        <div className="stack">{draft.blocks.map((block, index) => {
          const name = block.kind === 'extension' ? extensionTitles[block.extension_id] ?? block.title ?? '目前無法使用的公會工具' : BLOCK_LABEL[block.kind];
          const isOpen = openBlockId === block.id;
          return <div key={block.id} className="guild-launchpad-block" role="group" aria-labelledby={`launchpad-block-name-${index}`}>
            <div className="guild-launchpad-block-summary">
              <p id={`launchpad-block-name-${index}`}>{name}</p>
              <span className="badge">{block.enabled ? '已顯示' : '已隱藏'}</span>
              <button type="button" className="btn btn-ghost btn-small" aria-expanded={isOpen} onClick={() => setOpenBlockId(isOpen ? null : block.id)}>{isOpen ? '收合' : '編輯'}</button>
            </div>
            {isOpen && <div className="guild-launchpad-block-details stack">
              <div className="guild-launchpad-block-actions">
                <button type="button" className="btn btn-ghost" aria-label={`上移${name}`} aria-describedby={describedBy(errors, `blocks.${index}.order`, `launchpad-block-order-${index}-error`)} disabled={busy || index === 0} onClick={() => moveBlock(index, -1)}>上移</button>
                <button type="button" className="btn btn-ghost" aria-label={`下移${name}`} aria-describedby={describedBy(errors, `blocks.${index}.order`, `launchpad-block-order-${index}-error`)} disabled={busy || index === draft.blocks.length - 1} onClick={() => moveBlock(index, 1)}>下移</button>
                {(draft.schema_version === 'guild-launchpad.config/v2' || OPTIONAL.has(block.kind)) && <label className="checkbox-row"><input type="checkbox" checked={block.enabled} aria-describedby={describedBy(errors, `blocks.${index}.enabled`, `launchpad-block-enabled-${index}-error`, `launchpad-block-name-${index}`)} onChange={event => updateBlock(index, {enabled: event.target.checked})}/>顯示這個區塊</label>}
                {block.kind === 'extension' && <button type="button" className="btn btn-ghost btn-small" aria-label={`移除這個區塊：${name}`} disabled={busy || !access.edit} onClick={() => {
                  if (canLeave() && draft.schema_version === 'guild-launchpad.config/v2') {
                    setDraft({...draft, blocks: draft.blocks.filter(item => item.id !== block.id).map((item, order) => ({...item, order}))});
                    setOpenBlockId(null);
                  }
                }}>移除這個區塊</button>}
              </div>
              <label className="field" htmlFor={`launchpad-block-title-${index}`}>區塊標題<input id={`launchpad-block-title-${index}`} aria-describedby={describedBy(errors, `blocks.${index}.title`, `launchpad-block-title-${index}-error`)} value={block.title ?? ''} maxLength={120} onChange={event => updateBlock(index, {title: event.target.value === '' ? null : event.target.value})}/></label>
            </div>}
            <FieldNote id={`launchpad-block-order-${index}-error`} errors={errors} path={`blocks.${index}.order`}/>
            <FieldNote id={`launchpad-block-enabled-${index}-error`} errors={errors} path={`blocks.${index}.enabled`}/>
            <FieldNote id={`launchpad-block-title-${index}-error`} errors={errors} path={`blocks.${index}.title`}/>
          </div>;
        })}</div>
      </fieldset>
      </section>
      <section className="guild-editor-panel" data-editor-panel="tools" hidden={activeEditorPanel !== 'tools'} aria-labelledby="guild-editor-tools-title">
      <h3 id="guild-editor-tools-title" tabIndex={-1}>工具與提示</h3>
      <fieldset className="fieldset">
        <legend>推薦應用</legend>
        <p className="field-hint" id="launchpad-recommendations-hint">排在第一個的應用會成為會員看到的主要動作。</p>
        {!draft.blocks.find(block => block.kind === 'applications')?.enabled && <p className="field-hint">應用區塊關閉時，會員看不到推薦應用；主要動作只保留我的工作。</p>}
        <ol className="guild-launchpad-ref-list">{draft.application_refs.map((ref, index) => {
          const label = applications.find(app => app.application_key === ref.application_key && app.release_ref === ref.release_ref)?.display_name ?? `${ref.application_key} · ${ref.release_ref}`;
          const path = `application_refs.${index}`;
          const errorId = `launchpad-recommendation-${index}-error`;
          return <li className="guild-launchpad-ref-row" key={`${ref.application_key}:${ref.release_ref}`} aria-describedby={describedBy(errors, path, errorId)}>
            <span>{label}</span>
            <div className="guild-launchpad-block-actions">
              <button type="button" className="btn btn-ghost" aria-label={`上移${label}`} aria-describedby={describedBy(errors, path, errorId)} disabled={busy || index === 0} onClick={() => moveRecommendation(index, -1)}>上移</button>
              <button type="button" className="btn btn-ghost" aria-label={`下移${label}`} aria-describedby={describedBy(errors, path, errorId)} disabled={busy || index === draft.application_refs.length - 1} onClick={() => moveRecommendation(index, 1)}>下移</button>
              <button type="button" className="btn btn-ghost" aria-label={`移除${label}`} aria-describedby={describedBy(errors, path, errorId)} disabled={busy} onClick={() => setDraft({...draft, application_refs: draft.application_refs.filter((_, at) => at !== index).map((item, order) => ({...item, order}))})}>移除</button>
            </div>
            <FieldNote id={errorId} errors={errors} path={path}/>
          </li>;
        })}</ol>
        <label className="field">加入推薦應用<select value={selectedApplication ? recommendationChoice : ''} aria-describedby="launchpad-recommendations-hint" disabled={busy || draft.application_refs.length >= 30} onChange={event => setRecommendationChoice(event.target.value)}>
          <option value="">選擇應用</option>{addableApplications.map(app => <option key={`${app.application_key}:${app.release_ref}`} value={JSON.stringify([app.application_key, app.release_ref])}>{app.display_name} · {app.release_ref}</option>)}
        </select></label>
        <div className="guild-launchpad-actions"><button type="button" className="btn btn-ghost" disabled={busy || !selectedApplication || draft.application_refs.length >= 30} onClick={() => {
          if (!selectedApplication || draft.application_refs.length >= 30) return;
          setDraft({...draft, application_refs: [...draft.application_refs, {application_key: selectedApplication.application_key, release_ref: selectedApplication.release_ref, order: draft.application_refs.length}]});
          setRecommendationChoice('');
        }}>加入推薦</button></div>
      </fieldset>
      <fieldset className="fieldset">
        <legend>起步提示</legend>
        <label className="field" htmlFor="launchpad-starter-title">標題<input id="launchpad-starter-title" aria-describedby={describedBy(errors, 'starter.title_label', 'launchpad-starter-title-error')} value={draft.starter.title_label} maxLength={480} onChange={event => setDraft({...draft, starter: {...draft.starter, title_label: event.target.value}})}/></label>
        <FieldNote id="launchpad-starter-title-error" errors={errors} path="starter.title_label"/>
        <label className="field" htmlFor="launchpad-starter-objective">目標<input id="launchpad-starter-objective" aria-describedby={describedBy(errors, 'starter.objective_hint', 'launchpad-starter-objective-error')} value={draft.starter.objective_hint} maxLength={480} onChange={event => setDraft({...draft, starter: {...draft.starter, objective_hint: event.target.value}})}/></label>
        <FieldNote id="launchpad-starter-objective-error" errors={errors} path="starter.objective_hint"/>
        <label className="field" htmlFor="launchpad-starter-note">筆記<input id="launchpad-starter-note" aria-describedby={describedBy(errors, 'starter.note_hint', 'launchpad-starter-note-error')} value={draft.starter.note_hint} maxLength={480} onChange={event => setDraft({...draft, starter: {...draft.starter, note_hint: event.target.value}})}/></label>
        <FieldNote id="launchpad-starter-note-error" errors={errors} path="starter.note_hint"/>
      </fieldset>
      <fieldset className="fieldset">
        <legend>協助連結</legend>
        <label className="field">協助類型<select value={draft.support.kind} onChange={event => setDraft({...draft, support: {...draft.support, kind: event.target.value as Config['support']['kind']}})}><option value="platform_help">平台說明</option><option value="guild_public_contact">公會公開聯絡</option></select></label>
        <label className="field" htmlFor="launchpad-support-url">公開網址<input id="launchpad-support-url" aria-describedby={describedBy(errors, 'support.public_url', 'launchpad-support-url-error')} value={draft.support.public_url ?? ''} maxLength={2048} placeholder="https://" onChange={event => setDraft({...draft, support: {...draft.support, public_url: event.target.value === '' ? null : event.target.value}})}/></label>
        <FieldNote id="launchpad-support-url-error" errors={errors} path="support.public_url"/>
      </fieldset>
      </section>
      <div className="guild-editor-savebar">
      <p className="field-hint">{dirty ? '有尚未儲存的修改。' : saved?.status === 'draft' ? '目前為已儲存草稿，尚未發布。' : saved?.status === 'published' ? '目前顯示已發布版本。' : '請先儲存草稿。'}</p>
      {!canPublish && access.publish && <p className="field-hint">{saved?.status === 'draft' && dirty ? '尚未儲存的修改不會進入這個版本。' : '請先儲存草稿'}</p>}
      <div className="guild-launchpad-actions">
        {access.preview && <details ref={previewMenu} className="guild-launchpad-preview-menu">
          <summary ref={previewSummary} className="btn btn-ghost">預覽</summary>
          <div className="guild-launchpad-preview-options">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => {if (previewMenu.current) previewMenu.current.open = false; void runPreview('public', previewSummary.current);}}>預覽公開</button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => {if (previewMenu.current) previewMenu.current.open = false; void runPreview('member', previewSummary.current);}}>預覽會員</button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => {if (previewMenu.current) previewMenu.current.open = false; void runPreview('my_work', previewSummary.current);}}>預覽我的工作</button>
          </div>
        </details>}
        {access.edit && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void saveDraft()}>儲存草稿</button>}
        {access.publish && <button type="button" className="btn btn-primary" disabled={busy || !canPublish} onClick={event => { setConfirmPublish(true); openDialog(publishDialog.current, event.currentTarget); }}>發布</button>}
      </div>
      </div>
      {access.publish && leader && <section className="guild-editor-panel" data-editor-panel="versions" hidden={activeEditorPanel !== 'versions'} aria-labelledby="guild-editor-versions-title">
        <h3 id="guild-editor-versions-title" tabIndex={-1}>版本紀錄</h3>
        <p className="field-hint">回復版本會重新發布；先確認內容，再填寫回復原因。</p>
        <fieldset className="fieldset">
        <legend>版本</legend>
        {leader.revisions.length === 0 ? <p>還沒有任何版本。</p> : <ul>{leader.revisions.map(revision => <li key={revision.revision}>版本 {revision.revision} · {revision.status === 'draft' ? '草稿' : revision.status === 'published' ? '已發布' : '已取代'}{revision.revert_reason ? ` · 回復自版本 ${revision.reverted_from_revision}：${revision.revert_reason}` : ''}
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={event => { setRevertTarget(revision.revision); setRevertReason(''); openDialog(revertDialog.current, event.currentTarget); }}>回復到此版本</button>
        </li>)}</ul>}
      </fieldset></section>}
      {access.delegate && leader?.delegations && <section className="guild-editor-panel" data-editor-panel="delegations" hidden={activeEditorPanel !== 'delegations'} aria-labelledby="guild-editor-delegations-title">
        <h3 id="guild-editor-delegations-title" tabIndex={-1}>成員授權</h3>
        <p className="field-hint">選擇成員、可操作項目與到期時間。這裡的授權不會增加其他業務空間權限。</p>
        <fieldset className="fieldset">
        <legend>授權</legend>
        <label className="field">成員<select value={grantPrincipal} onChange={event => setGrantPrincipal(event.target.value)}><option value="">選擇成員</option>{(leader.delegation_candidates ?? []).map((candidate, index) => <option key={candidate.principal_id ?? `missing-principal-${index}`} value={candidate.principal_id ?? ''} disabled={!candidate.principal_id}>{candidate.display_name}{candidate.principal_id ? '' : '（尚未建立身份，無法授權）'}</option>)}</select></label>
        <div>{Object.entries(CAPABILITY_LABEL).map(([capability, label]) => <label key={capability} className="checkbox-row"><input type="checkbox" checked={grantCaps.includes(capability)} onChange={event => setGrantCaps(current => event.target.checked ? [...current, capability] : current.filter(item => item !== capability))}/>{label}</label>)}</div>
        <label className="field">到期時間<input type="datetime-local" value={grantExpiry} onChange={event => setGrantExpiry(event.target.value)}/></label>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void grant()}>授權</button>
        {leader.delegations.length === 0 ? <p>目前沒有授權。</p> : <ul>{leader.delegations.map(row => <li key={row.delegation_id}>{row.display_name} · {row.capabilities.map(capability => CAPABILITY_LABEL[capability] ?? capability).join('、')} · <time dateTime={row.expires_at}>{formatIsoLocal(row.expires_at)}</time>{row.expired ? ' · 已過期' : ''}
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={event => { setRevokeId(row.delegation_id); setRevokeReason(''); openDialog(revokeDialog.current, event.currentTarget); }}>撤銷</button>
        </li>)}</ul>}
      </fieldset></section>}
    </form>}
    <dialog ref={previewDialog} aria-labelledby="launchpad-preview-title" onClose={() => opener.current?.focus()}>
      <h2 id="launchpad-preview-title">合成預覽</h2>
      {preview?.mode === 'my_work' && <p>預覽不讀取會員的業務空間。</p>}
      <p>預覽資料來源：{preview?.result.preview_data_origin === 'synthetic_fixture' ? '合成資料' : ''}</p>
      {preview && <GuildLaunchpadReading
        guild={guild ?? {name: guildKey, purpose: ''}}
        config={preview.result.effective_config}
        announcements={preview.mode === 'public' ? [] : announcements}
        skillBooks={skillBooks}
        applications={applications}
        visitor={preview.mode === 'public'}
        mode={preview.mode === 'public' ? 'public' : 'member'}
        client={client}
        guildKey={guildKey}
        registerLeave={() => {}}
        registerPendingLeave={() => {}}
        canLeave={() => false}
        canNavigate={() => false}
        blockLoaders={blockLoaders}
        supplierConsoleEnabled={supplierConsoleEnabled}
        activeSection="information"
        selectSection={() => {}}
        preview
      />}
      <button type="button" className="btn btn-ghost" onClick={() => closeDialog(previewDialog.current)}>關閉</button>
    </dialog>
    <dialog ref={publishDialog} aria-labelledby="launchpad-publish-title" onClose={() => { setConfirmPublish(false); opener.current?.focus(); }}>
      <h2 id="launchpad-publish-title">確認發布</h2>
      <p>發布後，訪客與會員會看到這個已儲存的草稿。</p>
      <div className="guild-launchpad-actions"><button type="button" className="btn btn-primary" disabled={busy || !confirmPublish} onClick={() => void publish()}>確認發布</button><button type="button" className="btn btn-ghost" onClick={() => closeDialog(publishDialog.current)}>取消</button></div>
    </dialog>
    <dialog ref={revertDialog} aria-labelledby="launchpad-revert-title" onClose={() => opener.current?.focus()}>
      <h2 id="launchpad-revert-title">確認回復</h2>
      <p>回復會建立一個新的已發布版本，沿用版本 {revertTarget} 的內容。</p>
      <label className="field">回復原因<input aria-describedby={describedBy(errors, 'reason', 'launchpad-revert-reason-error', 'launchpad-revert-reason-hint')} value={revertReason} maxLength={1000} onChange={event => setRevertReason(event.target.value)}/></label>
      <p className="field-hint" id="launchpad-revert-reason-hint">至少 3 個字。</p>
      <FieldNote id="launchpad-revert-reason-error" errors={errors} path="reason"/>
      <div className="guild-launchpad-actions"><button type="button" className="btn btn-primary" disabled={busy || blockedReason(revertReason)} onClick={() => void revert()}>確認回復</button><button type="button" className="btn btn-ghost" onClick={() => closeDialog(revertDialog.current)}>取消</button></div>
    </dialog>
    <dialog ref={revokeDialog} aria-labelledby="launchpad-revoke-title" onClose={() => opener.current?.focus()}>
      <h2 id="launchpad-revoke-title">撤銷授權</h2>
      <label className="field">撤銷原因<input aria-describedby={describedBy(errors, 'reason', 'launchpad-revoke-reason-error')} value={revokeReason} maxLength={1000} onChange={event => setRevokeReason(event.target.value)}/></label>
      <FieldNote id="launchpad-revoke-reason-error" errors={errors} path="reason"/>
      <div className="guild-launchpad-actions"><button type="button" className="btn btn-primary" disabled={busy || blockedReason(revokeReason)} onClick={() => void revoke()}>確認撤銷</button><button type="button" className="btn btn-ghost" onClick={() => closeDialog(revokeDialog.current)}>取消</button></div>
    </dialog>
  </>;
}

function FieldNote({errors, path, id}: {errors: FieldError[]; path: string; id: string}) {
  const hits = fieldHits(errors, path);
  if (!hits.length) return null;
  return <p id={id} className="banner banner-error" role="alert">{hits.map(error => fieldMessage(error.code)).join('；')}</p>;
}
