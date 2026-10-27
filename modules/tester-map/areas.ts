// Static test plan for the 人才與方向公會 community test week. No backend,
// database or permission is created here; every entry points at existing code.
// Text order matches the interface catalog: zh-Hant, en, ja, ko, es.
export type Localized = readonly [string, string, string, string, string];

export const TESTER_GROUP_IDS = ['A', 'B', 'C', 'D', 'E'] as const;
export type TesterGroupId = typeof TESTER_GROUP_IDS[number];

export const TESTER_GROUPS: Record<TesterGroupId, { name: Localized; detail: Localized }> = {
  A: {
    name: ['新朋友・手機', 'Newcomer · phone', '新規・スマホ', '신규 · 휴대폰', 'Nuevo · móvil'],
    detail: ['第一次來，用手機從註冊開始。', 'First visit, starting from sign-up on a phone.', '初めての利用。スマホで登録から始めます。', '처음 방문, 휴대폰으로 가입부터 시작합니다.', 'Primera visita: empieza por el registro en el móvil.'],
  },
  B: {
    name: ['新朋友・電腦', 'Newcomer · computer', '新規・パソコン', '신규 · 컴퓨터', 'Nuevo · ordenador'],
    detail: ['第一次來，用電腦瀏覽器從註冊開始。', 'First visit, starting from sign-up in a desktop browser.', '初めての利用。パソコンのブラウザーで登録から始めます。', '처음 방문, 컴퓨터 브라우저로 가입부터 시작합니다.', 'Primera visita: empieza por el registro en un navegador de escritorio.'],
  },
  C: {
    name: ['老成員・手機', 'Existing member · phone', '既存メンバー・スマホ', '기존 회원 · 휴대폰', 'Miembro actual · móvil'],
    detail: ['已有帳號與公會，用手機做日常操作。', 'Already has an account and guild; everyday use on a phone.', 'アカウントとギルドがあり、スマホで普段の操作をします。', '계정과 길드가 있고 휴대폰으로 일상적으로 사용합니다.', 'Ya tiene cuenta y gremio; uso diario en el móvil.'],
  },
  D: {
    name: ['老成員・電腦', 'Existing member · computer', '既存メンバー・パソコン', '기존 회원 · 컴퓨터', 'Miembro actual · ordenador'],
    detail: ['已有帳號與公會，用電腦做日常操作。', 'Already has an account and guild; everyday use on a computer.', 'アカウントとギルドがあり、パソコンで普段の操作をします。', '계정과 길드가 있고 컴퓨터로 일상적으로 사용합니다.', 'Ya tiene cuenta y gremio; uso diario en el ordenador.'],
  },
  E: {
    name: ['進階', 'Advanced', '上級', '고급', 'Avanzado'],
    detail: ['測試商務與貢獻流程；只用測試資料，不做真實交易或付款。', 'Tests commerce and contribution flows with test data only. No real transactions or payments.', '商取引と貢献の流れをテストします。テストデータのみを使い、実際の取引や支払いはしません。', '상거래와 기여 흐름을 테스트합니다. 테스트 데이터만 사용하고 실제 거래나 결제는 하지 않습니다.', 'Prueba comercio y contribuciones solo con datos de prueba, sin transacciones ni pagos reales.'],
  },
};

// Every member-visible flag in GET /api/v1/site (apps/platform-api/src/platform-app.ts),
// plus the private AI runtime switch from wrangler.jsonc. In code each one is off unless
// the deployment turns it on. `observed` is the public site on 2026-10-25; it is a dated
// observation, not configuration. Update it by PR when /api/v1/site changes.
export const TESTER_FLAGS_OBSERVED_AT = '2026-10-25';
export const TESTER_FLAGS = {
  registration_enabled: 'on',
  password_recovery_enabled: 'on',
  demo_accounts_enabled: 'off',
  guild_launchpad_enabled: 'on',
  community_discovery_enabled: 'off',
  member_blocking_enabled: 'on',
  member_reporting_enabled: 'off',
  // Local candidate default only; not part of the dated public-site observation.
  social_achievements_enabled: 'off',
  community_search_enabled: 'on',
  community_relations_enabled: 'off',
  unified_sharing_enabled: 'off',
  personal_content_enabled: 'on',
  ar_enabled: 'off',
  short_videos_enabled: 'on',
  skill_book_star_gate_enabled: 'off',
  message_images_enabled: 'on',
  event_participation_enabled: 'off',
  notification_preferences_enabled: 'on',
  first_participation_enabled: 'off',
  squad_outcomes_enabled: 'off',
  event_outcomes_enabled: 'off',
  commerce_console_enabled: 'on',
  supplier_console_enabled: 'on',
  commerce_checkout_enabled: 'off',
  commerce_drop_ship_enabled: 'off',
  commerce_self_ship_enabled: 'off',
  hosted_store_photos_enabled: 'on',
  hosted_store_photo_uploads_enabled: 'off',
  distribution_photos_enabled: 'off',
  supply_offer_photos_enabled: 'off',
  store_appearance_enabled: 'off',
  store_policies_enabled: 'off',
  store_gallery_enabled: 'off',
  store_variants_enabled: 'off',
  store_categories_enabled: 'off',
  supply_material_media_enabled: 'off',
  supply_material_uploads_enabled: 'off',
  FREEDOM_PRIVATE_AI_ENABLED: 'off',
} as const satisfies Record<string, 'on' | 'off'>;
export type TesterFlag = keyof typeof TESTER_FLAGS;
// Site fields that describe the deployment rather than a feature someone can test.
export const TESTER_NON_FEATURE_SITE_FIELDS = ['public_mode'] as const;

