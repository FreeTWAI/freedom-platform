import type {TabId} from '../types';

// Where each share-box entry sends the member: the page that already owns that form, the element to
// focus there, and the label App shows while it opens. Choosing an entry opens that form; it never submits it.
export type ShareTarget='post'|'work'|'resource'|'product'|'product-start'|'product-store'|'product-supply'|'collaborate'|'cocreate';
export const SHARE_TARGETS:Record<ShareTarget,{tab:TabId;selector:string;label:string;activate?:boolean;hash?:string}>={
  post:{tab:'social',selector:'[data-guide-anchor="social:composer"] .social-write-trigger',label:'發文',activate:true},
  work:{tab:'showcase',selector:'[data-guide-anchor="showcase:create"]',label:'分享作品',activate:true},
  resource:{tab:'opensource',selector:'[data-guide-anchor="opensource:repository"]',label:'分享開源資源'},
  product:{tab:'supplier',selector:'[data-guide-anchor="supplier:import-results"] input[type="file"]',label:'上傳商品成果'},
  'product-start':{tab:'supplier',selector:'[data-guide-anchor="supplier:download-kit"] button',label:'準備商品'},
  'product-store':{tab:'stores',hash:'#stores',selector:'[data-share-entry="stores"]',label:'在站內商店刊登'},
  'product-supply':{tab:'stores',hash:'#stores/supply',selector:'[data-share-entry="supply"]',label:'供貨給其他店家'},
  collaborate:{tab:'showcase',selector:'[data-share-entry="collaboration"]',label:'找人合作'},
  cocreate:{tab:'cocreation',selector:'[data-share-entry="cocreation"]',label:'發起共創邀請'},
};
