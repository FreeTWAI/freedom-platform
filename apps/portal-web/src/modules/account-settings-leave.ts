import type {SharingMutationState} from './authoring-drafts';

/** Each mounted settings editor owns its own pure, synchronous pending guard. */
export type RegisterSettingsLeave = (guard: () => boolean) => () => void;
export function createSettingsLeaveRegistry(){
  const guards=new Map<symbol,()=>boolean>();
  const register:RegisterSettingsLeave=guard=>{
    const token=Symbol();guards.set(token,guard);
    return ()=>{guards.delete(token);};
  };
  const canLeave=()=>{
    for(const guard of guards.values()){
      try{if(!guard())return false;}catch{return false;}
    }
    return true;
  };
  return {register,canLeave};
}

/** Read the actual command store even before React commits a new render. */
export function settingsMutationBlocksLeave(state:SharingMutationState){
  return state.live()&&(state.snapshot.busy||state.snapshot.lastFailureUnknown);
}