export type TesterAccess = 'admin' | 'guild-manager';
export type TesterFeature = {
  id: string;
  name: Localized;
  /** Existing TabId or modules/development/pages.ts id; drives the page tool label and coverage checks. */
  pages?: readonly string[];
  /** Where a tester opens it. Hash routes stay inside the portal. */
  href?: string;
  flag?: TesterFlag;
  access?: TesterAccess;
  /** PR numbers merged in the #1015 redesign batch. */
  redesign?: readonly number[];
};
export type TesterArea = { id: string; name: Localized; summary: Localized; owners: readonly TesterGroupId[]; features: readonly TesterFeature[] };

export const REDESIGN_BATCH_PR = 1015;
export const TEST_WEEK = { start: '2026-10-26', end: '2026-11-01' } as const;
export const TESTER_GUILD = { key: 'guild_talent_direction', leaderNickname: '我不是JasonC' } as const;
export const ISSUES_URL = 'https://github.com/FreeTWAI/freedom-platform/issues';

export const TESTER_AREAS: readonly TesterArea[] = [
  {
    id: 'entry', owners: ['A', 'B'],
    name: ['入口、註冊與加入', 'Entry, sign-up and joining', '入口・登録・参加', '입구 · 가입 · 참여', 'Entrada, registro y unión'],
    summary: ['從沒有帳號開始，到選好主要公會。', 'From no account to choosing a main guild.', 'アカウントなしからメインギルドを選ぶまで。', '계정이 없는 상태부터 주 길드 선택까지.', 'Desde no tener cuenta hasta elegir el gremio principal.'],
    features: [
      { id: 'entry.preview', pages: ['registration'], href: '/', redesign: [1004], name: ['登入前免費預覽', 'Free preview before signing in', 'ログイン前の無料プレビュー', '로그인 전 무료 미리보기', 'Vista previa gratuita antes de iniciar sesión'] },
      { id: 'entry.register', pages: ['registration'], href: '/', flag: 'registration_enabled', name: ['Email 註冊', 'Email sign-up', 'メールで登録', '이메일 가입', 'Registro con email'] },
      { id: 'entry.login', pages: ['registration'], href: '/', name: ['登入、登出與兩步驟驗證登入', 'Sign in, sign out and two-step sign-in', 'ログイン・ログアウト・2段階認証', '로그인 · 로그아웃 · 2단계 로그인', 'Iniciar y cerrar sesión, verificación en dos pasos'] },
      { id: 'entry.password', pages: ['registration'], href: '/', flag: 'password_recovery_enabled', name: ['忘記密碼與重設', 'Forgot and reset password', 'パスワードの再設定', '비밀번호 찾기와 재설정', 'Recuperar y restablecer la contraseña'] },
      { id: 'entry.email', pages: ['registration'], name: ['Email 驗證連結', 'Email verification link', 'メール認証リンク', '이메일 인증 링크', 'Enlace de verificación del email'] },
      { id: 'entry.join', pages: ['onboarding'], name: ['選主要公會完成加入', 'Join by choosing a main guild', 'メインギルドを選んで参加', '주 길드를 골라 참여 완료', 'Unirse eligiendo el gremio principal'] },
      { id: 'entry.positioning', pages: ['onboarding', 'positioning'], href: '#positioning', name: ['定位測驗（選填）與我的定位', 'Optional direction quiz and My direction', '方向性テスト（任意）と自分の方向性', '방향 테스트(선택)와 내 방향', 'Test de orientación (opcional) y Mi orientación'] },
      { id: 'entry.newbie-village', pages: ['newbie-village'], href: '#newbie-village', name: ['新手村任務', 'Newbie Village Quests', 'はじめの村クエスト', '초보 마을 퀘스트', 'Misiones de la aldea inicial'] },
      { id: 'entry.public', href: '/', name: ['未登入閱讀公開貼文、技能書與公會頁', 'Reading public posts, skill books and guild pages signed out', '未ログインで公開投稿・スキルブック・ギルドページを読む', '로그인 없이 공개 글 · 스킬북 · 길드 페이지 읽기', 'Leer publicaciones, libros y gremios públicos sin sesión'] },
      { id: 'entry.discovery', flag: 'community_discovery_enabled', name: ['訪客探索社群內容與活動', 'Guest discovery of content and events', 'ゲストによるコンテンツとイベントの探索', '방문자 콘텐츠 · 행사 둘러보기', 'Exploración de contenido y eventos para invitados'] },
      { id: 'entry.demo', flag: 'demo_accounts_enabled', name: ['示範帳號（僅本機）', 'Demo accounts (local only)', 'デモアカウント（ローカルのみ）', '데모 계정(로컬 전용)', 'Cuentas de demostración (solo local)'] },
    ],
  },
  {
    id: 'home', owners: ['C', 'D'],
    name: ['會員首頁與動態', 'Member home and feed', '会員ホームとフィード', '회원 홈과 피드', 'Inicio y publicaciones'],
    summary: ['首頁、發文、分類切換、按讚與留言。', 'Home, posting, feed categories, likes and comments.', 'ホーム、投稿、カテゴリー切り替え、いいねとコメント。', '홈, 글쓰기, 분류 전환, 좋아요와 댓글.', 'Inicio, publicar, categorías, me gusta y comentarios.'],
    features: [
      { id: 'home.home', pages: ['home'], href: '#home', redesign: [1011], name: ['精簡會員首頁（動態優先）', 'Concise home (feed first)', 'シンプルな会員ホーム（フィード優先）', '간결한 회원 홈(피드 우선)', 'Inicio simplificado (primero las publicaciones)'] },
      { id: 'home.explore', pages: ['home'], href: '#home', redesign: [1011], name: ['「探索學習與公會」展開區與「閱讀技能書」', '“Explore learning and guilds” section and “Read skill book”', '「学習とギルドを探す」と「スキルブックを読む」', '“학습과 길드 둘러보기” 영역과 “스킬북 읽기”', 'Sección «Explorar aprendizaje y gremios» y «Leer libro»'] },
      { id: 'home.categories', pages: ['home', 'social'], href: '#home', redesign: [1005], name: ['動態分類：社群貼文／全部貼文／Short', 'Feed categories: community posts / all posts / Short', 'フィード分類：コミュニティ投稿／すべて／Short', '피드 분류: 커뮤니티 글 / 전체 / Short', 'Categorías: comunidad / todas / Short'] },
      { id: 'home.compose', pages: ['social'], href: '#home', redesign: [1005], name: ['建立貼文與發文卡內的分享外部連結', 'Create a post and share an external link from the post card', '投稿の作成と投稿カード内の外部リンク共有', '글쓰기와 글쓰기 카드의 외부 링크 공유', 'Crear publicación y compartir enlace externo desde la tarjeta'] },
      { id: 'home.interactions', pages: ['social'], href: '#home', redesign: [993, 994, 999], name: ['按讚、留言與留言已讀', 'Likes, comments and comment read state', 'いいね・コメント・既読', '좋아요 · 댓글 · 댓글 읽음', 'Me gusta, comentarios y leídos'] },
      { id: 'home.short', pages: ['social'], flag: 'short_videos_enabled', name: ['Short 短影音', 'Short videos', 'Short 動画', 'Short 짧은 영상', 'Vídeos Short'] },
      { id: 'home.sharing', flag: 'unified_sharing_enabled', name: ['統一分享面板', 'Unified sharing panel', '共有パネルの統合', '통합 공유 패널', 'Panel de compartir unificado'] },
    ],
  },
  {
    id: 'guilds', owners: ['A', 'D'],
    name: ['職業公會', 'Guilds', 'ギルド', '길드', 'Gremios'],
    summary: ['加入公會、進入公會與公開公會頁。', 'Joining and entering guilds, and public guild pages.', 'ギルドへの参加・入室と公開ギルドページ。', '길드 가입 · 입장과 공개 길드 페이지.', 'Unirse y entrar en gremios, y páginas públicas.'],
    features: [
      { id: 'guilds.list', pages: ['guilds'], href: '#guilds', name: ['公會列表與主要／次要公會', 'Guild list and main/secondary guilds', 'ギルド一覧とメイン／サブギルド', '길드 목록과 주 / 보조 길드', 'Lista de gremios y gremio principal/secundario'] },
      { id: 'guilds.dialog', pages: ['guilds'], href: '#guilds', redesign: [1012], name: ['「進入公會」對話框：總覽／公告／成員／技能書庫', '“Enter guild” dialog: overview / announcements / members / library', '「ギルドに入る」：概要／お知らせ／メンバー／書庫', '“길드 입장” 대화상자: 개요 / 공지 / 멤버 / 서고', 'Diálogo «Entrar al gremio»: resumen / avisos / miembros / biblioteca'] },
      { id: 'guilds.public', pages: ['guilds'], href: '#guilds/guild_talent_direction', flag: 'guild_launchpad_enabled', name: ['公開公會頁：查看技能書、聯絡公會、複製網址', 'Public guild page: skill books, contact, copy link', '公開ギルドページ：スキルブック・連絡・URLコピー', '공개 길드 페이지: 스킬북 · 연락 · 주소 복사', 'Página pública: libros, contacto, copiar enlace'] },
      { id: 'guilds.launchpad', pages: ['guilds'], flag: 'guild_launchpad_enabled', name: ['公會啟動台工作區', 'Guild launchpad workspaces', 'ギルドのランチパッド', '길드 런치패드 작업 공간', 'Espacios de trabajo del gremio'] },
      { id: 'guilds.manage', pages: ['guild-workspace'], href: '#guild-workspace', access: 'guild-manager', name: ['公會管理：公告、技能書與幹部', 'Guild management: announcements, skill books, officers', 'ギルド管理：お知らせ・スキルブック・役員', '길드 관리: 공지 · 스킬북 · 임원', 'Gestión: avisos, libros y responsables'] },
      { id: 'guilds.config', pages: ['guild-workspace'], flag: 'guild_launchpad_enabled', access: 'guild-manager', name: ['公會啟動台設定與委派', 'Launchpad settings and delegation', 'ランチパッド設定と委任', '런치패드 설정과 위임', 'Ajustes y delegación del gremio'] },
    ],
  },
  {
    id: 'skills', owners: ['B', 'D'],
    name: ['技能書', 'Skill books', 'スキルブック', '스킬북', 'Libros de habilidades'],
    summary: ['探索、預覽、閱讀技能書與 GitHub 操作。', 'Exploring, previewing and reading skill books, plus GitHub actions.', 'スキルブックの探索・プレビュー・閲覧と GitHub 操作。', '스킬북 탐색 · 미리보기 · 읽기와 GitHub 작업.', 'Explorar, previsualizar y leer libros, y acciones de GitHub.'],
    features: [
      { id: 'skills.shelf', pages: ['skills'], href: '#skills', redesign: [1000], name: ['技能書架：社群技能書與公會指定技能書', 'Shelf: community and guild skill books', '本棚：コミュニティとギルド指定のスキルブック', '서가: 커뮤니티와 길드 지정 스킬북', 'Estante: libros de la comunidad y del gremio'] },
      { id: 'skills.read', pages: ['skillbooks'], href: '#skills', redesign: [1000], name: ['技能書介紹與閱讀流程', 'Skill book introduction and reading', 'スキルブックの紹介と閲覧', '스킬북 소개와 읽기', 'Presentación y lectura del libro'] },
      { id: 'skills.github', pages: ['skills', 'todos'], name: ['GitHub Star／Fork 與連結 GitHub', 'GitHub Star/Fork and connecting GitHub', 'GitHub の Star／Fork と連携', 'GitHub Star / Fork와 연결', 'Star/Fork en GitHub y conexión'] },
      { id: 'skills.star-gate', flag: 'skill_book_star_gate_enabled', name: ['按 Star 後解鎖技能書', 'Unlock a skill book after starring', 'Star でスキルブックを解放', 'Star 후 스킬북 잠금 해제', 'Desbloquear libro tras dar Star'] },
      { id: 'skills.guides', href: '/development', name: ['公開開發指引（/development）', 'Public development guides (/development)', '公開開発ガイド（/development）', '공개 개발 안내(/development)', 'Guías públicas de desarrollo (/development)'] },
    ],
  },
  {
    id: 'profile', owners: ['C', 'D'],
    name: ['個人空間與帳號', 'Personal space and account', '個人スペースとアカウント', '개인 공간과 계정', 'Espacio personal y cuenta'],
    summary: ['#profile、頭像選單、名片、我的內容與帳號安全。', '#profile, avatar menu, profile card, My content and account security.', '#profile、アバターメニュー、名刺、自分のコンテンツ、セキュリティ。', '#profile, 아바타 메뉴, 프로필 카드, 내 콘텐츠, 계정 보안.', '#profile, menú del avatar, tarjeta, Mi contenido y seguridad.'],
    features: [
      { id: 'profile.space', pages: ['profile'], href: '#profile', redesign: [1010], name: ['#profile 本人空間（非公開牆）', '#profile personal space (not a public wall)', '#profile 個人スペース（公開ウォールではない）', '#profile 개인 공간(공개 담벼락 아님)', '#profile espacio personal (no es un muro público)'] },
      { id: 'profile.menu', pages: ['profile', 'account'], redesign: [1010], name: ['頭像選單：語言（5 種）與外觀（5 種）', 'Avatar menu: language (5) and appearance (5)', 'アバターメニュー：言語（5）と外観（5）', '아바타 메뉴: 언어(5)와 테마(5)', 'Menú del avatar: idioma (5) y apariencia (5)'] },
      { id: 'profile.card', pages: ['account'], href: '#account', name: ['我的名片、頭像與公開範圍', 'Profile card, avatar and visibility', '名刺・アバター・公開範囲', '프로필 카드 · 아바타 · 공개 범위', 'Tarjeta, avatar y visibilidad'] },
      { id: 'profile.social-titles', pages: ['account'], flag: 'social_achievements_enabled', name: ['自願累積社群稱號（未啟用候選）', 'Opt-in social titles (disabled candidate)', '任意参加の称号（無効の候補）', '선택 참여 칭호(비활성 후보)', 'Títulos voluntarios (candidato desactivado)'] },
      { id: 'profile.security', pages: ['account'], href: '#account', name: ['兩步驟驗證、更換 Email 與停用帳號', 'Two-step verification, email change and deactivation', '2段階認証・メール変更・アカウント停止', '2단계 인증 · 이메일 변경 · 계정 비활성화', 'Verificación en dos pasos, cambio de email y desactivación'] },
      { id: 'profile.content', pages: ['my-content'], href: '#my-content', flag: 'personal_content_enabled', name: ['我的內容：草稿與發布狀態', 'My content: drafts and publishing status', '自分のコンテンツ：下書きと公開状況', '내 콘텐츠: 초안과 게시 상태', 'Mi contenido: borradores y estado'] },
      { id: 'profile.todos', pages: ['todos'], href: '#todos', name: ['入門指南', 'Getting started', 'はじめに', '시작 안내', 'Primeros pasos'] },
    ],
  },
  {
    id: 'people', owners: ['C'],
    name: ['夥伴、好友與小隊', 'Members, friends and groups', '仲間・友達・グループ', '회원 · 친구 · 그룹', 'Miembros, amigos y grupos'],
    summary: ['找夥伴、好友邀請、小隊與封鎖。', 'Finding members, friend invitations, groups and blocking.', '仲間探し、友達招待、グループ、ブロック。', '회원 찾기, 친구 초대, 그룹, 차단.', 'Buscar miembros, invitaciones, grupos y bloqueo.'],
    features: [
      { id: 'people.members', pages: ['members'], href: '#members', name: ['工坊夥伴名錄', 'Member directory', 'メンバー一覧', '회원 목록', 'Directorio de miembros'] },
      { id: 'people.friends', pages: ['friends'], href: '#friends', name: ['好友與邀請', 'Friends and invitations', '友達と招待', '친구와 초대', 'Amigos e invitaciones'] },
      { id: 'people.squads', pages: ['squads'], href: '#squads', name: ['小隊集合', 'Groups', 'グループ', '그룹', 'Grupos'] },
      { id: 'people.blocking', flag: 'member_blocking_enabled', name: ['封鎖會員', 'Blocking members', 'メンバーのブロック', '회원 차단', 'Bloquear miembros'] },
      { id: 'people.reporting', flag: 'member_reporting_enabled', name: ['站內檢舉', 'In-site reporting', 'サイト内通報', '사이트 내 신고', 'Denuncias en el sitio'] },
      { id: 'people.squad-outcomes', pages: ['squads'], flag: 'squad_outcomes_enabled', name: ['小隊成果頁', 'Group outcome pages', 'グループの成果ページ', '그룹 성과 페이지', 'Páginas de resultados del grupo'] },
      { id: 'people.first', flag: 'first_participation_enabled', name: ['首次參與引導', 'First participation guide', '初めての参加ガイド', '첫 참여 안내', 'Guía de primera participación'] },
    ],
  },
  {
    id: 'chat', owners: ['A', 'C'],
    name: ['訊息與聊天', 'Messages and chat', 'メッセージとチャット', '메시지와 채팅', 'Mensajes y chat'],
    summary: ['右下角聊天：私訊、公會、群組、世界聊天。', 'Bottom-right chat: direct, guild, group and world chat.', '右下のチャット：DM・ギルド・グループ・ワールド。', '오른쪽 아래 채팅: 개인 · 길드 · 그룹 · 전체.', 'Chat abajo a la derecha: directo, gremio, grupo y mundo.'],
    features: [
      { id: 'chat.panel', pages: ['messages'], href: '#messages', name: ['聊天面板：私訊、公會、群組、世界聊天', 'Chat panel: direct, guild, group and world chat', 'チャット：DM・ギルド・グループ・ワールド', '채팅: 개인 · 길드 · 그룹 · 전체', 'Chat: directo, gremio, grupo y mundo'] },
      { id: 'chat.mobile', pages: ['messages'], href: '#messages', name: ['手機聊天視窗、鍵盤與收合', 'Phone chat view, keyboard and collapse', 'スマホのチャット画面・キーボード・折りたたみ', '휴대폰 채팅 · 키보드 · 접기', 'Chat en móvil, teclado y plegado'] },
      { id: 'chat.history', pages: ['messages'], href: '#messages', redesign: [995, 997], name: ['長對話載入、捲動與已讀', 'Long conversation loading, scrolling and read receipts', '長い会話の読み込み・スクロール・既読', '긴 대화 불러오기 · 스크롤 · 읽음', 'Carga, desplazamiento y leídos en chats largos'] },
      { id: 'chat.stickers', pages: ['messages'], href: '#messages', redesign: [1013], name: ['貼圖送出前預覽', 'Sticker preview before sending', '送信前のスタンププレビュー', '보내기 전 스티커 미리보기', 'Vista previa del sticker antes de enviar'] },
      { id: 'chat.images', pages: ['messages'], flag: 'message_images_enabled', name: ['訊息圖片', 'Images in messages', 'メッセージの画像', '메시지 이미지', 'Imágenes en mensajes'] },
    ],
  },
  {
    id: 'notifications', owners: ['C', 'D'],
    name: ['通知', 'Notifications', '通知', '알림', 'Notificaciones'],
    summary: ['通知鈴、已讀同步與通知偏好。', 'Bell, read sync and notification preferences.', '通知ベル、既読の同期、通知設定。', '알림 벨, 읽음 동기화, 알림 설정.', 'Campana, sincronización de leídos y preferencias.'],
    features: [
      { id: 'notify.bell', pages: ['messages'], name: ['通知鈴與完整通知清單', 'Bell and full notification list', '通知ベルと通知一覧', '알림 벨과 전체 알림 목록', 'Campana y lista completa'] },
      { id: 'notify.read', pages: ['messages'], redesign: [1006], name: ['全部標為已讀與跨分頁已讀同步', 'Mark all as read and read sync across tabs', 'すべて既読と既読の同期', '모두 읽음과 읽음 동기화', 'Marcar todo como leído y sincronizar'] },
      { id: 'notify.preferences', pages: ['account'], flag: 'notification_preferences_enabled', name: ['通知偏好設定', 'Notification preferences', '通知設定', '알림 설정', 'Preferencias de notificación'] },
    ],
  },
  {
    id: 'search', owners: ['B', 'D'],
    name: ['搜尋', 'Search', '検索', '검색', 'Búsqueda'],
    summary: ['搜尋社群內容、分頁清單與功能搜尋。', 'Community search, paginated lists and feature search.', 'コミュニティ検索、ページ送り、機能検索。', '커뮤니티 검색, 목록 페이지, 기능 찾기.', 'Búsqueda en la comunidad, listas paginadas y funciones.'],
    features: [
      { id: 'search.content', pages: ['community-search'], href: '#community-search', flag: 'community_search_enabled', redesign: [998], name: ['搜尋社群內容（會員與未登入）', 'Community search (members and signed out)', 'コミュニティ検索（会員・未ログイン）', '커뮤니티 검색(회원 · 비로그인)', 'Búsqueda (con y sin sesión)'] },
      { id: 'search.lists', pages: ['community-search', 'friends'], redesign: [998], name: ['分頁清單與切換帳號後的結果', 'Paginated lists and results after switching accounts', 'ページ送りとアカウント切り替え後の結果', '목록 페이지와 계정 전환 후 결과', 'Listas paginadas y resultados al cambiar de cuenta'] },
      { id: 'search.features', name: ['導覽「搜尋功能」', 'Navigation “Find a feature”', 'ナビの「機能を探す」', '내비게이션 “기능 찾기”', '«Buscar una función» en la navegación'] },
      { id: 'search.relations', pages: ['my-content'], flag: 'community_relations_enabled', name: ['書籤與追蹤', 'Bookmarks and follows', 'ブックマークとフォロー', '북마크와 팔로우', 'Marcadores y seguimientos'] },
    ],
  },
  {
    id: 'events', owners: ['B', 'C'],
    name: ['活動與集錦', 'Events and highlights', 'イベントと記録', '행사와 모음', 'Eventos y momentos'],
    summary: ['提交活動、公開活動頁、活動集錦與 AR。', 'Submitting events, public event pages, highlights and AR.', 'イベント投稿、公開ページ、記録、AR。', '행사 제출, 공개 행사 페이지, 모음, AR.', 'Enviar eventos, páginas públicas, momentos y AR.'],
    features: [
      { id: 'events.list', pages: ['events'], href: '#events', name: ['社群活動：提交、審核與行事曆', 'Events: submission, review and calendar', 'イベント：投稿・審査・カレンダー', '행사: 제출 · 검토 · 달력', 'Eventos: envío, revisión y calendario'] },
      { id: 'events.public', pages: ['events'], name: ['公開活動頁', 'Public event page', '公開イベントページ', '공개 행사 페이지', 'Página pública del evento'] },
      { id: 'events.register', pages: ['events'], href: '#events', name: ['活動報名與取消報名（會員卡片、公開頁報名表）', 'Event registration and cancelling (member card, public page form)', 'イベントの申し込みと取り消し（会員カード・公開ページのフォーム）', '행사 신청과 취소(회원 카드 · 공개 페이지 양식)', 'Inscribirse y cancelar (tarjeta de miembro, formulario público)'] },
      // The flag gates only /participation, /waitlist, /waitlist-policy, /schedule, /calendar and /reminder.
      { id: 'events.participation', pages: ['events'], flag: 'event_participation_enabled', name: ['候補名單、行事曆檔與活動提醒', 'Waitlist, calendar file and event reminders', 'キャンセル待ち・カレンダーファイル・リマインダー', '대기 명단 · 캘린더 파일 · 행사 알림', 'Lista de espera, archivo de calendario y recordatorios'] },
      { id: 'events.highlights', pages: ['highlights'], href: '#highlights', name: ['活動集錦（公開回顧）', 'Event highlights (public recap)', 'イベントの記録（公開）', '행사 모음(공개 회고)', 'Momentos de eventos (resumen público)'] },
      { id: 'events.outcomes', pages: ['highlights'], flag: 'event_outcomes_enabled', name: ['活動成果', 'Event outcomes', 'イベントの成果', '행사 성과', 'Resultados del evento'] },
      { id: 'events.ar', pages: ['ar'], href: '#ar', flag: 'ar_enabled', name: ['AR 圖案互動', 'AR experiences', 'AR 図案体験', 'AR 이미지 체험', 'Experiencias AR'] },
    ],
  },
  {
    id: 'contribution', owners: ['E'],
    name: ['任務、作品與貢獻', 'Tasks, work and contributions', 'タスク・作品・貢献', '일감 · 작품 · 기여', 'Tareas, obras y contribuciones'],
    summary: ['頁面工具、任務、投稿與合作紀錄。', 'Page tools, tasks, submissions and collaboration records.', 'ページツール、タスク、投稿、協力記録。', '페이지 도구, 일감, 제출, 협업 기록.', 'Herramientas de página, tareas, envíos y colaboraciones.'],
    features: [
      { id: 'contrib.page-tools', name: ['頁面工具：想法、說明、編修', 'Page tools: idea, help, edit', 'ページツール：アイデア・説明・編集', '페이지 도구: 아이디어 · 도움말 · 편집', 'Herramientas: idea, ayuda, editar'] },
      { id: 'contrib.tasks', pages: ['tasks'], href: '#tasks', name: ['社群任務與 GitHub 排行', 'Community tasks and GitHub rankings', 'コミュニティの仕事と GitHub ランキング', '커뮤니티 일감과 GitHub 순위', 'Tareas y clasificación de GitHub'] },
      { id: 'contrib.cocreation', pages: ['cocreation'], href: '#cocreation', name: ['一起開發', 'Build together', '共同開発', '함께 개발', 'Crear juntos'] },
      { id: 'contrib.workbench', pages: ['workbench'], href: '#workbench', name: ['我的工作：認領與提交', 'My work: claims and submissions', '自分の作業：受託と提出', '내 작업: 맡기와 제출', 'Mi trabajo: reservas y entregas'] },
      { id: 'contrib.showcase', pages: ['showcase'], href: '#showcase', name: ['作品與需求', 'Creations and opportunities', '作品と募集', '작품과 기회', 'Creaciones y oportunidades'] },
      { id: 'contrib.engagement', pages: ['engagement'], href: '#engagement', name: ['合作紀錄', 'Collaborations', '協力の記録', '협업 기록', 'Colaboraciones'] },
      { id: 'contrib.opensource', pages: ['opensource'], href: '#opensource', name: ['開源投稿', 'Share open source', 'オープンソース投稿', '오픈 소스 공유', 'Compartir código abierto'] },
      { id: 'contrib.marketing', pages: ['marketing'], href: '#marketing', name: ['行銷工作室', 'Marketing studio', 'マーケティング', '마케팅 스튜디오', 'Estudio de marketing'] },
      { id: 'contrib.services', pages: ['services'], href: '#services', name: ['社員服務', 'Member services', 'メンバーのサービス', '회원 서비스', 'Servicios de miembros'] },
      { id: 'contrib.promotion', pages: ['promotion'], href: '#promotion', name: ['推廣排行榜', 'Promotion rankings', '紹介ランキング', '홍보 순위', 'Clasificación de difusión'] },
      { id: 'contrib.private-ai', pages: ['private-ai'], flag: 'FREEDOM_PRIVATE_AI_ENABLED', name: ['私人工作與 AI', 'Private work and AI', '非公開の作業とAI', '비공개 작업과 AI', 'Trabajo privado e IA'] },
    ],
  },
  {
    id: 'commerce', owners: ['E'],
    name: ['供貨、商店與訂單', 'Supply, stores and orders', '供給・ショップ・注文', '공급 · 상점 · 주문', 'Suministro, tiendas y pedidos'],
    summary: ['只用測試商品與預留；不付款、不出貨、不成交。', 'Test products and reservations only: no payment, shipping or sale.', 'テスト商品と予約のみ。支払い・発送・成約はしません。', '테스트 상품과 예약만 사용합니다. 결제 · 배송 · 거래 없음.', 'Solo productos y reservas de prueba: sin pago, envío ni venta.'],
    features: [
      { id: 'shop.supplier', pages: ['supplier'], href: '#supplier', name: ['我有東西要賣', 'Offer products', '商品を提供する', '상품 제공', 'Ofrecer productos'] },
      { id: 'shop.retail', pages: ['retail'], href: '#retail', name: ['我可以賣東西', 'Sell products', '商品を販売する', '상품 판매', 'Vender productos'] },
      { id: 'shop.supplier-console', pages: ['supplier-console'], href: '#stores/supply', flag: 'supplier_console_enabled', name: ['供應商營運中心（供貨商品庫）', 'Supplier console (supply catalog)', '供給者コンソール（商品庫）', '공급자 콘솔(공급 상품)', 'Consola del proveedor (catálogo)'] },
      { id: 'shop.stores', pages: ['stores'], href: '#stores', flag: 'commerce_console_enabled', name: ['我的商店：設定、預覽、發布展示頁', 'My stores: set up, preview, publish', 'マイショップ：設定・プレビュー・公開', '내 상점: 설정 · 미리보기 · 게시', 'Mis tiendas: configurar, previsualizar, publicar'] },
      { id: 'shop.photos', pages: ['stores'], flag: 'hosted_store_photos_enabled', name: ['商店照片', 'Store photos', 'ショップの写真', '상점 사진', 'Fotos de la tienda'] },
      { id: 'shop.photo-uploads', pages: ['stores'], flag: 'hosted_store_photo_uploads_enabled', name: ['商店照片上傳', 'Store photo uploads', 'ショップ写真のアップロード', '상점 사진 업로드', 'Subir fotos de la tienda'] },
      { id: 'shop.appearance', pages: ['stores'], flag: 'store_appearance_enabled', name: ['商店外觀', 'Store appearance', 'ショップの外観', '상점 외관', 'Apariencia de la tienda'] },
      { id: 'shop.policies', pages: ['stores'], flag: 'store_policies_enabled', name: ['商店政策頁', 'Store policies', 'ショップのポリシー', '상점 정책', 'Políticas de la tienda'] },
      { id: 'shop.gallery', pages: ['stores'], flag: 'store_gallery_enabled', name: ['商品圖庫', 'Product gallery', '商品ギャラリー', '상품 갤러리', 'Galería de productos'] },
      { id: 'shop.variants', pages: ['stores'], flag: 'store_variants_enabled', name: ['商品規格', 'Product variants', '商品バリエーション', '상품 옵션', 'Variantes de producto'] },
      { id: 'shop.categories', pages: ['stores'], flag: 'store_categories_enabled', name: ['商品分類', 'Product categories', '商品カテゴリー', '상품 분류', 'Categorías de producto'] },
      { id: 'shop.distribution-photos', pages: ['supplier-console'], flag: 'distribution_photos_enabled', name: ['分銷商品照片', 'Distribution photos', '販売用写真', '유통 사진', 'Fotos de distribución'] },
      { id: 'shop.offer-photos', pages: ['supplier-console'], flag: 'supply_offer_photos_enabled', name: ['供貨方案照片', 'Supply offer photos', '供給条件の写真', '공급 조건 사진', 'Fotos de la oferta'] },
      { id: 'shop.material-media', pages: ['supplier-console'], flag: 'supply_material_media_enabled', name: ['供貨素材媒體', 'Supply material media', '供給素材メディア', '공급 자료 미디어', 'Material multimedia'] },
      { id: 'shop.material-uploads', pages: ['supplier-console'], flag: 'supply_material_uploads_enabled', name: ['供貨素材上傳', 'Supply material uploads', '供給素材のアップロード', '공급 자료 업로드', 'Subir material'] },
      { id: 'shop.drop-ship', pages: ['supplier-console'], flag: 'commerce_drop_ship_enabled', name: ['供應商代發貨', 'Supplier drop shipping', '供給者からの直送', '공급자 직배송', 'Envío directo del proveedor'] },
      { id: 'shop.self-ship', pages: ['stores'], flag: 'commerce_self_ship_enabled', name: ['店主自行出貨', 'Store owner shipping', '店主による発送', '상점 주인 직접 배송', 'Envío por la tienda'] },
      { id: 'shop.checkout', pages: ['reservations'], flag: 'commerce_checkout_enabled', name: ['正式結帳', 'Checkout', '正式な決済', '정식 결제', 'Pago'] },
      { id: 'shop.reservations', pages: ['reservations'], href: '#reservations', name: ['我的訂單（預留查詢）', 'My orders (reservations)', '注文履歴（予約）', '내 주문(예약)', 'Mis pedidos (reservas)'] },
      { id: 'shop.business', pages: ['business'], href: '#business', flag: 'guild_launchpad_enabled', name: ['業務空間與工作區', 'Business workspaces', 'ビジネススペース', '비즈니스 공간', 'Espacios de negocios'] },
    ],
  },
  {
    id: 'community', owners: ['A', 'B'],
    name: ['社群入口、小遊戲與手機 App', 'Community, mini game and phone app', 'コミュニティ・ミニゲーム・スマホアプリ', '커뮤니티 · 미니 게임 · 휴대폰 앱', 'Comunidad, minijuego y app móvil'],
    summary: ['社群連結、/play 小遊戲、安裝 App 與社群日誌。', 'Community links, /play mini game, app install and journal.', 'コミュニティリンク、/play、アプリのインストール、日誌。', '커뮤니티 링크, /play 미니 게임, 앱 설치, 일지.', 'Enlaces, minijuego /play, instalar la app y diario.'],
    features: [
      { id: 'community.page', pages: ['community'], href: '#community', name: ['自由工坊社群頁與社群連結', 'Community page and links', 'コミュニティページとリンク', '커뮤니티 페이지와 링크', 'Página y enlaces de la comunidad'] },
      { id: 'community.hub', pages: ['community-hub'], href: '#community-hub', name: ['社群入口總覽與參與方向', 'Community hub and ways to participate', 'コミュニティ一覧と参加方法', '커뮤니티 허브와 참여 방법', 'Comunidades y formas de participar'] },
      { id: 'community.play', href: '/play', name: ['小遊戲（/play）', 'Mini game (/play)', 'ミニゲーム（/play）', '미니 게임(/play)', 'Minijuego (/play)'] },
      { id: 'community.install', name: ['安裝手機 App（加入主畫面）', 'Install the phone app (add to home screen)', 'スマホアプリをインストール（ホーム画面に追加）', '휴대폰 앱 설치(홈 화면에 추가)', 'Instalar la app (añadir a inicio)'] },
      { id: 'community.journal', href: '/journal', name: ['社群日誌（/journal）', 'Community journal (/journal)', 'コミュニティ日誌（/journal）', '커뮤니티 일지(/journal)', 'Diario de la comunidad (/journal)'] },
    ],
  },
  {
    id: 'admin', owners: ['E'],
    name: ['管理與權限', 'Administration and permissions', '管理と権限', '관리와 권한', 'Administración y permisos'],
    summary: ['沒有權限的人只確認看不到或被拒絕，不要求任何人提供管理權限。', 'Without permission, only confirm the entry is hidden or refused. Nobody is asked for admin access.', '権限がない人は、見えないか拒否されることだけを確認します。管理権限は求めません。', '권한이 없으면 보이지 않거나 거부되는지만 확인합니다. 관리 권한을 요청하지 않습니다.', 'Sin permiso, solo comprueba que no aparece o se rechaza. No se pide acceso de administrador.'],
    features: [
      { id: 'admin.console', pages: ['admin'], href: '/admin', access: 'admin', name: ['平台管理（/admin）', 'Platform administration (/admin)', 'プラットフォーム管理（/admin）', '플랫폼 관리(/admin)', 'Administración (/admin)'] },
      { id: 'admin.review', pages: ['admin'], access: 'admin', name: ['審核中心、公會審核與任命', 'Review center, guild review and appointments', '審査センター・ギルド審査・任命', '검토 센터 · 길드 검토 · 임명', 'Centro de revisión, gremios y nombramientos'] },
      { id: 'admin.boundary', pages: ['admin', 'guild-workspace'], name: ['無權限時看不到或被拒絕', 'Hidden or refused without permission', '権限がないと表示されない／拒否される', '권한 없으면 숨김 또는 거부', 'Oculto o rechazado sin permiso'] },
    ],
  },
];
