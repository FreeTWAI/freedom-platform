import {communitySnapshot,type JournalCommunity} from '../../../../modules/community-journal/community.js';
import {useEffect,useState} from 'react';
import {readSnapshot,personView,journalView,type PersonView,type StoryView} from './journal-api.js';
export const publicSite=true,liveData=true;
export function useJournalData(_date:string|null|undefined,retry:number,community:JournalCommunity='freedom'){
 const [state,setState]=useState({loading:true,people:[] as PersonView[],stories:{} as Record<string,StoryView>,latest:null as string|null,error:null as string|null});
 useEffect(()=>{const abort=new AbortController();setState(s=>({...s,loading:true,error:null}));
 readSnapshot(abort.signal).then(data=>{if(abort.signal.aborted)return;data=communitySnapshot(data,community);const stories=Object.fromEntries(data.journals.map(j=>[j.date,journalView(j)]));setState({people:data.people.map(personView),stories,latest:Object.keys(stories).sort().at(-1)||null,loading:false,error:null});}).catch(e=>{if(!abort.signal.aborted)setState({people:[],stories:{},latest:null,loading:false,error:e.code||'unavailable'});});
 return()=>abort.abort();},[retry,community]);return state;
}
