/** Owner-only metadata and opaque bytes. No source rendering, parsing or execution. */
export const MEMBER_GAME_MAX_BYTES = 256 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$(?![\s\S])/;
const decimal = (value: unknown, zero = false): value is string => typeof value === 'string'
  && (zero ? /^(0|[1-9][0-9]{0,18})$(?![\s\S])/ : /^[1-9][0-9]{0,18}$(?![\s\S])/).test(value) && BigInt(value) <= 9223372036854775807n;
export type MemberGame = Readonly<{game_id:string;title:string;description:string;version:string;state:'draft'|'quarantined'|'withdrawn';source_revision:string;trust:'unreviewed';visibility:'private'}>;
export type CurrentMemberGame = MemberGame & Readonly<{upload_available:boolean}>;
export function memberGame(value: unknown, current = false): MemberGame | CurrentMemberGame {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_game_response');
  const v = value as Record<string, unknown>;
  const keys = ['game_id','title','description','version','state','source_revision','trust','visibility',...(current ? ['upload_available'] : [])];
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(key => !keys.includes(key))
    || typeof v.game_id !== 'string' || !uuid.test(v.game_id) || typeof v.title !== 'string' || !v.title.trim() || v.title.length > 80 || /[\u0000-\u001f\u007f<>]/.test(v.title)
    || typeof v.description !== 'string' || v.description.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/.test(v.description)
    || !decimal(v.version) || !decimal(v.source_revision,true) || typeof v.state !== 'string' || !['draft','quarantined','withdrawn'].includes(v.state)
    || v.trust !== 'unreviewed' || v.visibility !== 'private' || (current && typeof v.upload_available !== 'boolean')
    || BigInt(v.source_revision) >= BigInt(v.version)
    || (v.state === 'draft' && v.source_revision !== '0') || (v.state === 'quarantined' && v.source_revision === '0')
    || (current && v.state === 'withdrawn' && v.upload_available !== false)) throw Error('invalid_game_response');
  return Object.freeze({...v}) as MemberGame | CurrentMemberGame;
}
export function memberGameInput(title: string, description: string) {
  const body = {title:title.trim(),description:description.trim()};
  if (!body.title || body.title.length > 80 || /[\u0000-\u001f\u007f<>]/.test(body.title) || body.description.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/.test(body.description)) throw Error('請填寫 80 字以內名稱、1000 字以內介紹，不使用 HTML 標籤或控制字元。');
  return Object.freeze(body);
}
export function memberGameFileError(file: File): string | null {
  return !/\.html$(?![\s\S])/i.test(file.name) || (file.type !== '' && file.type !== 'text/html') || file.size < 1 || file.size > MEMBER_GAME_MAX_BYTES
    ? '請選擇一個 256 KiB 以下的 UTF-8 .html 檔案，不接受 ZIP 或多檔。' : null;
}
export type GameCommand = Readonly<{kind:'create';key:string;body:Readonly<{title:string;description:string}>} | {kind:'upload'|'withdraw';key:string;before:MemberGame;source?:Blob}>;
export function exactGameAck(value: unknown, command: GameCommand): MemberGame {
  const ack = memberGame(value);
  if (command.kind === 'create') {
    if (ack.title !== command.body.title || ack.description !== command.body.description || ack.version !== '1' || ack.source_revision !== '0' || ack.state !== 'draft') throw Error('invalid_game_ack');
  } else {
    const b = command.before;
    if (ack.game_id !== b.game_id || ack.title !== b.title || ack.description !== b.description || BigInt(ack.version) !== BigInt(b.version)+1n
      || BigInt(ack.source_revision) !== BigInt(b.source_revision)+(command.kind === 'upload' ? 1n : 0n)
      || ack.state !== (command.kind === 'upload' ? 'quarantined' : 'withdrawn')) throw Error('invalid_game_ack');
  }
  return ack;
}
export interface MemberGameTransport {
  read(id:string,signal:AbortSignal):Promise<unknown>;
  send(command:GameCommand,signal:AbortSignal):Promise<unknown>;
  current():boolean;
  refused(error:unknown):boolean;
}
export type GameUploadSnapshot = Readonly<{
  phase:'idle'|'reading'|'selecting'|'writing'|'unknown'|'closed';
  draft:CurrentMemberGame|null; draftId:string; selected:Readonly<{name:string;byteSize:number}>|null;
  status:string; retry:'create'|'upload'|'withdraw'|null; fileEpoch:number;
}>;
export const memberGameLeaveRisk = (state:GameUploadSnapshot) => Boolean(state.selected || state.retry || state.phase==='writing' || state.phase==='unknown');
const empty = (): GameUploadSnapshot => Object.freeze({phase:'idle',draft:null,draftId:'',selected:null,status:'',retry:null,fileEpoch:0});
/** One page/session owner. The only byte references are selected/command, never the UI snapshot. */
export class MemberGameUpload {
  private snapshot = empty();
  private listeners = new Set<()=>void>();
  private epoch = 0;
  private disposed = false;
  private abort: AbortController | null = null;
  private selected: {source:Blob;before:CurrentMemberGame} | null = null;
  private command: GameCommand | null = null;
  private uncertain = false;
  private minimumVersion = new Map<string,string>();
  constructor(private readonly transport: MemberGameTransport) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener:()=>void) => { this.listeners.add(listener); return () => {this.listeners.delete(listener);}; };
  private publish(patch:Partial<GameUploadSnapshot>) { this.snapshot=Object.freeze({...this.snapshot,...patch});for(const listener of this.listeners)listener(); }
  private valid(epoch = this.epoch) { if(this.disposed)return false;if(!this.transport.current()){this.dispose();return false;}return epoch===this.epoch; }
  private ready() { return this.valid() && this.snapshot.phase==='idle' && !this.command; }
  private clearSource() { this.selected=null;this.publish({selected:null,fileEpoch:this.snapshot.fileEpoch+1}); }
  private start(phase:'reading'|'writing'|'selecting') { this.abort?.abort();this.abort=new AbortController();const epoch=++this.epoch;this.publish({phase,status:''});return {epoch,signal:this.abort.signal}; }
  dispose = () => { if(this.disposed)return;this.disposed=true;this.epoch++;this.abort?.abort();this.abort=null;this.selected=null;this.command=null;this.minimumVersion.clear();this.publish({...empty(),phase:'closed',status:'會員工作區已關閉，本頁檔案已清除。',fileEpoch:this.snapshot.fileEpoch+1}); };
  clearFile = () => {if(this.ready())this.clearSource();};
  private async readCurrent(id:string,signal:AbortSignal) {
    const value=memberGame(await this.transport.read(id,signal),true) as CurrentMemberGame;
    const minimum=this.minimumVersion.get(id);
    if(value.game_id!==id||(minimum&&BigInt(value.version)<BigInt(minimum)))throw Error('stale_game_read');
    return value;
  }
  async load(id:string) {
    if(!this.ready())return;
    this.clearSource();this.publish({draft:null});
    if(!uuid.test(id)){this.publish({status:'請貼上完整的草稿編號。'});return;}
    this.publish({draftId:id});const {epoch,signal}=this.start('reading');
    try {const draft=await this.readCurrent(id,signal);if(this.valid(epoch)){this.minimumVersion.set(draft.game_id,draft.version);this.publish({draft,phase:'idle',status:'已讀取目前私有狀態。'});}}
    catch {if(this.valid(epoch))this.publish({phase:'idle',status:'目前狀態無法確認。請檢查草稿編號、會員資格或稍後重新讀取。'});}
  }
  async selectFile(file:File|null) {
    if(!this.ready())return;this.clearSource();if(!file)return;
    const before=this.snapshot.draft;
    if(!before?.upload_available||before.state==='withdrawn'){this.publish({status:'來源保存目前未開放。'});return;}
    const error=memberGameFileError(file);if(error){this.publish({status:error});return;}
    const {epoch}=this.start('selecting');
    try {
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(!this.valid(epoch))return;
      if(bytes.byteLength!==file.size||bytes.byteLength>MEMBER_GAME_MAX_BYTES)throw Error('source_changed');
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      if(!text.trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))throw Error('source_invalid');
      // Preserve BOM, line endings and every original byte. Never use decoded text as the body.
      this.selected={source:new Blob([bytes],{type:'text/html'}),before};
      this.publish({phase:'idle',selected:{name:file.name,byteSize:bytes.byteLength},status:'檔案僅留在本頁記憶體，尚未傳送。'});
    } catch {if(this.valid(epoch))this.publish({phase:'idle',status:'檔案無法完整讀取，或不是有效的 UTF-8 文字。請重新選檔。'});}
  }
  async create(title:string,description:string) {
    if(!this.ready())return;
    let body;try{body=memberGameInput(title,description);}catch(error){this.publish({status:(error as Error).message});return;}
    this.clearSource();this.publish({draft:null,draftId:''});
    this.uncertain=false;this.command=Object.freeze({kind:'create',key:crypto.randomUUID(),body});await this.send();
  }
  async change(kind:'upload'|'withdraw') {
    if(!this.ready())return;
    const before=this.snapshot.draft,selected=this.selected;
    if(!before||before.state==='withdrawn'||BigInt(before.version)>=9223372036854775807n||(kind==='upload'&&!selected))return;
    // Re-read policy/version immediately before preparing a new immutable command.
    const {epoch,signal}=this.start('reading');this.publish({draft:null});
    try {
      const current=await this.readCurrent(before.game_id,signal);if(!this.valid(epoch))return;
      this.minimumVersion.set(current.game_id,current.version);this.publish({draft:current});
      if(current.version!==before.version||current.state==='withdrawn'||(kind==='upload'&&selected?.before.version!==current.version)){
        this.clearSource();this.publish({phase:'idle',status:'草稿已變更，已讀取新狀態。請重新確認後操作。'});return;
      }
      if(kind==='upload'&&!current.upload_available){this.clearSource();this.publish({phase:'idle',status:'來源保存目前未開放，沒有傳送檔案。'});return;}
      this.uncertain=false;this.command=Object.freeze({kind,key:crypto.randomUUID(),before,...(kind==='upload'?{source:selected!.source}:{})});
      await this.send();
    } catch {if(this.valid(epoch)){this.clearSource();this.publish({phase:'idle',draft:null,status:'無法確認目前權限或狀態，沒有開始新的寫入。請重新讀取。'});}}
  }
  async retry() {
    if(!this.valid()||this.snapshot.phase!=='unknown'||!this.command)return;
    const command=this.command;
    // A create with a lost receipt has no known UUID. Session revalidation still
    // precedes that exact replay; never guess a new draft from a metadata listing.
    if(command.kind!=='create'){
      const {epoch,signal}=this.start('reading');
      try {
        const current=await this.readCurrent(command.before.game_id,signal);if(!this.valid(epoch))return;
        this.minimumVersion.set(current.game_id,current.version);
        // Policy OFF / withdrawn may still have a historical receipt. The GET
        // neither settles this command nor changes its frozen key/version/bytes.
      } catch {if(this.valid(epoch))this.publish({phase:'unknown',status:'目前權限或狀態讀取失敗，尚未重送。原操作與檔案仍保留，請稍後重試。'});return;}
    }
    await this.send();
  }
  private async send() {
    const command=this.command;if(!command||!this.valid())return;
    const {epoch,signal}=this.start('writing');this.publish({draft:null,retry:null});
    let ack:MemberGame;
    try {ack=exactGameAck(await this.transport.send(command,signal),command);}
    catch(error) {
      if(!this.valid(epoch))return;
      if(this.transport.refused(error)&&!this.uncertain){
        this.command=null;this.clearSource();this.publish({phase:'idle',retry:null,status:'伺服器拒絕這次操作；尚未確認目前狀態。請重新讀取後再決定。'});
      } else {this.uncertain=true;this.publish({phase:'unknown',retry:command.kind,status:'尚未確認操作結果，可能已保存。只能重試同一操作；檔案、版本和操作編號保持不變。'});}
      return;
    }
    if(!this.valid(epoch))return;
    this.command=null;this.clearSource();
    const previous=this.minimumVersion.get(ack.game_id);
    if(!previous||BigInt(ack.version)>BigInt(previous))this.minimumVersion.set(ack.game_id,ack.version);
    this.publish({draftId:ack.game_id,phase:'reading',status:'已收到此操作回條，正在另讀目前狀態；回條不是最新狀態。'});
    try {const draft=await this.readCurrent(ack.game_id,signal);if(this.valid(epoch)){this.minimumVersion.set(draft.game_id,draft.version);this.publish({draft,phase:'idle',status:command.kind==='upload'?'來源保存回條已確認，目前狀態如下。仍未審核，不能試玩或公開。':command.kind==='withdraw'?'撤回回條已確認；來源歷史與容量仍保留。':'私人草稿已建立。尚未上傳來源。請保留草稿編號。'});}}
    catch {if(this.valid(epoch))this.publish({phase:'idle',draft:null,status:'已收到操作回條，但目前狀態讀取失敗。請保留草稿編號並重新讀取；不能據此上傳或撤回。'});}
  }
}
