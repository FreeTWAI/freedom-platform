import {useCallback, useEffect, useId, useRef, useState, type FormEvent} from 'react'
import {accessAwareFetch} from '../access-fetch'
import {ApiError, type PortalClient} from '../api'
import {SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS, SERVICE_COVER_INPUT_BYTES, SERVICE_LIMIT, SERVICE_MODE_LABELS, SERVICE_MODES, validateMemberService, type ServiceCategory, type ServiceMode} from '../../../../packages/shared/member-service'
import {MemberAvatar} from './MemberAvatar'
import {PromotionShare} from './PromotionShare'
import './MemberServices.css'

type Contact = {label: string; url: string}
type Service = {
  service_id: string; title: string; category: ServiceCategory; category_label: string; summary: string
  description: string | null; price_text: string | null; area_text: string | null; service_mode: ServiceMode
  contacts: Contact[]; state: string; aggregate_version: number; cover_url: string | null
  owner: {user_id: string; display_name: string; avatar_url: string | null}
  public_path: string; total_points: number; mine: boolean; can_hide: boolean
}
type Page = {items: Service[]; next_cursor: string | null; can_hide: boolean}
type Mine = {items: Service[]; limit: number}
type Draft = {title: string; category: ServiceCategory | ''; summary: string; description: string; price_text: string; area_text: string; service_mode: ServiceMode; contacts: Contact[]}
type Issue = {field: string; message: string}
// A write whose outcome is unknown is retried as the same operation: same key, body or File, If-Match and target.
type SaveOperation = {stage: 'save'; method: 'POST' | 'PUT'; path: string; body: unknown; key: string; version: number | null; file: File | null; coverKey: string}
type CoverOperation = {stage: 'cover'; service: Service; file: File; key: string; version: number}
type Operation = SaveOperation | CoverOperation

const BLANK: Draft = {title: '', category: '', summary: '', description: '', price_text: '', area_text: '', service_mode: 'online', contacts: [{label: '', url: ''}]}
const draftOf = (service: Service): Draft => ({title: service.title, category: service.category, summary: service.summary, description: service.description ?? '', price_text: service.price_text ?? '', area_text: service.area_text ?? '', service_mode: service.service_mode, contacts: service.contacts.map(row => ({...row}))})
// An unsent form closed in this page is kept per target ('new' or a service id) until it is saved or cleared.
type Kept = {draft: Draft; file: File | null; version: number | null; generation: number}
type FormIdentity = {readonly target: string; readonly generation: number}

// No response, a 5xx or an unreadable success body leaves a write's outcome unknown.
const unknownOutcome = (cause: unknown) => !(cause instanceof ApiError) || cause.network
const conflictOf = (cause: unknown) => cause instanceof ApiError && cause.code === 'version_conflict'
// Rejections the command itself returns after its receipt lookup. A retry of an operation whose earlier outcome is
// unknown is only settled by these or by success; anything earlier (429, session, 5xx, no response) keeps the operation.
const DECIDED = new Set(['version_conflict', 'validation_failed', 'idempotency_conflict', 'member_service_limit', 'not_found'])
const settled = (cause: unknown, retried: boolean) => cause instanceof ApiError && !cause.network && cause.status !== 429 && (!retried || DECIDED.has(cause.code ?? ''))

function Cover({service}: {service: Service}) {
  const [broken, setBroken] = useState(false)
  if (!service.cover_url || broken) return <div className="service-placeholder" data-category={service.category}><span>{service.category_label}</span></div>
  return <img className="service-cover" src={service.cover_url} alt="" width={1200} height={675} onError={() => setBroken(true)}/>
}

