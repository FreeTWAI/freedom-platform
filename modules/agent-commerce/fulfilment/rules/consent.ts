/** The hosted cart has no drop-ship agreement model yet. Price acceptance does
 * not change this classification. All delivery methods use this same gate. */
export const hostedLineFulfilment = (own: boolean) => own ? {kind: 'self' as const} : {kind: 'not_agreed' as const};
export const fulfilmentConsentFailure = (fulfilment: {kind: string}) =>
  fulfilment.kind === 'not_agreed' ? 'fulfilment_not_agreed' as const : null;
