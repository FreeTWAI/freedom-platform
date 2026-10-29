import {useEffect,useState} from 'react';
import {millisecondsUntilTaipeiMidnight} from './calendar';
import {parseSeasonalPreference,readSeasonalPreference,resolveSeasonalTheme,saveSeasonalPreference,SEASONAL_STORAGE_KEY,type SeasonalPreference} from './preferences';

export function useSeasonalTheme() {
  const [preference,setPreference]=useState<SeasonalPreference>(()=>{
    try {return readSeasonalPreference(localStorage);} catch {return 'auto';}
  });
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>;
    const refresh=()=>{clearTimeout(timer);const date=new Date();setNow(date);timer=setTimeout(refresh,millisecondsUntilTaipeiMidnight(date));};
    const visible=()=>{if(document.visibilityState==='visible')refresh();};
    const storage=(event:StorageEvent)=>{if(event.key===SEASONAL_STORAGE_KEY||event.key===null)setPreference(parseSeasonalPreference(event.newValue));};
    refresh();document.addEventListener('visibilitychange',visible);window.addEventListener('storage',storage);
    return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('storage',storage);};
  },[]);
  function selectPreference(next:SeasonalPreference){
    setPreference(next);setNow(new Date());
    try {saveSeasonalPreference(next,localStorage);} catch {/* Local memory remains authoritative for this visit. */}
  }
  return {preference,season:resolveSeasonalTheme(preference,now),selectPreference};
}
