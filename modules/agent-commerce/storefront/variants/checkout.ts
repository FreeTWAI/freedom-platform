import type {CheckoutPorts} from '../../checkout/terms.js';
import type {PublicStoreProjection} from '../../../../contracts/guild-launchpad/v1/storefront.js';
import {publicationVariants} from './model.js';
/** Display titles are resolved only after the existing raw product, price and
 * consent checks. The checkout's retained terms freeze these labels. */
export const variantBuyerLabels:NonNullable<CheckoutPorts['buyerLabels']>={async resolve(q,p){
 const snapshot=await publicationVariants(q,p.current_publication_id!,p.tenant_id,p.instance_id,(p.projection as PublicStoreProjection).products);
 return new Map(snapshot.document.groups.flatMap(g=>g.members.map(m=>[m.sku,m.buyer_label] as const)));
}};
