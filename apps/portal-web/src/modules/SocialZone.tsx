import {SocialIcon,SocialTextTools,SocialRichText,SOCIAL_TOPICS,type Mention} from './SocialTools';
import {Component,lazy,Suspense,useCallback, useEffect, useId, useRef, useState,useSyncExternalStore, type FormEvent,type ReactNode} from 'react';
import {accessAwareFetch} from '../access-fetch';
import {ApiError, type PortalClient} from '../api';
import {formatIsoLocal} from '../format';
import {isOwnWorkshopHost,normalizeShareUrl,PLATFORM_LABELS, type SocialPlatform} from '../../../../packages/shared/share-url';
import {MemberAvatar} from './MemberAvatar';
import {PromotionShare} from './PromotionShare';
import {SocialInteractions} from './SocialInteractions';
import {SocialPostEditor} from './SocialPostEditor';
import {ShortVideoFeed} from './ShortVideoFeed';
import {InlineVideo} from './InlineVideo';
import {SocialPostShare} from './SocialPostShare';
import {youtubeLinkHint, youtubeLinkKind} from './short-video-embed';
import './SocialZone.css';
// Keep styles eager so a failed CSS preload cannot poison the optional module import.
import './SocialPostOptimizer.css';
import {prepareSocialImage} from './social-image';
import {socialPostJobForSession} from '../social-post-task';
import {newTextHistory,recordText,breakTextGroup,undoText,redoText} from './text-edit-history';
import {useLanguage,type InterfaceLanguage} from '../language';
import {shareModuleRetryUrl} from '../share-module-loader';
import {GameDraftNotice,useGameDraftInbox} from '../games/GameDraftInbox';
import {clearGameDraft,gameDraftFile,type GameDraft} from '../games/result-bridge';
// Presentation-only copy: changing language must not reset a draft or its pending command.
const composerMessages={
  title:['建立貼文','Create post','投稿を作成','게시물 작성','Crear publicación'],
  closeLabel:['關閉發文','Close composer','投稿画面を閉じる','게시 작성기 닫기','Cerrar editor'],
  close:['關閉','Close','閉じる','닫기','Cerrar'],
  me:['我','Me','自分','나','Yo'],
  visibility:['社群會員可見','Visible to community members','コミュニティのメンバーに公開','커뮤니티 회원에게 공개','Visible para miembros de la comunidad'],
  resumePending:['繼續確認剛才的貼文…','Continue confirming your post…','投稿結果の確認を続ける…','게시 결과 계속 확인…','Continuar confirmando tu publicación…'],
  resume:['繼續編輯你的貼文…','Continue editing your post…','投稿の編集を続ける…','게시물 계속 편집…','Seguir editando tu publicación…'],
  prompt:['想分享什麼？','What would you like to share?','何を共有しますか？','무엇을 공유하고 싶나요?','¿Qué te gustaría compartir?'],
  content:['貼文內容','Post content','投稿内容','게시물 내용','Contenido de la publicación'],
  placeholder:['分享近況、作品，或找夥伴一起做點事…','Share an update, your work, or find people to create with…','近況や作品を共有したり、一緒に活動する仲間を探したり…','근황이나 작품을 공유하거나 함께할 동료를 찾아보세요…','Comparte novedades, tu trabajo o busca personas con quienes crear…'],
  previewVisibility:['貼文限社群會員，連結縮圖公開','Post visible to members; link thumbnail is public','投稿はメンバー限定、リンクのサムネイルは公開','게시물은 회원 공개, 링크 썸네일은 전체 공개','Publicación para miembros; miniatura del enlace pública'],
  retainedLink:['這個預覽連結尚未加入正文。請加入正文或移除連結，再發布。','This preview link is not in the post text. Add it to the text or remove it before publishing.','このリンクは本文に含まれていません。本文に追加するか削除してから投稿してください。','이 링크는 본문에 없습니다. 본문에 추가하거나 제거한 후 게시하세요.','Este enlace no está en el texto. Añádelo o elimínalo antes de publicar.'],
  insertLink:['加入正文','Add to post text','本文に追加','본문에 추가','Añadir al texto'],
  removeLink:['移除連結','Remove link','リンクを削除','링크 제거','Quitar enlace'],
  linkTooLong:['加入連結會超過 2,000 字，請先調整正文；草稿仍保留。','Adding this link would exceed 2,000 characters. Edit the text first; your draft is retained.','リンクを追加すると2,000文字を超えます。本文を調整してください。下書きは保持されています。','링크를 추가하면 2,000자를 초과합니다. 본문을 먼저 수정하세요. 초안은 유지됩니다.','Añadir el enlace superaría 2.000 caracteres. Ajusta el texto; se conserva el borrador.'],
  sessionChanged:['登入狀態已變更，請重新整理。','Your sign-in has changed. Refresh the page.','ログイン状態が変わりました。再読み込みしてください。','로그인 상태가 변경되었습니다. 새로고침하세요.','Tu sesión ha cambiado. Actualiza la página.'],
  linkPreview:['加入連結預覽（選填）','Add a link preview (optional)','リンクプレビューを追加（任意）','링크 미리보기 추가 (선택)','Añadir vista previa de enlace (opcional)'],
  linkHint:['網址可以直接貼在正文發布，不需要開啟預覽。','Paste links in your post and publish without a preview.','URLは本文に貼り付けるだけで投稿できます。','미리보기 없이 본문에 링크를 붙여 게시할 수 있습니다.','Puedes pegar enlaces en el texto y publicar sin vista previa.'],
  previewHint:['只在按下發布時讀取外部網站。預覽貼文限 500 字，不支援自訂主題、標籤、標註或打卡；關閉預覽可保留完整貼文。','The website is read only when you publish. Preview posts allow 500 characters, without custom topics, hashtags, mentions or location. Turn off preview to keep the full post.','公開時のみ外部サイトを読み込みます。プレビュー投稿は500文字までで、テーマ変更・タグ・メンション・場所には対応しません。通常投稿ではすべて保持できます。','게시할 때만 외부 사이트를 읽습니다. 미리보기 게시물은 500자까지이며 사용자 지정 주제, 해시태그, 멘션, 위치를 지원하지 않습니다. 전체 내용을 유지하려면 미리보기를 끄세요.','El sitio se consulta solo al publicar. La vista previa admite 500 caracteres, sin temas personalizados, etiquetas, menciones ni ubicación. Desactívala para conservar la publicación completa.'],
  previewPhotoHint:['這張照片會另行上傳為外部連結的公開縮圖；若上傳失敗，貼文仍已建立。','This photo is uploaded separately as the external link’s public thumbnail. An upload failure does not undo the post.','写真は外部リンクの公開サムネイルとして別途アップロードされます。失敗しても投稿は作成済みです。','사진은 외부 링크의 공개 썸네일로 별도 업로드됩니다. 업로드에 실패해도 게시물은 유지됩니다.','La foto se sube por separado como miniatura pública del enlace. Si falla, la publicación permanece creada.'],
  linkUrl:['預覽連結','Preview link','プレビューするリンク','미리보기 링크','Enlace para vista previa'],
  linkTitle:['預覽標題（選填）','Preview title (optional)','プレビューのタイトル（任意）','미리보기 제목 (선택)','Título de vista previa (opcional)'],
  previewIncompatible:['目前草稿包含超過 500 字、自訂主題、標籤、標註或打卡。請關閉連結預覽後發布，內容與照片都會保留。','This draft exceeds 500 characters or includes a custom topic, hashtag, mention or location. Turn off link preview to publish without losing text or photos.','500文字を超えるか、テーマ・タグ・メンション・場所が含まれています。プレビューをオフにすると文章と写真を保持して投稿できます。','500자를 초과하거나 주제, 해시태그, 멘션, 위치가 있습니다. 내용을 보존하려면 링크 미리보기를 끄고 게시하세요.','El borrador supera 500 caracteres o incluye tema, etiqueta, mención o ubicación. Desactiva la vista previa para conservar el texto y las fotos.'],
  previewUrlInvalid:['請使用有效的外部 HTTPS 連結；站內連結請直接貼在正文並關閉預覽。','Use a valid external HTTPS link. For Workshop links, paste in the text and turn off preview.','有効な外部HTTPSリンクを入力してください。工坊内のリンクは本文に貼り、プレビューをオフにしてください。','유효한 외부 HTTPS 링크를 사용하세요. 공방 링크는 본문에 붙이고 미리보기를 끄세요.','Usa un enlace HTTPS externo válido. Para enlaces de Workshop, pégalos en el texto y desactiva la vista previa.'],
  thumbnailPending:['貼文已建立，圖片尚未確認。重試只會確認同一張縮圖，不會再次發文。','The post is created; the image is unconfirmed. Retry only confirms the same thumbnail, without reposting.','投稿は作成済みですが、画像は未確認です。再試行しても同じ画像のみ確認し、再投稿しません。','게시물은 생성되었지만 이미지는 확인되지 않았습니다. 다시 시도해도 같은 썸네일만 확인하며 재게시하지 않습니다.','La publicación está creada; la imagen no está confirmada. Reintentar solo confirma la misma miniatura, sin volver a publicar.'],
  retryThumbnail:['重試圖片','Retry image','画像を再試行','이미지 다시 시도','Reintentar imagen'],
  duplicate:['這則連結已經有人分享過了，草稿仍保留。','This link has already been shared. Your draft is retained.','このリンクは共有済みです。下書きは保持されています。','이미 공유된 링크입니다. 초안은 유지됩니다.','Este enlace ya se compartió. Se conserva tu borrador.'],
  topic:['主題','Topic','テーマ','주제','Tema'],
  topicLabel:['貼文主題','Post topic','投稿のテーマ','게시물 주제','Tema de la publicación'],
  mood:['近況心情','Updates and thoughts','近況・気持ち','근황과 생각','Novedades y reflexiones'],
  event:['社群活動','Community events','コミュニティ活動','커뮤니티 활동','Eventos de la comunidad'],
  work:['作品分享','Share your work','作品紹介','작품 공유','Compartir trabajos'],
  photo:['加入貼文照片','Add post photo','投稿に写真を追加','게시물 사진 추가','Añadir foto a la publicación'],
  image:['貼文圖片（選填）','Post image (optional)','投稿画像（任意）','게시물 이미지 (선택)','Imagen de la publicación (opcional)'],
  checkIn:['打卡','Check in','チェックイン','체크인','Registrar ubicación'],
  location:['打卡地點','Location','場所','장소','Ubicación'],
  locationExample:['例如：台北松菸、線上聚會','For example: a local workshop or an online meetup','例：近くの工房、オンライン交流会','예: 동네 공방, 온라인 모임','Por ejemplo: un taller local o una reunión en línea'],
  locationHint:['自行填寫地點名稱，與貼文一起顯示。','Enter a place name to display with your post.','入力した場所の名前が投稿に表示されます。','입력한 장소 이름이 게시물과 함께 표시됩니다.','Escribe el nombre del lugar para mostrarlo con tu publicación.'],
  imageHint:['直接選擇照片，系統會自動調整大小。支援 JPEG、PNG、WebP。','Choose a photo; it will be resized automatically. JPEG, PNG and WebP are supported.','写真を選ぶと自動でサイズ調整されます。JPEG、PNG、WebPに対応。','사진을 선택하면 크기가 자동 조정됩니다. JPEG, PNG, WebP를 지원합니다.','Elige una foto; su tamaño se ajustará automáticamente. Se admiten JPEG, PNG y WebP.'],
  preparing:['正在處理圖片…','Preparing image…','画像を処理中…','이미지 처리 중…','Preparando imagen…'],
  preview:['待發布圖片預覽','Post image preview','投稿画像のプレビュー','게시할 이미지 미리보기','Vista previa de la imagen'],
  removeImage:['移除圖片','Remove image','画像を削除','이미지 제거','Quitar imagen'],
  optimize:['✦ Social Post 優化','✦ Social Post optimize','✦ Social Post 文章改善','✦ Social Post 다듬기','✦ Social Post optimizar'],
  restore:['復原原稿','Restore original draft','元の下書きに戻す','원래 초안 복원','Restaurar borrador original'],
  publish:['發布貼文','Publish post','投稿する','게시','Publicar'],
  publishing:['發布中…','Publishing…','投稿中…','게시 중…','Publicando…'],
  retry:['重試發布','Retry publish','投稿を再試行','게시 다시 시도','Reintentar publicación'],
  published:['貼文已發布。','Post published.','投稿しました。','게시되었습니다.','Publicación enviada.'],
  imageType:['請選擇 JPEG、PNG 或 WebP 圖片。','Choose a JPEG, PNG or WebP image.','JPEG、PNG、WebPの画像を選んでください。','JPEG, PNG 또는 WebP 이미지를 선택하세요.','Elige una imagen JPEG, PNG o WebP.'],
  imageEmpty:['圖片是空的，請重新選取。','The image is empty. Select it again.','画像が空です。選び直してください。','이미지가 비어 있습니다. 다시 선택하세요.','La imagen está vacía. Vuelve a seleccionarla.'],
  imageSize:['這張圖片超過 20 MB，請選擇較小的原始照片。','This image exceeds 20 MB. Choose a smaller original photo.','画像が20 MBを超えています。小さい元画像を選んでください。','이미지가 20 MB를 초과합니다. 더 작은 원본 사진을 선택하세요.','La imagen supera los 20 MB. Elige una foto original más pequeña.'],
  imageInvalid:['圖片無法讀取，請選擇完整的靜態 JPEG、PNG 或 WebP 圖片。','The image could not be read. Choose a complete, still JPEG, PNG or WebP image.','画像を読み込めません。完全な静止画のJPEG、PNG、WebPを選んでください。','이미지를 읽을 수 없습니다. 온전한 JPEG, PNG 또는 WebP 정지 이미지를 선택하세요.','No se pudo leer la imagen. Elige una imagen estática JPEG, PNG o WebP completa.'],
  imageResolution:['這張圖片的解析度過高，請選擇一般照片版本。','The image resolution is too high. Choose a standard photo version.','画像の解像度が高すぎます。通常の写真を選んでください。','이미지 해상도가 너무 높습니다. 일반 사진 버전을 선택하세요.','La resolución es demasiado alta. Elige una versión normal de la foto.'],
  imageProcess:['這張圖片暫時無法處理，請重新選取或換一張照片。','This image could not be processed. Select it again or choose another photo.','画像を処理できません。選び直すか別の写真を選んでください。','이미지를 처리할 수 없습니다. 다시 선택하거나 다른 사진을 선택하세요.','No se pudo procesar la imagen. Vuelve a seleccionarla o elige otra foto.'],
  imageRead:['圖片未能讀取，請重新選取。','The image could not be read. Select it again.','画像を読み込めません。選び直してください。','이미지를 읽을 수 없습니다. 다시 선택하세요.','No se pudo leer la imagen. Vuelve a seleccionarla.'],
  imageFallback:['圖片未能處理，文字草稿仍保留。','The image could not be processed. Your text draft is retained.','画像を処理できません。文章の下書きは保持されています。','이미지를 처리하지 못했습니다. 작성한 초안은 유지됩니다.','No se pudo procesar la imagen. Se conserva tu borrador de texto.'],
  uncertain:['尚未確認發布結果，請重試。','Publication is unconfirmed. Retry to confirm the same post.','投稿結果を確認できません。同じ投稿を再試行して確認してください。','게시 결과가 확인되지 않았습니다. 같은 게시물을 다시 시도해 확인하세요.','La publicación no está confirmada. Reintenta para confirmar la misma publicación.'],
} as const satisfies Record<string,readonly [string,string,string,string,string]>;
const composerLanguageIndex:Record<InterfaceLanguage,number>={'zh-Hant':0,en:1,ja:2,ko:3,es:4};
const optimizerPanelLoader=(retryUrl?:string)=>lazy(async()=>{
  const module=retryUrl?await import(/* @vite-ignore */ retryUrl) as typeof import('./SocialPostOptimizer'):await import('./SocialPostOptimizer');
  if(typeof module.SocialPostOptimizer!=='function')throw Error('Optimizer unavailable');
  return {default:module.SocialPostOptimizer};
});
const sharePanelLoader=(retryUrl?:string)=>lazy(async()=>{
  const module=retryUrl?await import(/* @vite-ignore */ retryUrl) as typeof import('./SocialCrossPlatformShare'):await import('./SocialCrossPlatformShare');
  if(typeof module.SocialCrossPlatformShare!=='function')throw Error('Sharing tools unavailable');
  return {default:module.SocialCrossPlatformShare};
});
class ShareLoadBoundary extends Component<{children:ReactNode;fallback:(cause:unknown)=>ReactNode},{failed:boolean;cause:unknown}>{
  state={failed:false,cause:null as unknown};
  static getDerivedStateFromError(cause:unknown){return {failed:true,cause};}
  render(){return this.state.failed?this.props.fallback(this.state.cause):this.props.children;}
}

