/** The sole authority for the member agent lane. Exact REGISTERED patterns only.
 * react/message are reserved scope names: neither grants any operation yet. */
export type AgentScope = 'read' | 'share' | 'rsvp' | 'react' | 'message';
export interface AgentOperation {
  id: string; method: 'GET' | 'POST'; route: string; scope: AgentScope; title: string;
  screen: 'events' | 'credit' | 'shares' | 'notifications';
  example?: Record<string, unknown>; publicItem?: boolean; integration?: boolean; granted?: false; ifMatch?: boolean; featureFlag?: string;
}
export const agentOperations: readonly AgentOperation[] = [
  {id:'events.list',method:'GET',route:'/api/v1/events',scope:'read',title:'查看活動',screen:'events'},
  {id:'events.read',method:'GET',route:'/api/v1/events/:id',scope:'read',title:'查看活動內容',screen:'events'},
  {id:'events.share',method:'POST',route:'/api/v1/events',scope:'share',title:'分享活動',screen:'events',publicItem:true,example:{title:'讀書會',description:'一起讀書',starts_at:'2027-01-10T10:00:00Z',ends_at:'2027-01-10T11:00:00Z',mode:'online',location:'線上',capacity:20,visibility:'open'}},
  {id:'events.rsvp',method:'POST',route:'/api/v1/events/:id/rsvp',scope:'rsvp',title:'報名或取消',screen:'events',example:{going:true}},
  {id:'events.waitlist',ifMatch:true,featureFlag:'FREEDOM_EVENT_PARTICIPATION_ENABLED',method:'POST',route:'/api/v1/events/:id/waitlist',scope:'rsvp',title:'活動候補',screen:'events',example:{action:'join'}},
  {id:'repositories.share',method:'POST',route:'/api/v1/opensource/projects',scope:'share',title:'分享儲存庫',screen:'shares',publicItem:true,example:{repository_url:'https://github.com/example/project',title:'專案名稱',description:'專案介紹',use_notes:'使用方式',relationship:'curator',consent_to_share:true}},
  {id:'credit.records',method:'GET',route:'/api/v1/me/contribution-records',scope:'read',title:'我的貢獻紀錄',screen:'credit'},
  {id:'credit.outcomes',method:'GET',route:'/api/v1/me/contribution-outcomes',scope:'read',title:'我的貢獻成果',screen:'credit'},
  {id:'credit.achievements',featureFlag:'FREEDOM_SOCIAL_ACHIEVEMENTS_ENABLED',method:'GET',route:'/api/v1/me/social-achievements',scope:'read',title:'我的社群成果',screen:'credit'},
  {id:'notifications.list',method:'GET',route:'/api/v1/me/notifications',scope:'read',title:'我的通知',screen:'notifications'},
  {id:'agent.events',method:'GET',route:'/api/v1/agent/events',scope:'read',title:'我的變更',screen:'notifications'},
  {id:'shares.preview',method:'POST',route:'/api/v1/shares/preview',scope:'share',title:'預覽分享',screen:'shares',example:{kind:'repository',url:'https://github.com/example/project'}},
  {id:'shares.create',method:'POST',route:'/api/v1/shares',scope:'share',title:'發布分享',screen:'shares',publicItem:true,example:{kind:'repository',url:'https://github.com/example/project'}},
  {id:'shares.list',method:'GET',route:'/api/v1/shares',scope:'read',title:'查看自己的分享',screen:'shares'},
  {id:'shares.read',method:'GET',route:'/api/v1/shares/:share_id',scope:'read',title:'查看自己的分享內容',screen:'shares'},
  {id:'shares.retract',method:'POST',route:'/api/v1/shares/:share_id/retract',scope:'share',title:'撤回自己的分享',screen:'shares',example:{}},
  {id:'shares.report',method:'POST',route:'/api/v1/shares/:share_id/report',scope:'share',title:'檢舉分享（限本人）',screen:'shares',granted:false,example:{reason:'內容不適當'}},
  {id:'shares.links',method:'POST',route:'/api/v1/shares/:share_id/links',scope:'share',title:'建立自己的分享連結',screen:'shares',example:{}},
  {id:'shares.star',method:'POST',route:'/api/v1/shares/:share_id/star',scope:'react',title:'收藏分享（未開放）',screen:'shares',granted:false,example:{}},
  {id:'credit.read',method:'GET',route:'/api/v1/me/credit',scope:'read',title:'我的貢獻',screen:'credit'},
];
// Report, claim and star are person-only. No react routes are granted in pass 1.
export function agentOperation(method:string,registeredPattern:string) {
  return agentOperations.find(op=>op.granted!==false&&op.method===method&&op.route===registeredPattern);
}
