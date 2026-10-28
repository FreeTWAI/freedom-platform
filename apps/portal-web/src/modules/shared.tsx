import { useCallback, useRef, useSyncExternalStore, type SetStateAction } from 'react';
import { ApiError, type PortalClient } from '../api';
import type { SessionPayload, TabId } from '../types';
import { sharingMutationState, type SharingMutationScope, type SharingMutationState } from './authoring-drafts';

export type ModulePanelProps = {
  client: PortalClient;
  session: SessionPayload;
  onNavigate?: (tab: TabId) => void;
};

// Decoder-enabled commands additionally retain each tuple's ambiguous history.
// Weak lifetime follows its account-scoped mutation store; legacy callers unchanged.
const decoderUnknownRequests = new WeakMap<SharingMutationState, Set<string>>();

// Preserve the exact request's key on unknown network outcomes. A changed draft
// gets a new key; a retry with the same body and version reuses its original key.
export function useModuleMutation(client: PortalClient, authorScope?: SharingMutationScope) {
  const local = useRef<SharingMutationState | null>(null);
  if (!local.current) local.current = { keys: new Map(), snapshot: { busy: false, error: null, lastFailureUnknown: false }, listeners: new Set(), live: () => true };
  const state = authorScope ? sharingMutationState(authorScope) : local.current;
  const { busy, error, lastFailureUnknown } = useSyncExternalStore(
    notify => { state.listeners.add(notify); return () => { state.listeners.delete(notify); }; },
    () => state.snapshot,
  );
  const setError = useCallback((next: SetStateAction<string | null>) => {
    updateMutationState(state, { error: typeof next === 'function' ? next(state.snapshot.error) : next });
  }, [state]);
  const mutate = <T,>(path: string, body: unknown, ifMatch?: number | string, decode?: (value: unknown) => T) => performModuleMutation<T>(client, state, path, body, ifMatch, decode);
  return { mutate, busy, error, setError, lastFailureUnknown };
}

function updateMutationState(state: SharingMutationState, patch: Partial<SharingMutationState['snapshot']>) {
  if (!state.live() || Object.entries(patch).every(([key, value]) => Object.is(state.snapshot[key as keyof typeof state.snapshot], value))) return;
  state.snapshot = { ...state.snapshot, ...patch };
  for (const notify of state.listeners) notify();
}

export async function performModuleMutation<T>(client: PortalClient, state: SharingMutationState, path: string, body: unknown, ifMatch?: number | string, decode?: (value: unknown) => T): Promise<T | undefined> {
  if (!state.live() || state.snapshot.busy) return undefined;
  const request = JSON.stringify([path, body, ifMatch]);
  const key = state.keys.get(request) ?? crypto.randomUUID();
  state.keys.set(request, key);
  updateMutationState(state, { busy: true, error: null, lastFailureUnknown: false });
  try {
    const result = await client.post<T>(path, body, { idempotencyKey: key, ifMatch });
    if (!state.live()) return undefined;
    // A malformed successful response cannot settle an unknown command outcome.
    // Opt-in decoders run before deleting the original idempotency tuple.
    let decoded: T = result;
    if (decode) {
      try { decoded = decode(result); }
      catch { throw new ApiError({ message: '伺服器回覆格式不符，結果尚未確認；請確認原操作結果。', network: true }); }
    }
    state.keys.delete(request);
    decoderUnknownRequests.get(state)?.delete(request);
    return decoded;
  } catch (cause) {
    if (!state.live()) return undefined;
    const networkUnknown = cause instanceof ApiError && cause.network;
    let unknown = networkUnknown;
    if (decode) {
      const uncertain = decoderUnknownRequests.get(state) ?? new Set<string>();
      decoderUnknownRequests.set(state, uncertain);
      if (networkUnknown || !(cause instanceof ApiError) || !cause.definitiveResponse || cause.status>=500 || cause.status===401 || cause.status===403) uncertain.add(request);
      unknown = uncertain.has(request);
    }
    if (!unknown) state.keys.delete(request);
    updateMutationState(state, { error: cause instanceof Error ? cause.message : '操作未完成，請重新整理後重試。', lastFailureUnknown: unknown });
    return undefined;
  } finally {
    updateMutationState(state, { busy: false });
  }
}