export function MemberServices({client}: {client: PortalClient}) {
  const [category, setCategory] = useState('')
  const [items, setItems] = useState<Service[]>([])
  const [mine, setMine] = useState<Service[]>([])
  const [limit, setLimit] = useState(SERVICE_LIMIT)
  const [cursor, setCursor] = useState<string | null>(null)
  const [canHide, setCanHide] = useState(false)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Service | null>(null)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const kept = useRef(new Map<string, Kept>()), origin = useRef('new'), generation = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const [restored, setRestored] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [issues, setIssues] = useState<Issue[]>([])
  const [pending, setPending] = useState<Operation | null>(null)
  const [conflict, setConflict] = useState<'save' | 'cover' | null>(null)
  const confirmationId = useId()
  const [confirming, setConfirming] = useState<{serviceId: string; origin: 'mine' | 'card'; action: 'delete' | 'hide'} | null>(null)
  const issue = (field: string) => issues.find(item => item.field === field)?.message ?? ''
  const refreshMine = useCallback(async () => {
    const page = await client.get<Mine>('/member-services/mine')
    setMine(page.items)
    setLimit(page.limit)
    return page.items
  }, [client])
  const load = useCallback(async (nextCategory: string, nextCursor?: string) => {
    if (nextCursor) setMore(true)
    else setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams()
      if (nextCategory) query.set('category', nextCategory)
      if (nextCursor) query.set('cursor', nextCursor)
      const page = await client.get<Page>(`/member-services${query.size ? `?${query}` : ''}`)
      setItems(current => nextCursor ? [...current, ...page.items] : page.items)
      setCursor(page.next_cursor)
      setCanHide(page.can_hide)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '服務暫時無法載入。') }
    finally { setLoading(false); setMore(false) }
  }, [client])
  useEffect(() => { void load(category) }, [load, category])
  useEffect(() => { void refreshMine().catch(() => {}) }, [refreshMine])
  function keep() {
    if (!formOpen || pending) return
    const base = editing ? draftOf(editing) : BLANK
    if (file || JSON.stringify(draft) !== JSON.stringify(base)) kept.current.set(origin.current, {draft, file, version: editing?.aggregate_version ?? null, generation: generation.current})
    else kept.current.delete(origin.current)
  }
  function openCreate() {
    keep()
    const saved = kept.current.get('new')
    generation.current++; if (fileInput.current) fileInput.current.value = ''
    origin.current = 'new'; setEditing(null); setDraft(saved?.draft ?? BLANK); setFile(saved?.file ?? null); setRestored(Boolean(saved))
    setIssues([]); setError(''); setFormOpen(true)
  }
  function openEdit(service: Service) {
    keep()
    // A draft for an older version of this service is dropped rather than applied to newer content.
    const saved = kept.current.get(service.service_id), current = saved?.version === service.aggregate_version ? saved : undefined
    if (saved && !current) kept.current.delete(service.service_id)
    generation.current++; if (fileInput.current) fileInput.current.value = ''
    origin.current = service.service_id; setEditing(service); setDraft(current?.draft ?? draftOf(service)); setFile(current?.file ?? null); setRestored(Boolean(current))
    setIssues([]); setError(''); setFormOpen(true)
  }
  function clearDraft() {
    if (fileInput.current) fileInput.current.value = ''
    kept.current.delete(origin.current); setDraft(editing ? draftOf(editing) : BLANK); setFile(null); setRestored(false); setIssues([])
  }
  function patch(partial: Partial<Draft>) { setDraft(current => ({...current, ...partial})) }
  async function write(method: 'PUT' | 'DELETE', path: string, body: BodyInit, headers: Record<string, string>, fallback: string) {
    if (!client.csrfToken) throw new ApiError({message: '登入狀態已變更，請重新整理。', status: 400})
    let response: Response
    try {
      response = await accessAwareFetch(`/api/v1${path}`, {method, credentials: 'same-origin', body, headers: {Accept: 'application/json', 'X-CSRF-Token': client.csrfToken, ...headers}})
    } catch { throw new ApiError({message: '沒有收到伺服器回應，尚未確認結果。', status: 0, network: true}) }
    const payload = await response.json().catch(() => null) as (Service & {detail?: string; code?: string}) | null
    if (!response.ok) throw new ApiError({message: payload?.detail || fallback, status: response.status, code: payload?.code, network: response.status >= 500})
    if (!payload) throw new ApiError({message: '回應未完整收到，尚未確認結果。', status: response.status, network: true})
    return payload
  }
  function send(method: 'PUT' | 'DELETE', path: string, body: unknown, version: number, key: string = crypto.randomUUID()) {
    return write(method, path, JSON.stringify(body), {'Content-Type': 'application/json', 'Idempotency-Key': key, 'If-Match': `"${version}"`}, '服務未能更新。')
  }
  function uploadCover(op: CoverOperation) {
    return write('PUT', `/member-services/${op.service.service_id}/cover`, op.file, {'Content-Type': op.file.type, 'Idempotency-Key': op.key, 'If-Match': `"${op.version}"`}, '封面未能換上。')
  }
  function dropSavedDraft(identity: FormIdentity, target = identity.target) {
    if (kept.current.get(target)?.generation === identity.generation) kept.current.delete(target)
  }
  async function finish(created: boolean, identity: FormIdentity, target: string) {
    dropSavedDraft(identity); dropSavedDraft(identity, target)
    // A response belongs to the form that submitted it, even if another draft is now open.
    if (generation.current === identity.generation) {
      setRestored(false); setPending(null); setFormOpen(false); setFile(null)
    }
    setNotice(created ? '已新增服務。' : '已更新服務。')
    await Promise.all([load(category), refreshMine()])
  }
  function closeForm() {
    // Abandoning an operation whose outcome is unknown also drops its draft, so a later save cannot repeat it under a new key.
    if (pending) kept.current.delete(origin.current)
    else keep()
    generation.current++
    setFormOpen(false); setIssues([]); setConflict(null); setRestored(false)
    if (pending) { setPending(null); void Promise.all([load(category), refreshMine().catch(() => null)]) }
  }
  async function reloadLatest() {
    const keep = conflict === 'cover' ? file : null, id = editing?.service_id
    setSaving(true)
    try {
      let items: Service[]
      try { items = await refreshMine() }
      catch {
        // A failed read is not proof that the service is gone: keep the form, the conflict and the chosen file.
        setError('暫時無法讀取最新內容。你的輸入和選好的圖片都還在；請稍後再按「載入最新內容」。')
        return
      }
      setConflict(null)
      void load(category)
      const latest = items.find(item => item.service_id === id)
      if (!latest) { setFormOpen(false); setError('這項服務已不在你的服務清單裡，可能已被刪除或隱藏。'); return }
      openEdit(latest)
      setFile(keep)
    } finally { setSaving(false) }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    let op = pending
    if (!op) {
      const payload = {...draft, category: draft.category, contacts: draft.contacts.map(row => ({label: row.label, url: row.url}))}
      const parsed = validateMemberService(payload)
      if (!parsed.ok) { setIssues(parsed.issues); setError(parsed.issues[0]?.message || '請修正標示的欄位。'); return }
      op = {stage: 'save', method: editing ? 'PUT' : 'POST', path: editing ? `/member-services/${editing.service_id}` : '/member-services', body: parsed.value,
        key: crypto.randomUUID(), version: editing ? editing.aggregate_version : null, file, coverKey: crypto.randomUUID()}
    }
    const identity: FormIdentity = {target: origin.current, generation: generation.current}
    const current = () => generation.current === identity.generation
    keep()
    const created = op.stage === 'save' && op.method === 'POST', retried = pending
    setIssues([]); setSaving(true); setError(''); setNotice(''); setConflict(null)
    try {
      if (op.stage === 'save') {
        const save = op
        let saved: Service
        try {
          saved = save.method === 'PUT'
            ? await send('PUT', save.path, save.body, save.version!, save.key)
            : await client.post<Service>(save.path, save.body, {idempotencyKey: save.key})
        } catch (cause) {
          const open = !settled(cause, retried?.stage === 'save')
          if (!current()) {
            // Closing an in-flight unknown write abandons its draft, just like 放棄並關閉.
            if (open) dropSavedDraft(identity)
            await Promise.all([load(category), refreshMine().catch(() => null)])
            return
          }
          setPending(open ? save : null)
          if (conflictOf(cause)) setConflict('save')
          setError(open ? `${unknownOutcome(cause) ? '' : (cause as Error).message}儲存結果還沒確認。${unknownOutcome(cause) ? '' : '稍後'}按「重試儲存」會用同一份內容和同一個請求再送一次，不會重複建立，也不會覆蓋別人的修改。`
            : conflictOf(cause) ? '這項服務已在其他地方更新，你這次的修改沒有存入。輸入還在表單裡；需要的內容先複製，再按「載入最新內容」。'
            : cause instanceof Error ? cause.message : '服務未能儲存。')
          return
        }
        // Once text is committed, any cover recovery belongs to this service, never to 'new'.
        const retained = kept.current.get(identity.target)
        if (retained?.generation === identity.generation) {
          kept.current.delete(identity.target)
          kept.current.set(saved.service_id, {...retained, version: saved.aggregate_version})
        }
        if (current()) { origin.current = saved.service_id; setEditing(saved) }
        if (!save.file) { await finish(created, identity, saved.service_id); return }
        op = {stage: 'cover', service: saved, file: save.file, key: save.coverKey, version: saved.aggregate_version}
      }
      const cover = op
      try { await uploadCover(cover) }
      catch (cause) {
        const open = !settled(cause, retried?.stage === 'cover')
        if (current()) setPending(open ? cover : null)
        else if (open) dropSavedDraft(identity, cover.service.service_id)
        await Promise.all([load(category), refreshMine().catch(() => null)])
        if (!current()) return
        if (conflictOf(cause)) setConflict('cover')
        setError(open ? `${unknownOutcome(cause) ? '' : (cause as Error).message}封面上傳結果還沒確認，服務已儲存。${unknownOutcome(cause) ? '' : '稍後'}按「重試封面」會用同一張圖片和同一個請求再送一次。`
          : conflictOf(cause) ? '這項服務已在其他地方更新，這次的封面沒有換上。你選的圖片還在；按「載入最新內容」確認後，再儲存一次即可換上。'
          : `${cause instanceof Error ? cause.message : '封面未能換上。'}服務已儲存。`)
        return
      }
      await finish(created, identity, cover.service.service_id)
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : '服務未能儲存。') }
    finally { setSaving(false) }
  }
  async function act(service: Service, action: 'pause' | 'resume' | 'hide' | 'delete' | 'remove-cover') {
    setSaving(true); setError('')
    try {
      if (action === 'delete') await send('DELETE', `/member-services/${service.service_id}`, {}, service.aggregate_version)
      else if (action === 'remove-cover') await client.post(`/member-services/${service.service_id}/cover/remove`, {}, {ifMatch: service.aggregate_version})
      else await client.post(`/member-services/${service.service_id}/${action}`, {}, {ifMatch: service.aggregate_version})
      setConfirming(null)
      setNotice(action === 'delete' ? '服務已刪除。' : action === 'hide' ? '服務已隱藏。' : action === 'pause' ? '服務已暫停。' : action === 'resume' ? '服務已恢復。' : '封面已移除。')
      if (action === 'remove-cover' && editing?.service_id === service.service_id) setEditing({...service, cover_url: null, aggregate_version: service.aggregate_version + 1})
      await Promise.all([load(category), refreshMine()])
    } catch (cause) { setError(cause instanceof Error ? cause.message : '服務未能更新。') }
    finally { setSaving(false) }
  }
  function actions(service: Service, origin: 'mine' | 'card') {
    const paused = service.state === 'paused'
    const confirmation = confirming?.serviceId === service.service_id && confirming.origin === origin ? confirming.action : null
    const controlId = `${confirmationId}-${origin}-${service.service_id}`
    function cancel(action: 'delete' | 'hide') {
      setConfirming(null)
      document.getElementById(`${controlId}-${action}`)?.focus()
    }
    return <div className="service-actions">
      {!paused && <a className="btn btn-ghost" href={service.public_path} target="_blank" rel="noopener noreferrer">服務頁 ↗</a>}
      {!paused && <PromotionShare client={client} kind="member_service" target={service.service_id} title={service.title} text={`${service.title}｜${service.owner.display_name}：${service.summary}`} label="分享"/>}
      {service.mine && <button type="button" className="btn btn-ghost" disabled={saving || pending !== null} onClick={() => openEdit(service)}>編輯</button>}
      {service.mine && !paused && <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => void act(service, 'pause')}>暫停</button>}
      {service.mine && paused && <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => void act(service, 'resume')}>恢復</button>}
      {service.mine && <button id={`${controlId}-delete`} type="button" className="btn btn-ghost" disabled={saving} aria-expanded={confirmation === 'delete'} aria-controls={`${controlId}-delete-confirmation`} onClick={() => setConfirming({serviceId: service.service_id, origin, action: 'delete'})}>刪除</button>}
      {service.mine && <div id={`${controlId}-delete-confirmation`} hidden={confirmation !== 'delete'} role="group" aria-label={`刪除「${service.title}」`}>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void act(service, 'delete')}>確定刪除</button>
        <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => cancel('delete')}>取消</button>
      </div>}
      {canHide && <button id={`${controlId}-hide`} type="button" className="btn btn-ghost" disabled={saving} aria-expanded={confirmation === 'hide'} aria-controls={`${controlId}-hide-confirmation`} aria-describedby={confirmation === 'hide' ? `${controlId}-warning` : undefined} onClick={() => setConfirming({serviceId: service.service_id, origin, action: 'hide'})}>隱藏</button>}
      {canHide && <div id={`${controlId}-hide-confirmation`} hidden={confirmation !== 'hide'} role="group" aria-label={`隱藏「${service.title}」`} aria-describedby={`${controlId}-warning`}>
        <p id={`${controlId}-warning`} className="field-hint service-confirmation-note">隱藏後服務主人也看不到、無法編輯，分享連結會失效，且目前無法復原。</p>
        <button type="button" className="btn btn-ghost" disabled={saving} aria-describedby={`${controlId}-warning`} onClick={() => void act(service, 'hide')}>確定隱藏</button>
        <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => cancel('hide')}>取消</button>
      </div>}
    </div>
  }
  return <section className="service-zone stack" aria-label="社員服務分享區">
    <p className="service-intro">社員的本業服務都在這裡。看到適合朋友的服務，就用你的連結分享出去；每次點擊都算你的業務推廣分數。</p>
    <section className="card service-mine" data-guide-anchor="services:mine" aria-label="我的服務">
      <div className="service-mine-head">
        <h2>我的服務 <span className="service-count">{mine.length}／{limit}</span></h2>
        <button type="button" data-guide-anchor="services:create" className={formOpen ? 'btn btn-ghost' : 'btn btn-primary'} disabled={!formOpen && mine.length >= limit} onClick={() => { if (formOpen) closeForm(); else openCreate(); }}>{formOpen ? '關閉表單' : '新增服務'}</button>
      </div>
      {!formOpen && mine.length >= limit && <p className="muted">已達 {limit} 項上限（含暫停中的服務）。刪除一項後才能再新增。</p>}
      {mine.length === 0 ? <p className="muted">你還沒有建立服務。</p> : <ul>
        {mine.map(service => <li className="service-mine-row" key={service.service_id}>
          <span className="service-mine-title">{service.title}</span>
          {service.state === 'paused' && <span className="service-state">暫停中</span>}
          {actions(service, 'mine')}
        </li>)}
      </ul>}
    </section>
    {formOpen && <form className="card service-form" onSubmit={event => void submit(event)} aria-busy={saving}>
      <h2>{editing ? '編輯服務' : '新增服務'}</h2>
      <p className="service-public-note">服務頁會公開，任何拿到連結的人都看得到。</p>
      {restored && !pending && <p className="field-hint service-draft-note" role="status">已還原上次未送出的內容，還沒有儲存。<button type="button" className="btn btn-ghost btn-small" disabled={saving} onClick={clearDraft}>清除重填</button></p>}
      <fieldset className="service-form-fields" disabled={pending !== null}>
      <label className="field">標題<input required maxLength={80} value={draft.title} aria-invalid={Boolean(issue('title'))} onChange={event => patch({title: event.target.value})}/>{issue('title') && <span className="field-error">{issue('title')}</span>}</label>
      <label className="field">分類<select required value={draft.category} aria-invalid={Boolean(issue('category'))} onChange={event => patch({category: event.target.value as ServiceCategory | ''})}>
        <option value="">請選擇</option>
        {SERVICE_CATEGORIES.map(id => <option key={id} value={id}>{SERVICE_CATEGORY_LABELS[id]}</option>)}
      </select>{issue('category') && <span className="field-error">{issue('category')}</span>}</label>
      <label className="field">簡介<textarea required maxLength={160} rows={2} value={draft.summary} aria-invalid={Boolean(issue('summary'))} onChange={event => patch({summary: event.target.value})}/>{issue('summary') && <span className="field-error">{issue('summary')}</span>}</label>
      <label className="field">說明<textarea maxLength={2000} rows={5} value={draft.description} aria-invalid={Boolean(issue('description'))} onChange={event => patch({description: event.target.value})}/>{issue('description') && <span className="field-error">{issue('description')}</span>}</label>
      <div className="service-form-split">
        <label className="field">價格<input maxLength={60} value={draft.price_text} aria-invalid={Boolean(issue('price_text'))} onChange={event => patch({price_text: event.target.value})} placeholder="每堂 NT$800 起"/>{issue('price_text') && <span className="field-error">{issue('price_text')}</span>}</label>
        <label className="field">地區<input maxLength={60} value={draft.area_text} aria-invalid={Boolean(issue('area_text'))} onChange={event => patch({area_text: event.target.value})} placeholder="台北・線上"/>{issue('area_text') && <span className="field-error">{issue('area_text')}</span>}</label>
      </div>
      <fieldset className="service-modes"><legend>服務方式</legend>
        {SERVICE_MODES.map(mode => <label key={mode}><input type="radio" name="service-mode" checked={draft.service_mode === mode} onChange={() => patch({service_mode: mode})}/>{SERVICE_MODE_LABELS[mode]}</label>)}
        {issue('service_mode') && <span className="field-error">{issue('service_mode')}</span>}
      </fieldset>
      <div className="service-contacts">
        {draft.contacts.map((row, index) => <div className="service-contact-row" key={index}>
          <label className="field">聯絡名稱<input maxLength={20} value={row.label} aria-invalid={Boolean(issue(`contacts.${index}.label`))} onChange={event => patch({contacts: draft.contacts.map((item, at) => at === index ? {...item, label: event.target.value} : item)})}/>{issue(`contacts.${index}.label`) && <span className="field-error">{issue(`contacts.${index}.label`)}</span>}</label>
          <label className="field">https 連結<input type="url" inputMode="url" maxLength={2048} value={row.url} aria-invalid={Boolean(issue(`contacts.${index}.url`))} onChange={event => patch({contacts: draft.contacts.map((item, at) => at === index ? {...item, url: event.target.value} : item)})} placeholder="https://"/>{issue(`contacts.${index}.url`) && <span className="field-error">{issue(`contacts.${index}.url`)}</span>}</label>
          <button type="button" className="btn btn-ghost" disabled={draft.contacts.length === 1} onClick={() => patch({contacts: draft.contacts.filter((_, at) => at !== index)})}>移除</button>
        </div>)}
        {issue('contacts') && <span className="field-error">{issue('contacts')}</span>}
        <button type="button" className="btn btn-ghost" disabled={draft.contacts.length >= 3} onClick={() => patch({contacts: [...draft.contacts, {label: '', url: ''}]})}>再加一個聯絡方式</button>
      </div>
      <label className="field">封面（選填，JPEG／PNG／WebP，4 MiB 以下）<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-invalid={Boolean(issue('cover'))} onChange={event => {
        const next = event.target.files?.[0] ?? null
        setIssues(current => current.filter(item => item.field !== 'cover'))
        if (next && next.size > SERVICE_COVER_INPUT_BYTES) { event.target.value = ''; setFile(null); setIssues(current => [...current, {field: 'cover', message: '封面需為 4 MiB 以下，請換一張較小的圖片。'}]); return }
        setFile(next)
      }}/>{file && <span className="field-hint">已選圖片：{file.name}</span>}{issue('cover') && <span className="field-error">{issue('cover')}</span>}</label>
      {editing?.cover_url && <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => void act(editing, 'remove-cover')}>移除封面</button>}
      </fieldset>
      {error && <div className="banner banner-error" role="alert"><p>{error}</p></div>}
      <div className="service-form-actions">
        <button className="btn btn-primary" type="submit" disabled={saving || conflict !== null}>{saving ? '正在儲存…' : pending?.stage === 'cover' ? '重試封面' : pending ? '重試儲存' : editing ? '儲存變更' : '建立服務'}</button>
        {conflict && <button className="btn btn-ghost" type="button" disabled={saving} onClick={() => void reloadLatest()}>載入最新內容</button>}
        <button className="btn btn-ghost" type="button" disabled={saving} onClick={closeForm}>{pending ? '放棄並關閉' : '取消'}</button>
      </div>
    </form>}
    {notice && <p className="banner banner-info" role="status">{notice}</p>}
    {!formOpen && error && <div className="banner banner-error" role="alert"><p>{error}</p><button type="button" className="btn btn-ghost" onClick={() => void load(category)}>重試</button></div>}
    <div className="service-filters" role="group" aria-label="分類">
      <button type="button" className="btn btn-ghost service-filter" aria-pressed={category === ''} onClick={() => setCategory('')}>全部</button>
      {SERVICE_CATEGORIES.map(id => <button key={id} type="button" className="btn btn-ghost service-filter" aria-pressed={category === id} onClick={() => setCategory(id)}>{SERVICE_CATEGORY_LABELS[id]}</button>)}
    </div>
    {loading && <p role="status">正在載入服務…</p>}
    {!loading && items.length === 0 && <p className="empty">{category ? '這個分類還沒有服務。' : '還沒有社員分享服務。你可以先新增自己的服務。'}</p>}
    <div className="service-grid">
      {items.map(service => <article className="card service-card" key={service.service_id}>
        <Cover service={service}/>
        <div className="service-card-body">
          <span className="service-badge" data-category={service.category}>{service.category_label}</span>
          <h3>{service.title}</h3>
          <p className="service-byline"><MemberAvatar nickname={service.owner.display_name} avatarUrl={service.owner.avatar_url} className="service-avatar"/><span>{service.owner.display_name}</span></p>
          <p className="service-summary multiline-text">{service.summary}</p>
          {(service.price_text || service.area_text) && <p className="service-facts">{[service.price_text, service.area_text].filter(Boolean).join(' · ')}</p>}
          <p className="service-points">推廣點擊 {service.total_points}</p>
          {actions(service, 'card')}
        </div>
      </article>)}
    </div>
    {cursor && <button type="button" className="btn btn-ghost" disabled={more} onClick={() => void load(category, cursor)}>{more ? '正在載入…' : '載入更多'}</button>}
  </section>
}
