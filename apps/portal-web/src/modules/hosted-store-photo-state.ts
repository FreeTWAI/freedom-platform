import { ProductMediaCommandSchema, type ProductMediaCommand } from '../../../../contracts/guild-launchpad/v1/hosted-store-media';
export interface PhotoAttempt {
  readonly tenantId:string;readonly instanceId:string;readonly productId:string;readonly expected:string;
  readonly key:string;readonly file:File|null;readonly action:'upload'|'remove';readonly hadUnknown:boolean;
}
export interface GalleryPhotoAttempt extends Omit<PhotoAttempt,'action'> {
 readonly gallery:true;readonly action:'upload'|'remove'|'reorder'|'describe';readonly photoKey:string|null;readonly body:string;
}
type AnyPhotoAttempt=PhotoAttempt|GalleryPhotoAttempt;
type Placement=Pick<PhotoAttempt,'tenantId'|'instanceId'|'productId'> & {gallery?:true};
function sameOriginal(a:AnyPhotoAttempt,b:AnyPhotoAttempt){
 return a.key===b.key&&a.expected===b.expected&&a.file===b.file&&a.action===b.action
  &&(!('gallery' in a)||'gallery' in b&&a.photoKey===b.photoKey&&a.body===b.body);
}
/** Strict success may describe a newer current photo, but completion is this exact CAS. */
export function photoAcknowledgement(raw:unknown,attempt:PhotoAttempt):ProductMediaCommand|null {
  const parsed=ProductMediaCommandSchema.safeParse(raw);if(!parsed.success)return null;
  const value=parsed.data;
  const completed=String(BigInt(attempt.expected)+(value.changed?1n:0n));
  if(value.product_id!==attempt.productId||value.completed_version!==completed||(attempt.action==='upload'&&!value.changed))return null;
  const prefix=`/api/v1/tenants/${attempt.tenantId}/storefronts/${attempt.instanceId}/products/${attempt.productId}/photo/`;
  if(value.current.photo&&!value.current.photo.read_path.startsWith(prefix))return null;
  return value;
}
export function retainedPhotoFailure<T extends AnyPhotoAttempt>(attempt:T,unknown:boolean):T{
  return Object.freeze<T>({...attempt,hadUnknown:attempt.hadUnknown||unknown});
}
export function reviewPhotoAttempt<T extends AnyPhotoAttempt>(attempt:T,version:string,key:string):T {
  if(attempt.hadUnknown)throw new Error('photo_original_result_unknown');
  return Object.freeze<T>({...attempt,expected:version,key,hadUnknown:false});
}

// Same-page session transitions unmount product controls. Keep only unresolved
// original tuples in memory, isolated by authenticated member and exact product.
// No browser storage, credentials, automatic replay or reload recovery.
const pendingPhotos=new WeakMap<object,Map<string,Map<string,AnyPhotoAttempt>>>();
let pendingCount=0;
const unload=(event:BeforeUnloadEvent)=>{if(pendingCount){event.preventDefault();event.returnValue='';}};
function watchPending(){
  if(typeof window==='undefined')return;
  window.removeEventListener('beforeunload',unload);
  if(pendingCount)window.addEventListener('beforeunload',unload);
}
export const photoBlocksLeaving=(attempt:AnyPhotoAttempt|null,sending:boolean)=>sending||attempt?.hadUnknown===true;
const placement=(value:Placement)=>JSON.stringify([value.tenantId,value.instanceId,value.productId,...(value.gallery?['gallery']:[])]);
export function holdPhotoAttempt(client:object,memberId:string,attempt:AnyPhotoAttempt){
  let members=pendingPhotos.get(client);if(!members){members=new Map();pendingPhotos.set(client,members);}
  let products=members.get(memberId);if(!products){products=new Map();members.set(memberId,products);}
  const key=placement(attempt),prior=products.get(key);
  if(prior?.hadUnknown&&!sameOriginal(prior,attempt))throw new Error('photo_original_result_unknown');
  if(!prior)pendingCount++;
  products.set(key,retainedPhotoFailure(attempt,prior?.key===attempt.key&&prior.hadUnknown===true));watchPending();
}
export function heldPhotoAttempt<T extends AnyPhotoAttempt=PhotoAttempt>(client:object,memberId:string,target:Placement){
  return (pendingPhotos.get(client)?.get(memberId)?.get(placement(target))??null) as T|null;
}
export function restorePhotoAttempt<T extends AnyPhotoAttempt=PhotoAttempt>(client:object,memberId:string,target:Placement){
  const found=heldPhotoAttempt<T>(client,memberId,target);if(!found)return null;
  const restored=retainedPhotoFailure(found,true);holdPhotoAttempt(client,memberId,restored);return restored;
}
/** A known first refusal can release an uncommitted attempt, but cannot erase an
 * original that another mounted session has already restored as uncertain. */
export function forgetRefusedPhotoAttempt(client:object,memberId:string,attempt:AnyPhotoAttempt){
  if(!heldPhotoAttempt(client,memberId,attempt)?.hadUnknown)releasePhotoAttempt(client,memberId,attempt);
}
export function releasePhotoAttempt(client:object,memberId:string,attempt:AnyPhotoAttempt){
  const products=pendingPhotos.get(client)?.get(memberId),key=placement(attempt),current=products?.get(key);
  if(current&&sameOriginal(current,attempt)){products!.delete(key);pendingCount--;if(!products!.size)pendingPhotos.get(client)!.delete(memberId);watchPending();}
}
