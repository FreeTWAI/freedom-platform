import {ApiError, type PortalClient} from '../api';

// Only the root request can establish that the store itself is missing.
// A missing child resource must keep the page's read-recovery controls available.
export class StoreRootReadError extends Error {
  constructor(readonly cause: unknown) {
    super('Store root could not be read', {cause});
  }
}

export async function readStoreRoot(client: Pick<PortalClient, 'get'>, root: string, signal: AbortSignal) {
  try {
    return await client.get(root, {signal});
  } catch (cause) {
    throw new StoreRootReadError(cause);
  }
}

export function isMissingStoreRead(cause: unknown, photoBlocking: boolean): boolean {
  return !photoBlocking && cause instanceof StoreRootReadError
    && cause.cause instanceof ApiError && cause.cause.status === 404;
}
