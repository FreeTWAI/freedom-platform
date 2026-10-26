// Coverage for the 2026-10-26 – 2026-11-01 community test week. Update by PR only:
// change one feature's status and, for 有問題, list the public GitHub Issue numbers.
// Never add names, email addresses, screenshots or other personal data here.
//   未測：nobody has tried it yet      測試中：someone is trying it now
//   已測：tried and worked as expected 有問題：an open Issue describes the problem
export const COVERAGE_STATUSES = ['未測', '測試中', '已測', '有問題'] as const;
export type CoverageStatus = typeof COVERAGE_STATUSES[number];
export type CoverageEntry = { status: CoverageStatus; issues?: readonly number[] };

export const TESTER_COVERAGE_UPDATED_AT = '2026-10-25';
export const TESTER_COVERAGE: Record<string, CoverageEntry> = {
  // 入口、註冊與加入
  'entry.preview': { status: '未測' },
  'entry.register': { status: '未測' },
  'entry.login': { status: '未測' },
  'entry.password': { status: '未測' },
  'entry.email': { status: '未測' },
  'entry.join': { status: '未測' },
  'entry.positioning': { status: '未測' },
  'entry.newbie-village': { status: '未測' },
  'entry.public': { status: '未測' },
  'entry.discovery': { status: '未測' },
  'entry.demo': { status: '未測' },
  // 會員首頁與動態
  'home.home': { status: '未測' },
  'home.explore': { status: '未測' },
  'home.categories': { status: '未測' },
  'home.compose': { status: '未測' },
  'home.interactions': { status: '未測' },
  'home.short': { status: '未測' },
  'home.sharing': { status: '未測' },
  // 職業公會
  'guilds.list': { status: '未測' },
  'guilds.dialog': { status: '未測' },
  'guilds.public': { status: '未測' },
  'guilds.launchpad': { status: '未測' },
  'guilds.manage': { status: '未測' },
  'guilds.config': { status: '未測' },
  // 技能書
  'skills.shelf': { status: '未測' },
  'skills.read': { status: '未測' },
  'skills.github': { status: '未測' },
  'skills.star-gate': { status: '未測' },
  'skills.guides': { status: '未測' },
  // 個人空間與帳號
  'profile.space': { status: '未測' },
  'profile.menu': { status: '未測' },
  'profile.card': { status: '未測' },
  'profile.security': { status: '未測' },
  'profile.content': { status: '未測' },
  'profile.todos': { status: '未測' },
  // 夥伴、好友與小隊
  'people.members': { status: '未測' },
  'people.friends': { status: '未測' },
  'people.squads': { status: '未測' },
  'people.blocking': { status: '未測' },
  'people.reporting': { status: '未測' },
  'people.squad-outcomes': { status: '未測' },
  'people.first': { status: '未測' },
  // 訊息與聊天
  'chat.panel': { status: '未測' },
  'chat.mobile': { status: '未測' },
  'chat.history': { status: '未測' },
  'chat.stickers': { status: '未測' },
  'chat.images': { status: '未測' },
  // 通知
  'notify.bell': { status: '未測' },
  'notify.read': { status: '未測' },
  'notify.preferences': { status: '未測' },
  // 搜尋
  'search.content': { status: '未測' },
  'search.lists': { status: '未測' },
  'search.features': { status: '未測' },
  'search.relations': { status: '未測' },
  // 活動與集錦
  'events.list': { status: '未測' },
  'events.public': { status: '未測' },
  'events.register': { status: '未測' },
  'events.participation': { status: '未測' },
  'events.highlights': { status: '未測' },
  'events.outcomes': { status: '未測' },
  'events.ar': { status: '未測' },
  // 任務、作品與貢獻
  'contrib.page-tools': { status: '未測' },
  'contrib.tasks': { status: '未測' },
  'contrib.cocreation': { status: '未測' },
  'contrib.workbench': { status: '未測' },
  'contrib.showcase': { status: '未測' },
  'contrib.engagement': { status: '未測' },
  'contrib.opensource': { status: '未測' },
  'contrib.marketing': { status: '未測' },
  'contrib.services': { status: '未測' },
  'contrib.promotion': { status: '未測' },
  'contrib.private-ai': { status: '未測' },
  // 供貨、商店與訂單
  'shop.supplier': { status: '未測' },
  'shop.retail': { status: '未測' },
  'shop.supplier-console': { status: '未測' },
  'shop.stores': { status: '未測' },
  'shop.photos': { status: '未測' },
  'shop.photo-uploads': { status: '未測' },
  'shop.appearance': { status: '未測' },
  'shop.policies': { status: '未測' },
  'shop.gallery': { status: '未測' },
  'shop.variants': { status: '未測' },
  'shop.categories': { status: '未測' },
  'shop.distribution-photos': { status: '未測' },
  'shop.offer-photos': { status: '未測' },
  'shop.material-media': { status: '未測' },
  'shop.material-uploads': { status: '未測' },
  'shop.drop-ship': { status: '未測' },
  'shop.self-ship': { status: '未測' },
  'shop.checkout': { status: '未測' },
  'shop.reservations': { status: '未測' },
  'shop.business': { status: '未測' },
  // 社群入口、小遊戲與手機 App
  'community.page': { status: '未測' },
  'community.play': { status: '未測' },
  'community.install': { status: '未測' },
  'community.journal': { status: '未測' },
  // 管理與權限
  'admin.console': { status: '未測' },
  'admin.review': { status: '未測' },
  'admin.boundary': { status: '未測' },
};
