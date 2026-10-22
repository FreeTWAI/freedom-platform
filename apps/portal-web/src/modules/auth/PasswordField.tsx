import {useEffect,useId,useState} from 'react';

const visibilityLabels = {
  'zh-Hant': ['顯示密碼','隱藏密碼'], en: ['Show password','Hide password'],
  ja: ['パスワードを表示','パスワードを隠す'], ko: ['비밀번호 표시','비밀번호 숨기기'],
  es: ['Mostrar contraseña','Ocultar contraseña'],
} as const;

/** Controlled field only: never persists, trims, logs or submits credentials. */
export function PasswordField({label,value,onChange,disabled=false,autoComplete,minLength,hint,language}:{
  label:string;value:string;onChange:(value:string)=>void;disabled?:boolean;
  autoComplete:'new-password'|'current-password';minLength?:number;hint?:string;
  language:keyof typeof visibilityLabels;
}) {
  const id=useId(),[visible,setVisible]=useState(false),[touched,setTouched]=useState(false);
  const invalid=touched&&minLength!==undefined&&value.length<minLength;
  useEffect(()=>{if(disabled)setVisible(false);},[disabled]);
  useEffect(()=>{
    const hide=()=>{if(document.visibilityState==='hidden')setVisible(false);};
    document.addEventListener('visibilitychange',hide);
    return()=>document.removeEventListener('visibilitychange',hide);
  },[]);
  return <div className="field">
    <label className="field-label" htmlFor={id}>{label}</label>
    <input id={id} name="password" type={visible&&!disabled?'text':'password'} value={value}
      autoComplete={autoComplete} autoCapitalize="none" spellCheck={false} minLength={minLength}
      maxLength={128} required disabled={disabled} aria-invalid={invalid||undefined}
      aria-describedby={hint?`${id}-hint`:undefined}
      onChange={event=>onChange(event.target.value)} onBlur={()=>setTouched(true)} onInvalid={()=>setTouched(true)}/>
    {hint&&<span id={`${id}-hint`} className="field-hint">{hint}</span>}
    <div className="actions"><button type="button" className="btn btn-ghost btn-small" disabled={disabled}
      aria-controls={id} onClick={()=>setVisible(current=>!current)}>{visibilityLabels[language][visible?1:0]}</button></div>
  </div>;
}
