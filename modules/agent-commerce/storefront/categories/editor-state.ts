import type {PortalClient} from '../../../../apps/portal-web/src/api';
export interface CategoryAttempt {method:'post'|'patch'|'put';path:string;body:string;expected:string;key:string;operation:'create'|'rename'|'reorder'|'groups'|'remove';categoryId:string|null;notice:string;hadUnknown?:boolean}
const held=new WeakMap<PortalClient,Map<string,CategoryAttempt>>();
export const categoryAttempt=(c:PortalClient,s:string)=>held.get(c)?.get(s);
export function holdCategoryAttempt(c:PortalClient,s:string,a:CategoryAttempt){let map=held.get(c);if(!map){map=new Map();held.set(c,map);}map.set(s,Object.freeze({...a}));}
export function releaseCategoryAttempt(c:PortalClient,s:string){held.get(c)?.delete(s);}
