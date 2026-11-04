import {ReportButton} from './MemberReporting';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {ApiError, type PortalClient} from '../api';
import {formatIsoLocal} from '../format';
import type {SocialPost} from './SocialZone';
import {accessAwareFetch} from '../access-fetch';
import {prepareSocialImage} from './social-image';
import {isMessageImage} from './message-image-client';
import {ChatExtras,ChatSticker} from './ChatContent';
import {MemberAvatar} from './MemberAvatar';
import {SocialIcon,SocialTextTools,SocialRichText,SocialMemberLink,type Mention} from './SocialTools';
import {SocialPostShare} from './SocialPostShare';
import {SocialPostLike} from './SocialPostLike';

type Comment = {image_url?:string|null;sticker_id?:string|null;mentions?:Mention[];like_count?:number;liked?:boolean;comment_id: string; body: string; created_at: string; edited_at: string | null; revision: number; author: {user_id: string; display_name: string; avatar_url?: string | null}; mine: boolean};
type Comments = {items: Comment[]; next_cursor: string | null};
type CommentEditCommand = {commentId: string; revision: number; body: {text: string}; key: string; inFlight: boolean; uncertain: boolean};
const unconfirmedEdit = '尚未確認儲存結果，原內容已保留。請按「確認上次儲存」重試。';
function rejectedCommentEdit(cause: unknown) {
  return cause instanceof ApiError && !cause.network && !cause.timedOut
    && ({version_conflict: 412, version_required: 428, validation_failed: 422, author_required: 403, not_found: 404, invalid_version: 400, idempotency_required: 400} as Record<string, number>)[cause.code ?? ''] === cause.status;
}
// A receipt confirms edit-owned fields, not current visibility, reactions or identity.
function applyCommentEdit(comment: Comment, saved: Comment) {
  if (comment.comment_id !== saved.comment_id || comment.revision >= saved.revision) return comment;
  return {...comment, body: saved.body, revision: saved.revision, edited_at: saved.edited_at,
    mentions: comment.mentions?.filter(member => saved.body.includes(`@${member.display_name}`))};
}

function compareComments(a: Comment, b: Comment) {
  // Historical receipts use milliseconds; pad rather than truncate precise SQL timestamps.
  const left = a.created_at.slice(0, -1).padEnd(26, '0'), right = b.created_at.slice(0, -1).padEnd(26, '0');
  return left.localeCompare(right) || a.comment_id.localeCompare(b.comment_id);
}
function mergeComments(current: Comment[], incoming: Comment[]) {
  const all = new Map([...current, ...incoming].map(item => [item.comment_id, item]));
  return [...all.values()].sort(compareComments);
}