export type SocialPost = {
  post_id: string; url: string | null; kind: 'link' | 'note'; platform: SocialPlatform; platform_label: string; title: string; note: string | null; created_at: string;
  topic?:keyof typeof SOCIAL_TOPICS;location_name?:string|null;tags?:string[];mentions?:Mention[];read_count?:number;
  edited_at: string | null; revision: number;
  author: {user_id: string; display_name: string; avatar_url: string | null};
  thumbnail_url: string | null; total_points: number; my_points: number; mine: boolean;
  like_count: number; comment_count: number; liked: boolean;
};
type Post = SocialPost;
type Page = {items: Post[]; next_cursor: string | null; can_hide: boolean};
const FILTERS = [
  {id: 'note', label: '社群貼文'},
  {id: '', label: '全部動態'},
  {id: 'youtube', label: 'YouTube'},
  {id: 'shorts', label: 'Short'},
  {id: 'instagram', label: 'Instagram'},
  {id: 'facebook', label: 'Facebook'},
  {id: 'other', label: '其他'},
] as const;

const FEED_MESSAGES={
  'zh-Hant':{note:'社群貼文',all:'全部動態',filters:'動態分類',options:'動態選項',close:'關閉',closeOptions:'關閉動態選項',refresh:'更新動態'},
  en:{note:'Community posts',all:'All posts',filters:'Feed categories',options:'Feed options',close:'Close',closeOptions:'Close feed options',refresh:'Refresh feed'},
  ja:{note:'コミュニティ投稿',all:'すべての投稿',filters:'フィードの分類',options:'フィード設定',close:'閉じる',closeOptions:'フィード設定を閉じる',refresh:'フィードを更新'},
  ko:{note:'커뮤니티 게시물',all:'모든 게시물',filters:'피드 분류',options:'피드 옵션',close:'닫기',closeOptions:'피드 옵션 닫기',refresh:'피드 새로고침'},
  es:{note:'Comunidad',all:'Todas las publicaciones',filters:'Categorías del feed',options:'Opciones del feed',close:'Cerrar',closeOptions:'Cerrar opciones del feed',refresh:'Actualizar feed'},
} as const;

