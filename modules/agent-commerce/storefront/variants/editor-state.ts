import type {PortalClient} from '../../../../apps/portal-web/src/api';
export interface CatalogAttempt {method:'put'|'post'|'patch';path:string;body:string;key:string;expected:string;kind:'group'|'product'|'categories';notice:string;hadUnknown?:boolean}
const held=new WeakMap<PortalClient,Map<string,CatalogAttempt>>();
export const catalogAttempt=(client:PortalClient,scope:string)=>held.get(client)?.get(scope);
export function holdCatalogAttempt(client:PortalClient,scope:string,attempt:CatalogAttempt){let values=held.get(client);if(!values){values=new Map();held.set(client,values);}values.set(scope,Object.freeze({...attempt}));}
export function releaseCatalogAttempt(client:PortalClient,scope:string){held.get(client)?.delete(scope);}
