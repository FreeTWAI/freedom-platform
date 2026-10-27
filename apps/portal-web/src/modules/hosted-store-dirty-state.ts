import {useEffect, useRef, useState, type RefObject} from 'react';

export type RegisterLeave = (guard: ((nextHash:string|null) => boolean) | null) => void;
const LEAVE = '還有尚未儲存的內容，要離開嗎？';

export function useStoreDirtyForms({client, root, registerLeave, busy, retry, photoBlocking, busyRef, held, photoBlockRef, announce}: {
  client: object; root: string; registerLeave: RegisterLeave; busy: boolean; retry: unknown; photoBlocking: boolean;
  busyRef: RefObject<boolean>; held: RefObject<unknown>; photoBlockRef: RefObject<Record<string, boolean>>; announce: (text: string) => void;
}) {
  const [dirtyForms, setDirtyForms] = useState<Record<string, boolean>>({});
  const dirtyFormsRef = useRef<Record<string, boolean>>({});
  const hasDraft = Object.values(dirtyForms).some(Boolean);
  const hasFormDraft = Object.entries(dirtyForms).some(([id,dirty])=>dirty&&!id.startsWith('photo/'));
  const dirty = hasDraft || busy || retry !== null || photoBlocking;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  function leaveOk() {
    if (Object.values(photoBlockRef.current).some(Boolean)) {announce(photoBlockRef.current.policies?'賣方資訊與商店政策操作尚未確認，請先重試原操作。':photoBlockRef.current.appearance?'外觀操作尚未確認，請先重試原操作。':photoBlockRef.current.variants?'規格操作尚未確認，請先重試原操作。':photoBlockRef.current.categories?'暫時無法確認儲存結果，請用原操作重試。':'照片操作尚未確認，請先重試原照片操作。');return false;}
    if (busyRef.current || held.current) {
      announce(busyRef.current ? '正在確認原操作，請等候完成後再離開。' : '尚未確認原操作的結果，請按「重試」確認後再離開。');
      return false;
    }
    return !dirtyRef.current || window.confirm(LEAVE);
  }
  useEffect(() => {
    registerLeave(leaveOk);
    return () => registerLeave(null);
  }, [registerLeave]);
  useEffect(() => {
    const unloading = (event: BeforeUnloadEvent) => {if (dirtyRef.current || busyRef.current || held.current || Object.values(photoBlockRef.current).some(Boolean)) {event.preventDefault(); event.returnValue = '';}};
    window.addEventListener('beforeunload', unloading);
    return () => window.removeEventListener('beforeunload', unloading);
  }, [client, root]);
  function markDirty(id: string, value: boolean) {
    dirtyFormsRef.current={...dirtyFormsRef.current,[id]:value};
    setDirtyForms(old => old[id] === value ? old : {...old, [id]: value});
  }
  return {dirtyForms, dirtyFormsRef, hasDraft, hasFormDraft, markDirty, leaveOk};
}