function tone(platform: SocialPlatform) {
  return platform === 'youtube' || platform === 'instagram' || platform === 'facebook' ? platform : 'other';
}
function hostOf(url: string | null) { try { return new URL(url ?? '').hostname; } catch { return url; } }

function SocialBody({text,client,mentions,onTag}:{text:string;client:PortalClient;mentions?:Mention[];onTag:(tag:string)=>void}) {
  const [expanded,setExpanded]=useState(false);
  const id=useId(),long=text.length>180||text.split('\n').length>4;
  return <div className="social-post-text"><p id={id} className={`social-note multiline-text${long&&!expanded?' is-preview':''}`}><SocialRichText client={client} text={text} mentions={mentions} onTag={onTag}/></p>
    {long&&<button type="button" className="social-read-more" aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(value=>!value)}>{expanded?'收合':'顯示全文'}</button>}
  </div>;
}

function Thumb({post}: {post: Post}) {
  const [broken, setBroken] = useState(false);
  if (post.kind === 'note' && !post.thumbnail_url) return null;
  if (!post.thumbnail_url || broken) return <div className="social-placeholder" data-platform={tone(post.platform)}><span className="social-platform-badge" data-platform={tone(post.platform)}>{post.platform_label}</span><span>{hostOf(post.url)}</span></div>;
  return <img className="social-thumb" src={post.thumbnail_url} alt="" width={640} height={360} onError={() => setBroken(true)}/>;
}

async function composeImage(file: File) {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('圖片未能讀取，請重新選取。'));
    reader.readAsDataURL(file);
  });
  return {mime_type: file.type, data_base64: data};
}