export function SocialInteractions({client, post, canHide, onUpdate,onTag,onCommentsChanged,initialOpen=false}: {onCommentsChanged?:()=>void;initialOpen?:boolean;onTag?:(tag:string)=>void;client: PortalClient; post: SocialPost; canHide: boolean; onUpdate: (value: Partial<SocialPost>) => void}) {
  const [open, setOpen] = useState(initialOpen);
  const [comments, setComments] = useState<Comment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<{id: string; text: string} | null>(null);
  const [editNotice, setEditNotice] = useState('');
  const generation = client.sessionGeneration;
  const editScope = useRef({client, generation, postId: post.post_id, commands: new Map<string, CommentEditCommand>()});
  if (editScope.current.client !== client || editScope.current.generation !== generation || editScope.current.postId !== post.post_id) {
    editScope.current = {client, generation, postId: post.post_id, commands: new Map()};
    setEditing(null); setSending(false); setError(''); setEditNotice('');
  }
  const latestEdit = useRef({editing, comments});
  latestEdit.current = {editing, comments};
  const heldEdit = editing ? editScope.current.commands.get(editing.id) : undefined;
  const [mentions,setMentions]=useState<Mention[]>([]),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState(''),[preparing,setPreparing]=useState(false);
  const input=useRef<HTMLInputElement>(null),imageSeq=useRef(0),root=useRef<HTMLDivElement>(null),mounted=useRef(true);
  const [likePeople,setLikePeople]=useState<Mention[]>([]),[peopleCursor,setPeopleCursor]=useState<string|null>(null),[peopleBusy,setPeopleBusy]=useState(false),[peopleError,setPeopleError]=useState('');
  const peopleDialog=useRef<HTMLDialogElement>(null),peopleTrigger=useRef<HTMLButtonElement>(null),peopleSeq=useRef(0);
  const [commentLiking,setCommentLiking]=useState<string|null>(null),commentLikeCommands=useRef(new Map<string,{liked:boolean;key:string}>());
  type CommentCommand={body:{text?:string;image_id?:string;sticker_id?:string;mention_ids?:string[]};file:File|null;uploadKey:string;key:string};
  const pendingComment = useRef<CommentCommand|null>(null);
  const current=(generation:number)=>mounted.current&&client.sessionGeneration===generation;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;++imageSeq.current;++peopleSeq.current;};},[]);
  useEffect(()=>{if(!file){setPreview('');return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
  // A visible post must remain at least half visible for one second. List fetches
  // and background tabs do not record reads. Server uniqueness survives reloads.
  useEffect(()=>{
    const element=root.current?.closest('article')?.querySelector('.social-post-header');if(!element)return;
    let timer:ReturnType<typeof setTimeout>|undefined,visible=false,done=false;
    const generation=client.sessionGeneration,key=crypto.randomUUID();
    const schedule=()=>{clearTimeout(timer);if(visible&&!document.hidden&&!done)timer=setTimeout(()=>{if(!current(generation))return;done=true;void client.post<{read_count:number}>(`/social-posts/${post.post_id}/read`,{},{idempotencyKey:key}).then(value=>{if(current(generation))onUpdate(value);}).catch(()=>{done=false;});},1000);};
    const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting&&entries[0].intersectionRatio>=0.5;schedule();},{threshold:[0,0.5]});
    observer.observe(element);document.addEventListener('visibilitychange',schedule);
    return()=>{clearTimeout(timer);observer.disconnect();document.removeEventListener('visibilitychange',schedule);};
  },[client,post.post_id]);
  async function selectImage(next:File|null){const token=++imageSeq.current,generation=client.sessionGeneration;setError('');if(!next){setFile(null);setPreparing(false);return;}setPreparing(true);try{const prepared=await prepareSocialImage(next);if(token===imageSeq.current&&current(generation))setFile(prepared);}catch(e){if(token===imageSeq.current&&current(generation))setError(e instanceof Error?e.message:'圖片無法處理，草稿仍保留。');}finally{if(token===imageSeq.current&&current(generation))setPreparing(false);}}
  async function loadPeople(next?:string){const token=++peopleSeq.current,generation=client.sessionGeneration;setPeopleBusy(true);setPeopleError('');if(!next){setLikePeople([]);setPeopleCursor(null);}try{const page=await client.get<{items:Mention[];next_cursor:string|null}>(`/social-posts/${post.post_id}/likes${next?`?cursor=${encodeURIComponent(next)}`:''}`);if(token===peopleSeq.current&&current(generation)){setLikePeople(old=>next?[...new Map([...old,...page.items].map(m=>[m.user_id,m])).values()]:page.items);setPeopleCursor(page.next_cursor);}}catch(e){if(token===peopleSeq.current&&current(generation))setPeopleError(e instanceof Error?e.message:'按讚名單暫時無法載入。');}finally{if(token===peopleSeq.current&&current(generation))setPeopleBusy(false);}}
  function closePeople(){++peopleSeq.current;peopleDialog.current?.close();peopleTrigger.current?.focus();}
  async function likeComment(comment:Comment){if(commentLiking)return;const generation=client.sessionGeneration;const command=commentLikeCommands.current.get(comment.comment_id)??{liked:!comment.liked,key:crypto.randomUUID()};commentLikeCommands.current.set(comment.comment_id,command);setCommentLiking(comment.comment_id);setError('');try{const value=await client.post<{liked:boolean;like_count:number}>(`/social-posts/${post.post_id}/comments/${comment.comment_id}/like`,{liked:command.liked},{idempotencyKey:command.key});if(!current(generation))return;setComments(rows=>rows.map(row=>row.comment_id===comment.comment_id?{...row,...value}:row));confirmedComments.current=confirmedComments.current.map(row=>row.comment_id===comment.comment_id?{...row,...value}:row);commentLikeCommands.current.delete(comment.comment_id);}catch(e){if(current(generation)){if(e instanceof ApiError&&!e.network)commentLikeCommands.current.delete(comment.comment_id);setError(e instanceof Error?e.message:'尚未確認按讚結果，請重試。');}}finally{if(current(generation))setCommentLiking(null);}}

  const confirmedComments = useRef<Comment[]>([]);
  const sequence = useRef(0);
  const pendingReadChanges = useRef<Map<string, Comment | null> | null>(null);
  useEffect(() => () => { ++sequence.current; pendingReadChanges.current = null; }, []);
  // Opened from a Short's comment button: the panel starts expanded and loads once.
  useEffect(() => { if (initialOpen) { setOpen(true); void load(); } }, [initialOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  async function load(next?: string) {
    const token = ++sequence.current, generation = client.sessionGeneration;
    // Only ACKs that arrive during this read supersede its older snapshot.
    // A later read gets a new map and remains authoritative for remote changes.
    const changes = new Map<string, Comment | null>();
    pendingReadChanges.current = changes;
    setLoading(true); setLoadError('');
    try {
      const page = await client.get<Comments>(`/social-posts/${post.post_id}/comments${next ? `?cursor=${encodeURIComponent(next)}` : ''}`);
      if (token !== sequence.current || !current(generation)) return;
      // Reads own their covered range and current metadata. An overlapping edit only
      // advances edit fields of rows still present in this authorized page.
      const items = page.items.filter(comment => changes.get(comment.comment_id) !== null).map(comment => {
        const changed = changes.get(comment.comment_id);
        return changed ? applyCommentEdit(comment, changed) : comment;
      });
      // A partial first page has not covered later, already-visible rows.
      // Keep only an effective edit ACK beyond that page's last ordered row;
      // absence inside its covered range (or a complete/empty page) still wins.
      const last = page.items[page.items.length - 1];
      const laterEdits = !next && page.next_cursor && last ? [...changes.values()].filter((changed): changed is Comment => changed !== null
        && compareComments(changed, last) > 0 && !page.items.some(item => item.comment_id === changed.comment_id)) : [];
      const fresh = confirmedComments.current.filter(comment => !page.items.some(item => item.comment_id === comment.comment_id));
      setComments(current => {
        const retained = laterEdits.flatMap(changed => {
          const row = current.find(item => item.comment_id === changed.comment_id);
          return row ? [applyCommentEdit(row, changed)] : [];
        });
        return mergeComments(next ? current : fresh, [...items, ...retained]);
      }); setCursor(page.next_cursor);
      confirmedComments.current = fresh;
    } catch (cause) { if (token === sequence.current && current(generation)) setLoadError(cause instanceof Error ? cause.message : '留言暫時無法載入。'); }
    finally { if (token === sequence.current) { pendingReadChanges.current = null; if (current(generation)) setLoading(false); } }
  }
  async function send(event?:FormEvent,stickerId?:string) {
    event?.preventDefault();
    if(sending||preparing)return;
    const generation=client.sessionGeneration;
    const command=pendingComment.current??{body:stickerId?{sticker_id:stickerId}:{text:text.trim(),mention_ids:mentions.filter(m=>text.includes(`@${m.display_name}`)).map(m=>m.user_id)},file:stickerId?null:file,uploadKey:crypto.randomUUID(),key:crypto.randomUUID()};
    if(!command.body.text&&!command.body.sticker_id&&!command.file)return;
    pendingComment.current=command;setSending(true);setError('');
    try{
      if(command.file&&!command.body.image_id){
        if(!client.csrfToken)throw new Error('登入狀態已變更，請重新登入。');
        const response=await accessAwareFetch(`/api/v1/social-posts/${post.post_id}/comment-images`,{method:'POST',credentials:'same-origin',body:command.file,headers:{'Content-Type':command.file.type,'X-CSRF-Token':client.csrfToken,'Idempotency-Key':command.uploadKey,Accept:'application/json'}});
        if(!current(generation))return;
        const result=await response.json() as {image_id:string;detail?:string;code?:string};
        if(!response.ok)throw new ApiError({message:result.detail??'圖片尚未上傳，請重試。',status:response.status,code:result.code});
        if(!result||typeof result.image_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.image_id)||!isMessageImage(result))throw new ApiError({message:'回應未完整收到，請重試以確認圖片上傳結果。',network:true});
        command.body.image_id=result.image_id;
      }
      const created=await client.post<Comment>(`/social-posts/${post.post_id}/comments`,command.body,{idempotencyKey:command.key});
      if(!current(generation))return;
      confirmedComments.current=mergeComments(confirmedComments.current,[created]);
      setComments(rows=>mergeComments(rows,[created]));
      if(!comments.some(item=>item.comment_id===created.comment_id))onUpdate({comment_count:(post.comment_count??0)+1});
      pendingComment.current=null;
      if(!command.body.sticker_id){setText('');setMentions([]);setFile(null);}
      onCommentsChanged?.();
    }catch(cause){
      if(!current(generation))return;
      // Uploaded files remain bound to this draft when comment delivery is unknown.
      if(cause instanceof ApiError&&!cause.network&&cause.status<500)pendingComment.current=null;
      setError(cause instanceof Error?cause.message:'尚未確認留言結果，請重試。');
    }finally{if(current(generation))setSending(false);}
  }
  async function remove(comment: Comment) {
    if (sending) return;
    const generation = client.sessionGeneration;
    setSending(true); setError('');
    try {
      await client.delete(`/social-posts/${post.post_id}/comments/${comment.comment_id}`, {});
      if (!current(generation)) return;
      pendingReadChanges.current?.set(comment.comment_id, null);
      confirmedComments.current = confirmedComments.current.filter(item => item.comment_id !== comment.comment_id);
      setComments(current => current.filter(item => item.comment_id !== comment.comment_id));
      onUpdate({comment_count: Math.max(0, (post.comment_count ?? 0) - 1)}); setConfirmDelete(null);
      onCommentsChanged?.();
    } catch (cause) { if (current(generation)) setError(cause instanceof Error ? cause.message : '留言未能刪除。'); }
    finally { if (current(generation)) setSending(false); }
  }
  function beginEdit(comment: Comment) {
    const command = editScope.current.commands.get(comment.comment_id);
    setConfirmDelete(null); setEditNotice(''); setError(command?.uncertain ? unconfirmedEdit : '');
    setEditing({id: comment.comment_id, text: command?.body.text ?? comment.body});
  }
  async function saveEdit(event: FormEvent, comment: Comment) {
    event.preventDefault();
    const owner = editScope.current;
    if (!editing || editing.id !== comment.comment_id || sending || !mounted.current || owner.client !== client
      || owner.generation !== generation || client.sessionGeneration !== generation || owner.postId !== post.post_id
      || latestEdit.current.editing?.id !== comment.comment_id || [...owner.commands.values()].some(command => command.inFlight)) return;
    const command = owner.commands.get(comment.comment_id) ?? {commentId: comment.comment_id, revision: comment.revision,
      body: {text: editing.text.trim()}, key: crypto.randomUUID(), inFlight: false, uncertain: false};
    if (!command.body.text) return;
    command.inFlight = true; owner.commands.set(command.commentId, command);
    const ownsSession = () => mounted.current && editScope.current === owner && client.sessionGeneration === generation;
    const visible = () => ownsSession() && latestEdit.current.editing?.id === command.commentId;
    setSending(true); setError(''); setEditNotice('');
    try {
      const saved = await client.post<Comment>(`/social-posts/${owner.postId}/comments/${command.commentId}/edit`, command.body, {ifMatch: command.revision, idempotencyKey: command.key});
      if (!ownsSession()) return;
      if (!saved || saved.comment_id !== command.commentId || saved.body !== command.body.text || saved.revision !== command.revision + 1
        || typeof saved.edited_at !== 'string' || !Number.isFinite(Date.parse(saved.edited_at))) {
        throw new ApiError({message: unconfirmedEdit, network: true});
      }
      owner.commands.delete(command.commentId);
      const currentComment = latestEdit.current.comments.find(item => item.comment_id === command.commentId);
      // Never reinsert a row removed by a newer authorized read or a delete ACK.
      if (currentComment && currentComment.revision < saved.revision && pendingReadChanges.current?.get(command.commentId) !== null) {
        pendingReadChanges.current?.set(command.commentId, applyCommentEdit(currentComment, saved));
      }
      confirmedComments.current = confirmedComments.current.map(item => applyCommentEdit(item, saved));
      setComments(rows => rows.map(item => applyCommentEdit(item, saved)));
      if (visible()) {
        if (currentComment && currentComment.revision > saved.revision) {
          setEditing({id: command.commentId, text: currentComment.body});
          setEditNotice('上次儲存已確認，目前已有較新版本。');
        } else setEditing(null);
      }
    } catch (cause) {
      if (!ownsSession()) return;
      if (!command.uncertain && rejectedCommentEdit(cause)) owner.commands.delete(command.commentId);
      else command.uncertain = true;
      if (visible()) setError(command.uncertain ? unconfirmedEdit : cause instanceof ApiError && cause.status === 412 ? '這則留言已在別處更新，請重新載入留言後再編輯。' : cause instanceof Error ? cause.message : '留言未能更新。');
    } finally { command.inFlight = false; if (ownsSession()) setSending(false); }
  }
  return <div ref={root} className="social-interactions stack">
    <div className="social-interaction-summary"><button ref={peopleTrigger} type="button" className="social-text-link" aria-label="查看按讚名單" onClick={()=>{peopleDialog.current?.showModal();void loadPeople();}}><SocialIcon name="like"/>{post.like_count??0} 人按讚</button><span title="在前景停留觀看的會員，每人只計一次"><SocialIcon name="eye"/>已讀 {post.read_count??0} 人</span></div>
    <dialog ref={peopleDialog} className="social-publish-dialog social-people-dialog" aria-label="按讚名單" onCancel={e=>{e.preventDefault();closePeople();}}><header className="social-publish-head"><h2>按讚名單</h2><button type="button" className="btn btn-ghost" onClick={closePeople}>關閉名單</button></header>{likePeople.map(member=><p className="social-person" key={member.user_id}><MemberAvatar nickname={member.display_name}/><SocialMemberLink client={client} member={member}/></p>)}{peopleBusy&&<p role="status">載入中…</p>}{!peopleBusy&&!likePeople.length&&!peopleError&&<p>目前沒有可顯示的按讚會員。</p>}{peopleError&&<p role="alert">{peopleError}</p>}{(peopleCursor||peopleError)&&<button type="button" className="btn btn-ghost" disabled={peopleBusy} onClick={()=>void loadPeople(peopleCursor??undefined)}>{peopleError?'重試':'更多按讚會員'}</button>}</dialog>
    <div className="social-actions">
      <SocialPostLike client={client} postId={post.post_id} liked={post.liked} count={post.like_count} onUpdate={onUpdate}/>
      <button type="button" className="btn btn-ghost" aria-expanded={open} aria-controls={`social-comments-${post.post_id}`} onClick={() => { setOpen(!open); if (!open) void load(); else { ++sequence.current; pendingReadChanges.current = null; setLoading(false); } }}><SocialIcon name="comment"/>留言 · {post.comment_count ?? 0}</button>
      <SocialPostShare client={client} post={post}/>
      <ReportButton kind="post" id={post.post_id} label="貼文"/>
    </div>
    {error && <p className="banner banner-error" role="alert">{error}</p>}
    {open && <section id={`social-comments-${post.post_id}`} className="social-comments stack" aria-label="貼文留言">
      {loadError && <p className="banner banner-error" role="alert">{loadError}</p>}
      {loading && <p role="status">正在載入留言…</p>}
      {!loading && !loadError && comments.length === 0 && <p className="muted">還沒有留言，聊聊你的想法。</p>}
      {comments.map(comment => <article className="social-comment" key={comment.comment_id}>
        <div className="social-comment-meta"><MemberAvatar nickname={comment.author.display_name} avatarUrl={comment.author.avatar_url}/><strong>{comment.author.display_name}</strong><time dateTime={comment.created_at}>{formatIsoLocal(comment.created_at)}</time>{comment.edited_at && <span className="social-edited" title={formatIsoLocal(comment.edited_at)}>已編輯</span>}</div>
        {editing?.id === comment.comment_id ? <form className="stack" onSubmit={event => void saveEdit(event, comment)} aria-busy={sending}>
          <label className="field">編輯留言<textarea aria-label="編輯留言" required rows={2} maxLength={1000} value={editing.text} disabled={sending || !!heldEdit} onChange={event => { if (!editScope.current.commands.has(comment.comment_id)) setEditing({id: comment.comment_id, text: event.target.value}); }}/></label>
          <div className="social-actions"><button className="btn btn-ghost" disabled={sending || (!heldEdit && (!editing.text.trim() || editing.text.trim() === comment.body))}>{sending ? '儲存中…' : heldEdit ? '確認上次儲存' : '儲存留言'}</button><button type="button" className="btn btn-ghost" disabled={sending} onClick={() => setEditing(null)}>取消</button></div>
          {editNotice && <p role="status">{editNotice}</p>}
        </form> : <div className="social-comment-bubble">{comment.body!=='[圖片]'&&comment.body!=='[貼圖]'&&<p className="multiline-text"><SocialRichText client={client} text={comment.body} mentions={comment.mentions} onTag={onTag}/></p>}{comment.sticker_id&&<ChatSticker id={comment.sticker_id}/>} {comment.image_url&&<a href={comment.image_url} target="_blank" rel="noopener noreferrer" aria-label="開啟留言圖片"><img className="social-comment-image" src={comment.image_url} alt="留言附圖" loading="lazy"/></a>}</div>}
        <ReportButton kind="comment" id={comment.comment_id} label="留言"/>
        <div className="social-comment-actions"><button className="social-text-link" type="button" aria-label={`${comment.liked?'留言已讚':'留言讚'} · ${comment.like_count??0}`} aria-pressed={comment.liked??false} disabled={!!commentLiking} onClick={()=>void likeComment(comment)}>{commentLikeCommands.current.has(comment.comment_id)?'重試按讚':comment.liked?'已讚':'讚'}{(comment.like_count??0)>0&&` · ${comment.like_count}`}</button></div>
        {(comment.mine || canHide) && editing?.id !== comment.comment_id && <details className="social-post-menu social-comment-menu"><summary aria-label="留言選項">⋯</summary><div className="social-post-menu-actions">{confirmDelete === comment.comment_id ? <>
          <button type="button" className="btn btn-ghost" disabled={sending} onClick={() => void remove(comment)}>確定刪除留言</button><button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>取消</button>
        </> : <>{comment.mine && <button type="button" className="btn btn-ghost" disabled={sending} onClick={() => beginEdit(comment)}>編輯留言</button>}<button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(comment.comment_id)}>刪除留言</button></>}</div></details>}
      </article>)}
      {cursor && <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => void load(cursor)}>載入更多留言</button>}
      {(error || loadError) && <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => { setError(''); void load(); }}>重新載入留言</button>}
      <form className="social-comment-composer" onSubmit={event=>void send(event)} aria-busy={sending||preparing}>
        <label className="field"><span className="sr-only">寫留言</span><textarea aria-label="寫留言" rows={2} maxLength={1000} value={text} disabled={sending||!!pendingComment.current} onChange={event=>setText(event.target.value)} onPaste={event=>{const pasted=[...event.clipboardData.files].find(f=>f.type.startsWith('image/'));if(pasted&&!sending&&!pendingComment.current){event.preventDefault();void selectImage(pasted);}}} placeholder="留下你的想法，輸入 @ 標註夥伴…"/></label>
        {preview&&<div className="social-compose-attachment"><img className="social-compose-preview" src={preview} alt="留言圖片預覽"/><button type="button" className="social-text-link" disabled={sending||!!pendingComment.current} onClick={()=>void selectImage(null)}>移除留言圖片</button></div>}
        {preparing&&<p role="status">正在處理圖片…</p>}
        <div className="social-comment-toolbar"><input ref={input} className="sr-only" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" aria-label="留言圖片" disabled={sending||preparing||!!pendingComment.current} onChange={event=>{void selectImage(event.target.files?.[0]??null);event.target.value='';}}/>
          <button className="social-icon-button" type="button" aria-label="上傳留言照片" title="上傳留言照片" disabled={sending||preparing||!!pendingComment.current} onClick={()=>input.current?.click()}><SocialIcon name="camera"/></button>
          <SocialTextTools client={client} text={text} onChange={setText} mentions={mentions} onMentions={setMentions} disabled={sending||!!pendingComment.current}/>
          <ChatExtras draft={{}} onChange={()=>{}} onSendSticker={id=>void send(undefined,id)} disabled={sending||preparing||!!pendingComment.current} target={post.post_id}/>
          <button className="social-icon-button social-comment-send" aria-label={sending?'傳送中…':pendingComment.current?'重試留言':'送出留言'} title={pendingComment.current?'重試留言':'送出留言'} disabled={sending||preparing||(!pendingComment.current&&!text.trim()&&!file)}><SocialIcon name="send"/></button>
        </div>
      </form>
    </section>}
  </div>;
}