function sharedPostFromLocation():string|null {
  if(window.location.hash!=='#social')return null;
  const id=new URLSearchParams(window.location.search).get('social-post');
  return id&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)?id:null;
}
export function SocialZone({client, canReview = false, viewer, focusPost, shortVideos = false}: {client: PortalClient; canReview?: boolean; shortVideos?: boolean; viewer?: {name: string; avatarUrl?: string | null}; focusPost?: {id: string; sequence: number}}) {
  const composerId = useId();
  const currentClient=useRef(client);currentClient.current=client;
  const composer = useRef<HTMLDialogElement>(null), composerTrigger = useRef<HTMLButtonElement>(null), composerStart = useRef<HTMLDivElement>(null);
  // The sticky community header wraps on narrow screens, so the composer sticks below its measured height.
  useEffect(() => {
    const header = document.querySelector<HTMLElement>('.community-header'), start = composerStart.current;
    if (!header || !start) return;
    const size = () => start.style.setProperty('--social-composer-top', `${header.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(size); observer.observe(header); size();
    return () => observer.disconnect();
  }, []);
  const options = useRef<HTMLDialogElement>(null), optionsTrigger = useRef<HTMLButtonElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [platform, setPlatform] = useState('note');
  const [directPost,setDirectPost]=useState<string|null>(sharedPostFromLocation);
  const focusing=useRef<string|null>(null);
  const [items, setItems] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [canHide, setCanHide] = useState(canReview);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [linkPreview, setLinkPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null), deleteTrigger = useRef<HTMLElement | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [composeFile, setComposeFile] = useState<File | null>(null), composeInput = useRef<HTMLInputElement>(null);
  const [composePreview, setComposePreview] = useState('');
  const [preparingImage, setPreparingImage] = useState(false);
  const imageSequence = useRef(0);
  useEffect(() => () => { ++imageSequence.current; }, []);
  const [editingPost, setEditingPost] = useState<Post | null>(null), editTrigger = useRef<HTMLElement | null>(null);
  const [textHistory,setTextHistory] = useState(newTextHistory);
  const text=textHistory.value;
  const setText=(value:string,kind:'typing'|'replace'='typing')=>setTextHistory(history=>recordText(history,value,kind));
  const [topic,setTopic]=useState<keyof typeof SOCIAL_TOPICS>('mood'),[locationName,setLocationName]=useState(''),[checkIn,setCheckIn]=useState(false),[mentions,setMentions]=useState<Mention[]>([]),[tag,setTag]=useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [optimizerEnabled,setOptimizerEnabled]=useState(false);
  const [optimizerLoader,setOptimizerLoader]=useState(()=>({component:optimizerPanelLoader(),attempt:0}));
  const Optimizer=optimizerLoader.component;
  const [shareOpen,setShareOpen]=useState(false),shareTrigger=useRef<HTMLButtonElement>(null);
  const [shareLoader,setShareLoader]=useState(()=>({component:sharePanelLoader(),attempt:0}));
  const CrossPlatformShare=shareLoader.component;
  const {language}=useLanguage();
  const composerText=(key:keyof typeof composerMessages)=>composerMessages[key][composerLanguageIndex[language]];
  const composerFeedback=(message:string)=>{
    const key=(Object.keys(composerMessages) as (keyof typeof composerMessages)[]).find(key=>composerMessages[key][0]===message);
    return key?composerText(key):message; // Preserve server-provided validation detail.
  };
  const historyText={
    'zh-Hant':['復原上一步','重做','正在開啟文案優化…','文案優化未能開啟，草稿仍保留。','重試開啟文案優化'],
    en:['Undo','Redo','Opening copy tools…','Copy tools could not open. Your draft is retained.','Retry copy tools'],
    ja:['元に戻す','やり直す','文章ツールを開いています…','文章ツールを開けませんでした。下書きは保持されています。','文章ツールを再試行'],
    ko:['실행 취소','다시 실행','글 도구 여는 중…','글 도구를 열지 못했습니다. 초안은 유지됩니다.','글 도구 다시 열기'],
    es:['Deshacer','Rehacer','Abriendo herramientas de texto…','No se pudieron abrir las herramientas. Se conserva tu borrador.','Reintentar herramientas de texto'],
  }[language];
  const shareText={ 'zh-Hant':['↗ Social Post 分享','正在開啟分享工具…','發布到工坊','分享工具未能開啟，草稿仍保留。','重試開啟分享'],en:['↗ Social Post share','Opening sharing tools…','Publish to Workshop','Sharing tools could not open. Your draft is retained.','Retry sharing tools'],ja:['↗ Social Post 共有','共有ツールを開いています…','工坊に投稿','共有ツールを開けませんでした。下書きは保持されています。','共有ツールを再試行'],ko:['↗ Social Post 공유','공유 도구 여는 중…','공방에 게시','공유 도구를 열지 못했습니다. 초안은 유지됩니다.','공유 도구 다시 열기'],es:['↗ Social Post compartir','Abriendo herramientas…','Publicar en Workshop','No se pudieron abrir las herramientas. Se conserva tu borrador.','Reintentar herramientas']}[language];
  const [optimizationJob]=useState(()=>socialPostJobForSession(client));
  const optimization=useSyncExternalStore(optimizationJob.subscribe,optimizationJob.snapshot,optimizationJob.snapshot);
  const [originalDraft,setOriginalDraft]=useState<{before:string;after:string}|null>(null);
  const pending = useRef<({kind:'note';text:string;topic?:string;location_name?:string;mention_ids?:string[];image?:{mime_type:string;data_base64:string}}|{kind:'link';body:{url:string;title?:string;note?:string};photo:File|null;thumbnailKey:string;created?:Post})&{key:string;generation:number;uncertain?:boolean}|null>(null);
  const publishLock=useRef<object|null>(null);
  useEffect(()=>{
    ++imageSequence.current;pending.current=null;publishLock.current=null;
    setTextHistory(newTextHistory());setOriginalDraft(null);setComposeFile(null);setPreparingImage(false);
    setUrl('');setTitle('');setLinkPreview(false);setTopic('mood');setMentions([]);setLocationName('');setCheckIn(false);
    setPublishing(false);setPublishError('');setSaving(false);setActionError('');setNotice('');newPosts.current=[];
    return()=>{++imageSequence.current;publishLock.current=null;};
  },[client,client.sessionGeneration]);
  const gameInbox=useGameDraftInbox(client.sessionGeneration);
  const importedGame=useRef<{createdAt:number;generation:number}|null>(null);
  const importingGame=useRef(false),[gameImportError,setGameImportError]=useState('');
  const latestDraft=useRef({text,file:composeFile});latestDraft.current={text,file:composeFile};
  useEffect(()=>{importedGame.current=null;importingGame.current=false;setGameImportError('');},[client,client.sessionGeneration]);
  async function importGame(draft:GameDraft){
    if(client!==currentClient.current||importingGame.current||publishing||preparingImage||pending.current||composeFile)return;
    const merged=[text.trim(),draft.text].filter(Boolean).join('\n\n');
    if(merged.length>2000)return;
    const generation=client.sessionGeneration,sequence=++imageSequence.current,original=text;
    importingGame.current=true;setPreparingImage(true);setGameImportError('');
    try{
      const prepared=await prepareSocialImage(gameDraftFile(draft));
      if(client!==currentClient.current||generation!==client.sessionGeneration||sequence!==imageSequence.current)return;
      if(latestDraft.current.text!==original||latestDraft.current.file){setGameImportError('你正在編輯草稿。請確認後再帶入成果。');return;}
      setText(merged,'replace');setComposeFile(prepared);
      importedGame.current={createdAt:draft.createdAt,generation};gameInbox.setDraft(null);openComposer();
    }catch(cause){
      if(client===currentClient.current&&generation===client.sessionGeneration&&sequence===imageSequence.current)setGameImportError(cause instanceof Error?cause.message:'成果圖片未能處理，請重試。');
    }finally{
      if(client===currentClient.current&&generation===client.sessionGeneration&&sequence===imageSequence.current){importingGame.current=false;setPreparingImage(false);}
    }
  }
  useEffect(()=>{
    const draft=gameInbox.draft;
    // Only an empty editor opens automatically; existing drafts require the import action.
    if(draft&&!text&&!composeFile&&!publishing&&!preparingImage&&!pending.current&&!gameImportError&&importedGame.current?.createdAt!==draft.createdAt)void importGame(draft);
  },[gameInbox.draft,text,composeFile,publishing,preparingImage,gameImportError]);
  const [shortPostId, setShortPostId] = useState<string | null>(null), [shortComments, setShortComments] = useState(false);
  const [shortLiking, setShortLiking] = useState<string | null>(null), shortLikeCommands = useRef(new Map<string, {liked: boolean; key: string}>());
  const shortPost = platform === 'shorts' ? items.find(item => item.post_id === shortPostId) : undefined;
  const shortDialog = useRef<HTMLDialogElement>(null);
  const shortTrigger = useRef<HTMLElement | null>(null);
  // The card lives in a dialog opened from a slide; withdrawing or hiding the post removes it from `items`, which closes the dialog.
  useEffect(() => { if (shortPost && !shortDialog.current?.open) shortDialog.current?.showModal(); }, [shortPost]);
  useEffect(() => { if (!shortPost && shortTrigger.current) { const back = shortTrigger.current; shortTrigger.current = null; if (back.isConnected) back.focus(); else document.querySelector<HTMLElement>('.short-video-scroller')?.focus(); } }, [shortPost]);
  const loadSequence = useRef(0);
  const confirmedWrites = useRef(0);
  const pendingFeedLoad = useRef(false);
  const selection = useRef({platform: 'note', tag:'', version: 0});
  const composerVersion = useRef(0);
  const newPosts = useRef<Post[]>([]);
  const feedSession = client.sessionGeneration;
  const feedScope = useRef({client, session: feedSession, platform, tag, directPost});
  feedScope.current = {client, session: feedSession, platform, tag, directPost};
  type FeedLoad = {client: PortalClient; session: number; platform: string; tag: string; directPost: string | null; cursor?: string; sequence: number};
  const activeFeedLoad = useRef<FeedLoad | null>(null), failedFeedLoad = useRef<FeedLoad | null>(null);
  const load = useCallback(async (nextPlatform: string, nextCursor?: string, retrying = false) => {
    const scope = feedScope.current;
    // Captured handlers cannot read for a replacement login or a newer selection.
    if (client !== currentClient.current || scope.client !== client || feedSession !== client.sessionGeneration || scope.session !== feedSession || scope.platform !== nextPlatform || scope.tag !== tag || scope.directPost !== directPost) return;
    const active = activeFeedLoad.current;
    const sameActiveScope = active && active.sequence === loadSequence.current && active.client === client && active.session === feedSession && active.platform === nextPlatform && active.tag === tag && active.directPost === directPost;
    if (sameActiveScope && ((nextCursor && !active.cursor) || ((nextCursor || retrying) && active.cursor === nextCursor))) return;
    const sequence = ++loadSequence.current;
    const request: FeedLoad = {client, session: feedSession, platform: nextPlatform, tag, directPost, cursor: nextCursor, sequence};
    activeFeedLoad.current = request;
    failedFeedLoad.current = retrying ? request : null;
    const valid = () => sequence === loadSequence.current && client === currentClient.current && feedSession === client.sessionGeneration && feedScope.current.client === client && feedScope.current.session === feedSession && feedScope.current.platform === nextPlatform && feedScope.current.tag === tag && feedScope.current.directPost === directPost;
    pendingFeedLoad.current = true;
    if (nextCursor) setMore(true); else setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams();
      if(directPost){query.set('post_id',directPost);focusing.current=directPost;}
      else {
        if (nextPlatform === 'note') query.set('kind', 'note');
        else if (nextPlatform) query.set('platform', nextPlatform === 'shorts' ? 'youtube' : nextPlatform);
        if (nextCursor) query.set('cursor', nextCursor);
        if(tag)query.set('tag',tag);
      }
      let confirmedPage: Page | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const epoch = confirmedWrites.current;
        const received = await client.get<Page>(`/social-posts${query.size ? `?${query}` : ''}`);
        if (!valid()) return;
        if (epoch === confirmedWrites.current) { confirmedPage = received; break; }
        // One read-only revalidation of this exact page, never a mutation retry.
        if (attempt === 1) {
          failedFeedLoad.current = request;
          setError('貼文剛有更新，請重試載入最新內容。');
          return;
        }
      }
      if (!confirmedPage) return;
      const page = confirmedPage;
      failedFeedLoad.current = null;
      const fresh = !directPost&&(nextPlatform === '' || nextPlatform === 'note') ? newPosts.current.filter(post => (nextPlatform===''||post.kind==='note')&&(!tag||post.tags?.includes(tag.toLocaleLowerCase()))&&!page.items.some(item => item.post_id === post.post_id)) : [];
      setItems(current => nextCursor ? [...current, ...page.items.filter(post => !current.some(item => item.post_id === post.post_id))] : [...fresh, ...page.items]);
      newPosts.current = newPosts.current.filter(post => !page.items.some(item => item.post_id === post.post_id));
      setCursor(page.next_cursor);
      setCanHide(page.can_hide);
    } catch (cause) { if (valid()) { failedFeedLoad.current = request; setError(cause instanceof Error ? cause.message : '貼文暫時無法載入。'); } }
    finally { if (valid()) { activeFeedLoad.current = null; pendingFeedLoad.current = false; setLoading(false); setMore(false); } }
  }, [client,feedSession,tag,directPost]);
  function retryFeed() {
    const failed = failedFeedLoad.current, scope = feedScope.current;
    if (!failed || failed.sequence !== loadSequence.current || failed.client !== client || failed.client !== currentClient.current || failed.session !== client.sessionGeneration || failed.session !== scope.session || failed.platform !== scope.platform || failed.tag !== scope.tag || failed.directPost !== scope.directPost) return;
    void load(failed.platform, failed.cursor, true);
  }
  function refreshAfterAction() {
    // A read can refresh visibility, but cannot prove an uncertain write succeeded.
    void load(platform, undefined, true);
  }
  useEffect(() => { void load(platform); }, [load, platform]);
  // Quiet re-check for the Short feed (no spinner, so the viewer keeps their place): a hidden or withdrawn post drops out
  // of everything already loaded, so it stops playing. Returns null when the list could not be confirmed.
  // Every refresh owns a generation. A response that is no longer the newest, or that predates a local removal, is
  // dropped before it can write the list, cursor or canHide.
  const refreshSequence = useRef(0);
  const refreshShorts = useCallback(async (loadedCount: number): Promise<readonly string[] | null> => {
    const ownsScope = () => client === currentClient.current && feedSession === client.sessionGeneration && feedScope.current.client === client && feedScope.current.session === feedSession && feedScope.current.platform === 'shorts' && feedScope.current.tag === tag && feedScope.current.directPost === null;
    // A queued visibility callback must not re-read or replace a newer login/feed.
    if (!ownsScope()) return null;
    const sequence = loadSequence.current, generation = ++refreshSequence.current, epoch = confirmedWrites.current;
    try {
      const kept: Post[] = [];
      let next: string | null | undefined;
      let canHideNow = false;
      for (let pages = 0; pages < 10 && (pages === 0 || (next && kept.length < loadedCount)); pages++) {
        // The same query the feed was loaded with, including the active hashtag, so a refresh never swaps the list.
        const query = new URLSearchParams({platform: 'youtube'});
        if (tag) query.set('tag', tag);
        if (next) query.set('cursor', next);
        const page = await client.get<Page>(`/social-posts?${query}`);
        if (!ownsScope() || sequence !== loadSequence.current || generation !== refreshSequence.current || epoch !== confirmedWrites.current) return null;
        kept.push(...page.items.filter(post => !kept.some(item => item.post_id === post.post_id)));
        next = page.next_cursor; canHideNow = page.can_hide;
      }
      setItems(kept); setCursor(next ?? null); setCanHide(canHideNow);
      return kept.map(post => post.post_id);
    } catch { return null; }
  }, [client, feedSession, tag]);
  useEffect(()=>{
    const changed=()=>{const next=sharedPostFromLocation();if(next!==directPost){++loadSequence.current;feedScope.current={...feedScope.current,directPost:next};setDirectPost(next);}};
    window.addEventListener('hashchange',changed);window.addEventListener('popstate',changed);
    return()=>{window.removeEventListener('hashchange',changed);window.removeEventListener('popstate',changed);};
  },[directPost]);
  // Permalinks and notifications use one exact authorized lookup, even for old posts.
  useEffect(() => {
    if (!focusPost) return;
    ++loadSequence.current;feedScope.current={...feedScope.current,directPost:focusPost.id,platform:'',tag:''};setNotice('');setDirectPost(focusPost.id);
    selection.current={platform:'',tag:'',version:selection.current.version+1};setPlatform('');setTag('');
    if(directPost===focusPost.id)void load(platform);
  }, [focusPost?.sequence]);
  useEffect(() => {
    const target = focusing.current;
    // Earlier effects may have started a request while this render still has loading=false.
    if (!target || pendingFeedLoad.current || loading || more || target!==directPost) return;
    const card = document.getElementById(`social-post-${target}`);
    if (card) { focusing.current = null; card.scrollIntoView({block: 'center'}); card.focus({preventScroll: true}); return; }
    focusing.current = null;
  }, [items, loading, more, directPost]);
  useEffect(() => () => { ++loadSequence.current; }, []);
  useEffect(() => { if (composerOpen && !composer.current?.open) {composer.current?.showModal(); composer.current?.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)')?.focus();} }, [composerOpen]);
  useEffect(() => { if (optionsOpen && !options.current?.open) options.current?.showModal(); }, [optionsOpen]);
  // The editor's own effect closes its dialog first (child effects run before this one), so focus can return to the menu.
  useEffect(() => { if (!editingPost && editTrigger.current) { editTrigger.current.focus(); editTrigger.current = null; } }, [editingPost]);
  useEffect(() => {
    if (confirming && !deleteDialog.current?.open) deleteDialog.current?.showModal();
  }, [confirming]);
  useEffect(() => {
    if (!composeFile) { setComposePreview(''); return; }
    const preview = URL.createObjectURL(composeFile);
    setComposePreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [composeFile]);
  async function selectComposeImage(next: File | null) {
    if(client!==currentClient.current)return;
    const sequence = ++imageSequence.current, generation = client.sessionGeneration;
    if (!next) {
      if (composeInput.current) composeInput.current.value = '';
      setComposeFile(null); setPublishError(''); setPreparingImage(false); return;
    }
    setPreparingImage(true); setPublishError('');
    try {
      const prepared = await prepareSocialImage(next);
      if (sequence === imageSequence.current && client===currentClient.current && generation === client.sessionGeneration) setComposeFile(prepared);
    } catch (cause) {
      if (sequence !== imageSequence.current || client!==currentClient.current || generation !== client.sessionGeneration) return;
      if (composeInput.current) composeInput.current.value = '';
      setPublishError(cause instanceof Error ? cause.message : '圖片未能處理，文字草稿仍保留。');
    } finally { if (sequence === imageSequence.current && client===currentClient.current && generation === client.sessionGeneration) setPreparingImage(false); }
  }
  function openDelete(post: Post, trigger: HTMLElement) {
    deleteTrigger.current = trigger; setDeleteError(''); setConfirming(post.post_id);
  }
  function closeDelete() {
    if (saving) return;
    deleteDialog.current?.close(); setConfirming(null);
    deleteTrigger.current?.focus({preventScroll: true});
  }
  function selectPlatform(next: string) {
    if(directPost)clearDirectPost();
    if (selection.current.platform === next) return;
    selection.current = {...selection.current,platform: next, version: selection.current.version + 1};
    ++loadSequence.current;
    feedScope.current={...feedScope.current,platform:next};
    setPlatform(next);
  }
  function clearDirectPost(){
    ++loadSequence.current;feedScope.current={...feedScope.current,directPost:null};focusing.current=null;setDirectPost(null);setNotice('');
    const location=new URL(window.location.href);location.searchParams.delete('social-post');window.history.replaceState(null,'',location);
  }
  function selectTag(next:string){if(!directPost&&selection.current.tag===next)return;if(directPost)clearDirectPost();selection.current={...selection.current,tag:next,version:selection.current.version+1};++loadSequence.current;feedScope.current={...feedScope.current,tag:next};setTag(next);}
  function openComposer() { ++composerVersion.current; setComposerOpen(true); }
  function closeComposer() { ++composerVersion.current; composer.current?.close(); setComposerOpen(false); composerTrigger.current?.focus({preventScroll: true}); }
  function closeOptions() { options.current?.close(); setOptionsOpen(false); optionsTrigger.current?.focus({preventScroll: true}); }
  function toggleLinkPreview(enabled:boolean) {
    if(client!==currentClient.current||publishLock.current||pending.current)return;
    setLinkPreview(enabled);setPublishError('');
    // Local convenience only, after an explicit opt-in. Never fetch on paste or toggle.
    if(enabled&&!url){const candidate=text.match(/https:\/\/[^\s<>]+/u)?.[0];if(candidate)setUrl(candidate);}
  }
  function insertRetainedLink() {
    if(client!==currentClient.current||publishLock.current||pending.current||!url.trim())return;
    const next=text?`${text}\n${url.trim()}`:url.trim();
    if(next.length>2000){setPublishError(composerMessages.linkTooLong[0]);return;}
    setText(next,'replace');setPublishError('');
  }
  function removeRetainedLink() {
    if(client!==currentClient.current||publishLock.current||pending.current)return;
    setUrl('');setTitle('');setPublishError('');
  }
  function finishPublication(created:Post,selectedVersion:number,interactionVersion:number,generation:number) {
    ++confirmedWrites.current;
    newPosts.current=[created,...newPosts.current.filter(post=>post.post_id!==created.post_id)];
    const current=selection.current;
    if(directPost&&current.version===selectedVersion)clearDirectPost();
    if((current.platform===''||current.platform===(created.kind==='note'?'note':created.platform))&&(!current.tag||created.tags?.includes(current.tag.toLocaleLowerCase())))
      setItems(items=>[created,...items.filter(post=>post.post_id!==created.post_id)]);
    else if(!current.tag&&current.version===selectedVersion){setItems([created]);setCursor(null);selectPlatform(created.kind==='note'?'note':'');}
    if(importedGame.current?.generation===generation){try{clearGameDraft(sessionStorage,importedGame.current.createdAt);}catch{/* Publication is already acknowledged. */}importedGame.current=null;}
    pending.current=null;setTextHistory(newTextHistory());setMentions([]);setLocationName('');setCheckIn(false);
    void selectComposeImage(null);setOriginalDraft(null);setUrl('');setTitle('');setLinkPreview(false);setNotice('貼文已發布。');
    if(composerVersion.current===interactionVersion)closeComposer();
  }
  async function publishLink() {
    if(publishLock.current||preparingImage)return;
    const generation=client.sessionGeneration;
    if(client!==currentClient.current||(pending.current&&pending.current.generation!==generation))return;
    if(!client.csrfToken){setPublishError(composerMessages.sessionChanged[0]);return;}
    let command=pending.current;
    if(command?.kind==='note')return;
    if(!command){
      if(text.trim().length>500||topic!=='mood'||checkIn||locationName.trim()||mentions.length||/(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]/u.test(text)){setPublishError(composerMessages.previewIncompatible[0]);return;}
      const normalized=normalizeShareUrl(url);
      if(!normalized.ok||isOwnWorkshopHost(normalized.host,location.origin)){setPublishError(composerMessages.previewUrlInvalid[0]);return;}
      if(title.trim().length>120||/[\u0000-\u001f\u007f]/.test(title)){setPublishError('請填寫 120 字以內的預覽標題。');return;}
      command={kind:'link',body:{url,...(title.trim()?{title:title.trim()}:{}),...(text.trim()?{note:text.trim()}: {})},key:crypto.randomUUID(),generation,photo:composeFile,thumbnailKey:crypto.randomUUID()};
      pending.current=command;
    }
    const lock={};publishLock.current=lock;
    const selectedVersion=selection.current.version,interactionVersion=composerVersion.current;
    setPublishing(true);setPublishError('');setNotice('');
    try {
      if(!command.created){
        const response=await accessAwareFetch('/api/v1/social-posts',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json','X-CSRF-Token':client.csrfToken,'Idempotency-Key':command.key},body:JSON.stringify(command.body)});
        if(client!==currentClient.current||generation!==client.sessionGeneration||publishLock.current!==lock)return;
        const payload=await response.json() as Post&{detail?:string;code?:string};
        if(client!==currentClient.current||generation!==client.sessionGeneration||publishLock.current!==lock)return;
        if(response.status===409&&payload.code==='social_post_exists'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(payload.post_id)&&!command.uncertain){
          pending.current=null;setPublishError(composerMessages.duplicate[0]);
          document.getElementById(`social-post-${payload.post_id}`)?.scrollIntoView({block:'center'});return;
        }
        if(!response.ok)throw new ApiError({message:payload.detail||'貼文未能分享。',status:response.status,code:payload.code});
        const normalized=normalizeShareUrl(command.body.url);
        if(!normalized.ok||payload.kind!=='link'||payload.url!==normalized.url||payload.note!==(command.body.note??null)||!payload.mine||typeof payload.title!=='string'||(command.body.title&&payload.title!==command.body.title)||!payload.author||typeof payload.author.display_name!=='string'||typeof payload.created_at!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(payload.post_id))throw new Error(composerMessages.uncertain[0]);
        command.created=payload;
      }
      if(command.photo){
        const uploaded=await accessAwareFetch(`/api/v1/social-posts/${command.created.post_id}/thumbnail`,{method:'PUT',credentials:'same-origin',body:command.photo,headers:{Accept:'application/json','Content-Type':command.photo.type,'X-CSRF-Token':client.csrfToken,'Idempotency-Key':command.thumbnailKey}});
        if(client!==currentClient.current||generation!==client.sessionGeneration||publishLock.current!==lock)return;
        const payload=await uploaded.json() as Post&{detail?:string};
        if(client!==currentClient.current||generation!==client.sessionGeneration||publishLock.current!==lock)return;
        if(!uploaded.ok)throw new ApiError({message:payload.detail||composerMessages.thumbnailPending[0],status:uploaded.status});
        if(payload.post_id!==command.created.post_id||payload.kind!=='link'||payload.url!==command.created.url||typeof payload.thumbnail_url!=='string')throw new Error(composerMessages.thumbnailPending[0]);
        command.created={...command.created,thumbnail_url:payload.thumbnail_url};
      }
      finishPublication(command.created,selectedVersion,interactionVersion,generation);
    }catch(cause){
      if(client!==currentClient.current||generation!==client.sessionGeneration||publishLock.current!==lock)return;
      if(command.created)setPublishError(composerMessages.thumbnailPending[0]);
      else{
        const unknown=!(cause instanceof ApiError)||cause.network||cause.status===0||cause.status>=500;
        if(command.uncertain||unknown){command.uncertain=true;setPublishError(composerMessages.uncertain[0]);}
        else{pending.current=null;setPublishError(cause.message);}
      }
    }finally{if(client===currentClient.current&&generation===client.sessionGeneration&&publishLock.current===lock){publishLock.current=null;setPublishing(false);}}
  }
  async function publish(event: FormEvent) {
    event.preventDefault();
    if (client!==currentClient.current || publishLock.current || preparingImage) return;
    if(pending.current?.kind==='link'||(!pending.current&&linkPreview)){await publishLink();return;}
    if(!pending.current&&url.trim()&&!text.includes(url.trim())){setPublishError(composerMessages.retainedLink[0]);return;}
    if(client!==currentClient.current||(pending.current&&pending.current.generation!==client.sessionGeneration))return;
    const command: Extract<NonNullable<typeof pending.current>,{kind:'note'}> = pending.current ?? {kind:'note',generation:client.sessionGeneration,text: text.trim(),topic,location_name:checkIn&&locationName.trim()?locationName.trim():undefined,mention_ids:mentions.filter(m=>text.includes(`@${m.display_name}`)).map(m=>m.user_id), key: crypto.randomUUID()};
    if (!command.text) return;
    const selectedVersion = selection.current.version, interactionVersion = composerVersion.current, generation = client.sessionGeneration;
    const lock={};publishLock.current=lock;
    setPublishing(true); setPublishError(''); setNotice('');
    try {
      if (!pending.current && composeFile) command.image = await composeImage(composeFile);
      if (client!==currentClient.current || generation !== client.sessionGeneration || publishLock.current!==lock) return;
      pending.current = command;
      const created = await client.post<Post>('/social-posts/notes', {text: command.text,topic:command.topic,location_name:command.location_name,mention_ids:command.mention_ids, ...(command.image ? {image: command.image} : {})}, {idempotencyKey: command.key});
      if(client!==currentClient.current||generation!==client.sessionGeneration||publishLock.current!==lock)return;
      finishPublication(created,selectedVersion,interactionVersion,generation);
    } catch (cause) {
      if(client!==currentClient.current||generation!==client.sessionGeneration||publishLock.current!==lock)return;
      if (cause instanceof ApiError && !cause.network && cause.status>0 && cause.status<500 && !command.uncertain) pending.current = null;
      else if(pending.current)pending.current.uncertain=true;
      setPublishError(pending.current?.uncertain ? composerMessages.uncertain[0] : cause instanceof Error ? cause.message : composerMessages.uncertain[0]);
    } finally { if(client===currentClient.current&&generation===client.sessionGeneration&&publishLock.current===lock){publishLock.current=null;setPublishing(false);} }
  }
  async function uploadLinkThumb(post: Post, next: File) {
    if (!client.csrfToken || client !== currentClient.current || feedSession !== client.sessionGeneration) return;
    if (saving) return;
    const generation = client.sessionGeneration;
    const current = () => client === currentClient.current && generation === client.sessionGeneration;
    setSaving(true); setActionError('');
    try {
      next = await prepareSocialImage(next);
      if (!current()) return;
      const response = await accessAwareFetch(`/api/v1/social-posts/${post.post_id}/thumbnail`, {
        method: 'PUT', credentials: 'same-origin', body: next,
        headers: {Accept: 'application/json', 'Content-Type': next.type, 'X-CSRF-Token': client.csrfToken, 'Idempotency-Key': crypto.randomUUID()},
      });
      const payload = await response.json() as Post & {detail?: string};
      if (!current()) return;
      if (!response.ok) throw new ApiError({message: payload.detail || '縮圖未能換上。', status: response.status});
      setItems(current => current.map(item => item.post_id === post.post_id ? {...item, ...payload, thumbnail_url: `${payload.thumbnail_url ?? item.thumbnail_url}?v=${Date.now()}`} : item));
      setNotice('縮圖已更新。');
    } catch (cause) { if (current()) setActionError(cause instanceof Error ? cause.message : '縮圖未能換上。'); }
    finally { if (current()) setSaving(false); }
  }
  async function remove(post: Post) {
    if (!client.csrfToken) return;
    ++refreshSequence.current;
    setSaving(true); setDeleteError('');
    try {
      const response = await accessAwareFetch(`/api/v1/social-posts/${post.post_id}`, {
        method: 'DELETE', credentials: 'same-origin', body: '{}',
        headers: {'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': client.csrfToken, 'Idempotency-Key': crypto.randomUUID()},
      });
      if (!response.ok) { const problem = await response.json().catch(() => ({})) as {detail?: string}; throw new ApiError({message: problem.detail || '貼文未能刪除。', status: response.status}); }
      { ++confirmedWrites.current; ++refreshSequence.current; setItems(current => current.filter(item => item.post_id !== post.post_id)); };
      newPosts.current = newPosts.current.filter(item => item.post_id !== post.post_id);
      deleteDialog.current?.close(); setConfirming(null); setNotice('貼文已刪除。');
      composerTrigger.current?.focus({preventScroll: true});
    } catch (cause) { setDeleteError(cause instanceof Error ? cause.message : '貼文未能刪除。'); }
    finally { setSaving(false); }
  }
  async function hide(post: Post) {
    if (client !== currentClient.current || feedSession !== client.sessionGeneration) return;
    const generation = client.sessionGeneration;
    const current = () => client === currentClient.current && generation === client.sessionGeneration;
    ++refreshSequence.current;
    setSaving(true); setActionError('');
    try { await client.post(`/social-posts/${post.post_id}/hide`, {}); if (!current()) return; { ++confirmedWrites.current; ++refreshSequence.current; setItems(current => current.filter(item => item.post_id !== post.post_id)); }; newPosts.current = newPosts.current.filter(item => item.post_id !== post.post_id); setNotice('貼文已隱藏。'); }
    catch (cause) { if (current()) setActionError(cause instanceof Error ? cause.message : '貼文未能隱藏。'); }
    finally { if (current()) setSaving(false); }
  }
  // One-tap like from a Short slide: same endpoint, per-post command and idempotency key as the card's like button.
  async function likeShort(postId: string) {
    const post = items.find(item => item.post_id === postId);
    if (!post || shortLiking) return;
    const command = shortLikeCommands.current.get(post.post_id) ?? {liked: !post.liked, key: crypto.randomUUID()};
    shortLikeCommands.current.set(post.post_id, command); setShortLiking(post.post_id); setNotice('');
    try {
      const value = await client.post<{liked: boolean; like_count: number}>(`/social-posts/${post.post_id}/like`, {liked: command.liked}, {idempotencyKey: command.key});
      setItems(current => current.map(item => item.post_id === post.post_id ? {...item, ...value} : item)); shortLikeCommands.current.delete(post.post_id);
    } catch (cause) {
      if (cause instanceof ApiError && !cause.network) shortLikeCommands.current.delete(post.post_id);
      setNotice(cause instanceof Error ? cause.message : '尚未確認按讚結果，請再按一次重試。');
    } finally { setShortLiking(null); }
  }
  const feedText=FEED_MESSAGES[language];
  const filterLabel=(id:string,label:string)=>id==='note'?feedText.note:id===''?feedText.all:label;
  const renderCard = (post: Post, view: {inline?: boolean; commentsOpen?: boolean} = {inline: true}) => <article className="card social-card" key={post.post_id} id={`social-post-${post.post_id}`} tabIndex={-1}>
        <div className="social-card-body">
          <div className="social-post-header"><p className="social-byline"><MemberAvatar nickname={post.author.display_name} avatarUrl={post.author.avatar_url} className="social-avatar"/> <span>{post.author.display_name}</span> {post.edited_at ? <small className="social-byline-meta"><time dateTime={post.created_at}>{formatIsoLocal(post.created_at)}</time><small className="social-edited" title={formatIsoLocal(post.edited_at)}>已編輯</small></small> : <time dateTime={post.created_at}>{formatIsoLocal(post.created_at)}</time>}</p>
            {(post.mine||canHide)&&<details className="social-post-menu" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}}>
              <summary aria-label="貼文選項">⋯</summary><div className="social-post-menu-actions">
                {post.mine && post.kind !== 'note' && <label className="btn btn-ghost social-file">換縮圖<input aria-label="更換縮圖" type="file" accept="image/jpeg,image/png,image/webp" disabled={saving} onChange={event=>{const next=event.target.files?.[0];if(next)void uploadLinkThumb(post,next);event.target.value='';}}/></label>}
                {post.mine && <button type="button" className="btn btn-ghost" disabled={saving} aria-haspopup="dialog" onClick={event=>openDelete(post, event.currentTarget.closest('details')?.querySelector('summary') ?? event.currentTarget)}>刪除</button>}
                {post.mine && confirming!==post.post_id && <button type="button" className="btn btn-ghost" disabled={saving} onClick={event=>{editTrigger.current=event.currentTarget.closest('details')?.querySelector('summary')??null;event.currentTarget.closest('details')?.removeAttribute('open');setNotice('');setEditingPost(post);}}>編輯</button>}
                {canHide && !post.mine && <button type="button" className="btn btn-ghost" disabled={saving} onClick={()=>void hide(post)}>隱藏</button>}
              </div>
            </details>}
          </div>
          <div className="social-post-context">{post.kind==='note'&&<span className="social-topic-badge" data-topic={post.topic??'mood'}>{SOCIAL_TOPICS[post.topic??'mood']}</span>}{post.location_name&&<span className="social-location"><SocialIcon name="pin"/>{post.location_name}</span>}</div>
          {post.kind !== 'note' && <span className="social-platform-badge" data-platform={tone(post.platform)}>{post.platform_label || PLATFORM_LABELS[post.platform]}</span>}
          {shortVideos && post.kind === 'link' && youtubeLinkKind(post.url) === 'short' && <span className="social-platform-badge social-short-badge">Short</span>}
          {post.kind !== 'note' && <h3>{post.title}</h3>}
          {post.note && <SocialBody text={post.note} client={client} mentions={post.mentions} onTag={selectTag}/>}
          {shortVideos && view.inline && post.kind === 'link' && youtubeLinkKind(post.url) ? <InlineVideo url={post.url} title={post.title} poster={post.thumbnail_url}/> : <Thumb post={post}/>}
          {post.kind !== 'note' && <p className="social-points">推廣點擊 {post.total_points}</p>}
          <SocialInteractions onTag={selectTag} initialOpen={view.commentsOpen} client={client} post={post} canHide={canHide} onUpdate={update => setItems(current => current.map(item => item.post_id === post.post_id ? {...item, ...update} : item))}/>
          <div className="social-actions">
            {post.url && <a className="btn btn-ghost" href={post.url} target="_blank" rel="noopener noreferrer">開啟原文 ↗</a>}
            {post.kind !== 'note' && <PromotionShare client={client} kind="social_post" target={post.post_id} title={post.title} label="推廣原文"/>}
          </div>
        </div>
      </article>;
  return <section className="social-zone stack" aria-label="社群媒體分享專區" data-feed={platform || 'all'} aria-busy={loading||more}>
    {gameInbox.draft&&<GameDraftNotice draft={gameInbox.draft} busy={preparingImage||publishing||!!pending.current} hasImage={!!composeFile} tooLong={[text.trim(),gameInbox.draft.text].filter(Boolean).join('\n\n').length>2000} error={gameImportError} onImport={()=>void importGame(gameInbox.draft!)} onDiscard={gameInbox.discard}/>}
    <div ref={composerStart} className="card social-composer-start" data-guide-anchor="social:composer">
      <div className="social-composer-prompt"><MemberAvatar nickname={viewer?.name ?? composerText('me')} avatarUrl={viewer?.avatarUrl}/>
        <button ref={composerTrigger} type="button" className="social-write-trigger" aria-label={composerText('title')} aria-haspopup="dialog" onClick={openComposer}><span>{pending.current ? composerText('resumePending') : text ? composerText('resume') : composerText('prompt')}</span></button>
      </div>
    </div>
    <dialog ref={composer} className="social-publish-dialog" aria-labelledby={composerId} onCancel={event => {if(event.target!==event.currentTarget)return;event.preventDefault(); closeComposer();}} onClose={() => setComposerOpen(false)}>
      {composerOpen && <div className="stack">
        <header className="social-publish-head"><h2 id={composerId}>{composerText('title')}</h2><button type="button" className="btn btn-ghost" aria-label={composerText('closeLabel')} onClick={closeComposer}>{composerText('close')}</button></header>
        <p className="social-publish-identity"><span aria-hidden="true"><MemberAvatar nickname={viewer?.name ?? composerText('me')} avatarUrl={viewer?.avatarUrl}/></span><span>{viewer?.name ?? composerText('me')}<small>{composerText(linkPreview&&composeFile?'previewVisibility':'visibility')}</small></span></p>
        {importedGame.current?.generation===client.sessionGeneration&&<p className="field-hint">剛才的離譜成果已帶入。確認圖片、文案與作者後，再按發布。</p>}
        <form className="social-native-composer stack" onSubmit={event => void publish(event)} aria-busy={publishing}>
          <label className="field"><span className="sr-only">{composerText('content')}</span><textarea aria-label={composerText('content')} autoFocus required={!linkPreview} rows={6} maxLength={2000} placeholder={composerText('placeholder')} value={text} disabled={publishing || !!pending.current} onChange={event => setText(event.target.value, (event.nativeEvent as InputEvent).inputType?.startsWith('insertFrom') ? 'replace' : 'typing')} onBlur={() => setTextHistory(breakTextGroup)} onKeyDown={event=>{if(event.nativeEvent.isComposing||event.altKey||!(event.ctrlKey||event.metaKey)||!['z','y'].includes(event.key.toLowerCase()))return;event.preventDefault();if(!publishing&&!pending.current)setTextHistory(event.key.toLowerCase()==='y'||event.shiftKey?redoText:undoText);}} onPaste={event=>{const photo=[...event.clipboardData.files].find(f=>f.type.startsWith('image/'));if(photo&&!publishing&&!pending.current){event.preventDefault();void selectComposeImage(photo);}}}/></label>
          <div className="social-link-option">
            <p className="field-hint">{composerText('linkHint')}</p>
            <label className="social-preview-toggle"><input type="checkbox" checked={linkPreview} disabled={publishing||!!pending.current} aria-controls={`${composerId}-link-preview`} onChange={event=>toggleLinkPreview(event.target.checked)}/>{composerText('linkPreview')}</label>
            {!linkPreview&&url.trim()&&!text.includes(url.trim())&&<div className="social-retained-link">
              <p className="field-hint">{composerText('retainedLink')}</p><p className="social-retained-url">{url}</p>
              <div className="social-actions"><button type="button" className="btn btn-ghost" disabled={publishing||!!pending.current} onClick={insertRetainedLink}>{composerText('insertLink')}</button><button type="button" className="btn btn-ghost" disabled={publishing||!!pending.current} onClick={removeRetainedLink}>{composerText('removeLink')}</button></div>
            </div>}
            {linkPreview&&<div id={`${composerId}-link-preview`} className="social-link-fields stack">
              <p className="field-hint">{composerText('previewHint')}</p>
              <label className="field">{composerText('linkUrl')}<input required type="url" inputMode="url" maxLength={2048} value={url} disabled={publishing||!!pending.current} onChange={event=>setUrl(event.target.value)} placeholder="https://"/></label>
              {youtubeLinkHint(url,shortVideos)&&<p className="field-hint" role="status">{youtubeLinkHint(url,shortVideos)}</p>}
              <label className="field">{composerText('linkTitle')}<input maxLength={120} value={title} disabled={publishing||!!pending.current} onChange={event=>setTitle(event.target.value)}/></label>
              {composeFile&&<p className="field-hint">{composerText('previewPhotoHint')}</p>}
            </div>}
          </div>
          <div className="social-compose-toolbar"><label className="social-topic-select">{composerText('topic')}<select aria-label={composerText('topicLabel')} value={topic} disabled={publishing||!!pending.current} onChange={e=>setTopic(e.target.value as keyof typeof SOCIAL_TOPICS)}>{(Object.keys(SOCIAL_TOPICS) as (keyof typeof SOCIAL_TOPICS)[]).map(key=><option key={key} value={key}>{composerText(key)}</option>)}</select></label><button type="button" className="social-icon-button" aria-label={composerText('photo')} title={composerText('photo')} disabled={publishing||preparingImage||!!pending.current} onClick={()=>composeInput.current?.click()}><SocialIcon name="camera"/></button><SocialTextTools client={client} text={text} onChange={setText} mentions={mentions} onMentions={setMentions} disabled={publishing||!!pending.current} maxLength={2000}/><button type="button" className="social-icon-button" title={composerText('checkIn')} aria-label={composerText('checkIn')} aria-expanded={checkIn} disabled={publishing||!!pending.current} onClick={()=>setCheckIn(v=>!v)}><SocialIcon name="pin"/></button></div>
          <input ref={composeInput} className="sr-only" tabIndex={-1} aria-label={composerText('image')} type="file" accept="image/jpeg,image/png,image/webp" disabled={publishing||preparingImage||!!pending.current} onChange={event=>{void selectComposeImage(event.target.files?.[0]??null);}}/>
          {checkIn&&<label className="field">{composerText('location')}<input aria-label={composerText('location')} placeholder={composerText('locationExample')} maxLength={120} value={locationName} disabled={publishing||!!pending.current} onChange={e=>setLocationName(e.target.value)}/><small className="muted">{composerText('locationHint')}</small></label>}
          <p className="muted">{composerText('imageHint')}</p>
          {preparingImage && <p role="status">{composerText('preparing')}</p>}
          {composeFile && <div className="social-compose-attachment">{composePreview && <img className="social-compose-preview" src={composePreview} alt={composerText('preview')}/>}<span className="muted">{composeFile.name}</span><button type="button" className="btn btn-ghost" disabled={publishing || !!pending.current} onClick={() => selectComposeImage(null)}>{composerText('removeImage')}</button></div>}
          <div className="social-composer-tools"><button type="button" className="btn btn-ghost" disabled={publishing||!!pending.current||!textHistory.past.length} onClick={()=>{setTextHistory(undoText);composer.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus({preventScroll:true});}}>{historyText[0]}</button><button type="button" className="btn btn-ghost" disabled={publishing||!!pending.current||!textHistory.future.length} onClick={()=>{setTextHistory(redoText);composer.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus({preventScroll:true});}}>{historyText[1]}</button><button type="button" className="btn btn-ghost" aria-pressed={optimizerEnabled} aria-expanded={optimizerEnabled} aria-controls={`${composerId}-optimizer`} disabled={publishing||!!pending.current||optimization.phase==='busy'} onClick={()=>setOptimizerEnabled(value=>!value)}>{composerText('optimize')}</button><button ref={shareTrigger} type="button" className="btn btn-ghost" aria-expanded={shareOpen} aria-controls={`${composerId}-share`} disabled={publishing||!!pending.current} onClick={()=>setShareOpen(value=>!value)}>{shareText[0]}</button>{originalDraft&&<button type="button" className="btn btn-ghost" disabled={publishing||!!pending.current||text!==originalDraft.after} onClick={()=>{setText(originalDraft.before,'replace');setOriginalDraft(null);}}>{composerText('restore')}</button>}</div>
          {optimizerEnabled&&<div id={`${composerId}-optimizer`}><ShareLoadBoundary key={optimizerLoader.attempt} fallback={cause=>{const retryUrl=shareModuleRetryUrl(cause,location.origin,optimizerLoader.attempt+1,'SocialPostOptimizer');return <div className="banner banner-error"><p role="alert">{historyText[3]}</p>{retryUrl&&<button type="button" className="btn btn-ghost" disabled={publishing||!!pending.current} onClick={()=>setOptimizerLoader(current=>({component:optimizerPanelLoader(retryUrl),attempt:current.attempt+1}))}>{historyText[4]}</button>}</div>;}}><Suspense fallback={<p role="status">{historyText[2]}</p>}><Optimizer client={client} job={optimizationJob} draft={text} disabled={publishing||!!pending.current} onRecoverDraft={draft=>{setOriginalDraft({before:text,after:draft});setText(draft,'replace');}} onApply={result=>{setOriginalDraft({before:text,after:result});setText(result,'replace');optimizationJob.adopt();}}/></Suspense></ShareLoadBoundary></div>}
          {shareOpen&&<div id={`${composerId}-share`}><ShareLoadBoundary key={shareLoader.attempt} fallback={cause=>{const retryUrl=shareModuleRetryUrl(cause,location.origin,shareLoader.attempt+1);return <div className="banner banner-error"><p role="alert">{shareText[3]}</p>{retryUrl&&<button type="button" className="btn btn-ghost" disabled={publishing||!!pending.current} onClick={()=>setShareLoader(current=>({component:sharePanelLoader(retryUrl),attempt:current.attempt+1}))}>{shareText[4]}</button>}</div>;}}><Suspense fallback={<p role="status">{shareText[1]}</p>}><CrossPlatformShare client={client} draft={text} disabled={publishing||!!pending.current} onRestore={value=>{setOriginalDraft({before:text,after:value});setText(value,'replace');}} onClose={()=>{setShareOpen(false);shareTrigger.current?.focus({preventScroll:true});}}/></Suspense></ShareLoadBoundary></div>}
          <div className="social-composer-footer"><span className="muted">{text.length}/2000</span><button className="btn btn-primary" disabled={publishing || preparingImage || (!text.trim()&&!linkPreview)}>{publishing ? composerText('publishing') : pending.current?.kind==='link'&&pending.current.created ? composerText('retryThumbnail') : pending.current ? composerText('retry') : shareOpen?shareText[2]:composerText('publish')}</button></div>
          {publishError && <p className="banner banner-error" role="alert">{composerFeedback(publishError)}</p>}
        </form>
      </div>}
    </dialog>
    <dialog ref={options} className="social-publish-dialog social-options-dialog" aria-labelledby={`${composerId}-options`} onCancel={event=>{event.preventDefault();closeOptions();}} onClose={()=>setOptionsOpen(false)}>
      {optionsOpen && <div className="stack">
        <header className="social-publish-head"><h2 id={`${composerId}-options`}>{feedText.options}</h2><button type="button" className="btn btn-ghost" aria-label={feedText.closeOptions} onClick={closeOptions}>{feedText.close}</button></header>
        <div className="social-view-options" role="group" aria-label={feedText.filters}>{FILTERS.filter(item=>item.id!=='shorts'||shortVideos).map(item=><button key={item.id||'all'} type="button" className="btn btn-ghost social-filter" aria-pressed={platform===item.id} onClick={()=>{selectPlatform(item.id);closeOptions();}}>{filterLabel(item.id,item.label)}</button>)}</div>
      </div>}
    </dialog>
    <dialog ref={deleteDialog} className="social-publish-dialog social-delete-dialog" aria-labelledby={`${composerId}-delete`} aria-describedby={`${composerId}-delete-detail`} onCancel={event => {event.preventDefault(); closeDelete();}} onClose={() => setConfirming(null)}>
      {confirming && <div className="stack">
        <h2 id={`${composerId}-delete`}>刪除貼文？</h2>
        <p id={`${composerId}-delete-detail`}>刪除後無法復原，貼文、圖片與留言都不再顯示。</p>
        <div className="social-composer-footer"><button type="button" className="btn btn-ghost" disabled={saving} onClick={closeDelete}>取消</button><button type="button" className="btn btn-primary" disabled={saving} onClick={() => {const post = items.find(item => item.post_id === confirming); if (post) void remove(post);}}>{saving ? '刪除中…' : '確定刪除'}</button></div>
        {deleteError && <p className="banner banner-error" role="alert">{deleteError}</p>}
      </div>}
    </dialog>
    <SocialPostEditor client={client} post={editingPost} onClose={()=>setEditingPost(null)} onSaved={saved=>{
      ++confirmedWrites.current;
      const update=(item:Post)=>item.post_id===saved.post_id&&saved.revision>item.revision?{...item,title:saved.title,note:saved.note,edited_at:saved.edited_at,revision:saved.revision,tags:saved.tags,mentions:saved.mentions}:item;
      newPosts.current=newPosts.current.map(update);
      setItems(current=>current.map(update));setNotice('貼文已更新。');}}/>
    {notice && <p className="social-feedback" role="status">{notice===composerMessages.published[0]?composerText('published'):notice}</p>}
    {error && <div className="banner banner-error" role="alert"><p>{error}</p><button type="button" className="btn btn-ghost" disabled={loading || more} onClick={retryFeed}>重試</button></div>}
    {actionError && <div className="banner banner-error" role="alert"><p>{actionError}</p><p>重新載入只更新貼文狀態，不會重送操作或確認圖片已更新。若要更換縮圖，請重新選取圖片。</p><button type="button" className="btn btn-ghost" disabled={loading || more || saving} onClick={refreshAfterAction}>重新載入貼文狀態</button><button type="button" className="btn btn-ghost" onClick={() => setActionError('')}>關閉提示</button></div>}
    <div className="social-feed-heading" data-guide-anchor="social:platform">
      <h2>{directPost?'這則貼文':filterLabel(platform,FILTERS.find(item=>item.id===platform)?.label??'')}</h2>
      <div>{directPost&&<button type="button" className="btn btn-ghost" onClick={clearDirectPost}>回到動態牆</button>}<button type="button" className="social-feed-control" aria-label={feedText.refresh} title={feedText.refresh} disabled={loading} onClick={()=>void load(platform)}>↻</button><button ref={optionsTrigger} type="button" className="social-feed-control social-feed-more" aria-label={feedText.options} aria-haspopup="dialog" aria-expanded={optionsOpen} onClick={()=>setOptionsOpen(true)}><span aria-hidden="true">⋯</span><span>{feedText.options}</span></button></div>
    </div>
    <div className="social-feed-navigation" role="group" aria-label={feedText.filters}>
      {FILTERS.filter(item=>item.id==='note'||item.id===''||(item.id==='shorts'&&shortVideos)).map(item=><button key={item.id||'all'} type="button" className="social-feed-category" aria-pressed={!directPost&&platform===item.id} onClick={()=>selectPlatform(item.id)}>{filterLabel(item.id,item.label)}</button>)}
    </div>
    {tag&&<p className="social-active-tag">#{tag}<button type="button" className="social-text-link" onClick={()=>selectTag('')}>清除標籤篩選</button></p>}
    {loading && <p role="status">正在載入貼文…</p>}
    {!loading && !error && items.length === 0 && !(platform === 'shorts' && !directPost) && <p className="empty">{directPost?'這則貼文已刪除、隱藏，或你目前沒有閱覽權限。':platform ? '這個分類還沒有貼文。' : '還沒有動態。分享第一則近況，和夥伴開始聊聊。'}</p>}
    {platform === 'shorts' && !directPost && !loading && (!error || Boolean(failedFeedLoad.current?.cursor)) && <ShortVideoFeed posts={items} hasMore={Boolean(cursor) && !error} loadingMore={more} onLoadMore={() => { if (cursor && !error && !failedFeedLoad.current) void load(platform, cursor); }} onRefresh={() => refreshShorts(items.length)} onManage={(post, trigger) => { shortTrigger.current = trigger; setShortComments(false); setShortPostId(post.post_id); }} onComment={(post, trigger) => { shortTrigger.current = trigger; setShortComments(true); setShortPostId(post.post_id); }} onLike={post => void likeShort(post.post_id)} likeBusy={shortLiking} renderShare={post => { const full = items.find(item => item.post_id === post.post_id); return full ? <SocialPostShare client={client} post={full}/> : null; }}/>}
    {shortPost && <dialog ref={shortDialog} className="short-video-post-dialog" aria-label={shortComments ? '貼文留言' : '貼文選項與檢舉'} onClose={() => setShortPostId(null)} onCancel={() => setShortPostId(null)}>
      <button type="button" className="btn btn-ghost short-video-post-dialog-close" onClick={() => shortDialog.current?.close()}>關閉</button>
      {renderCard(shortPost, {inline: false, commentsOpen: shortComments})}
    </dialog>}
    <div className="social-grid">
      {(platform === 'shorts' && !directPost ? [] : items).map(post => renderCard(post))}
    </div>
    {cursor && !(platform === 'shorts' && !directPost) && <button type="button" className="btn btn-ghost" disabled={loading || more} onClick={() => void load(platform, cursor)}>{more ? '正在載入…' : '載入更多'}</button>}
  </section>;
}
