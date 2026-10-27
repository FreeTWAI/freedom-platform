import {useId} from 'react';
import {moveProfileBlock,profileBlockLabels,type ProfileLayoutData} from '../../../../packages/shared/member-profile';
export function ProfileLayoutEditor({value,onChange,disabled}:{value:ProfileLayoutData;onChange:(next:ProfileLayoutData)=>void;disabled:boolean}){
 const id=useId();
 const update=(patch:Partial<ProfileLayoutData>)=>onChange({...value,...patch});
 return <fieldset className="fieldset stack" disabled={disabled}><legend>佈置我的個人頁</legend>
  <details open><summary className="profile-editor-summary">顏色與背景</summary><div className="profile-design-options">
   <div className="field"><label htmlFor={`${id}-theme`}>主題</label><select id={`${id}-theme`} value={value.theme} onChange={event=>update({theme:event.target.value as ProfileLayoutData['theme']})}><option value="paper">明亮紙頁</option><option value="night">深夜星空</option><option value="sage">森林手帳</option><option value="rose">暖粉相簿</option></select></div>
   <div className="field"><label htmlFor={`${id}-accent`}>重點顏色</label><select id={`${id}-accent`} value={value.accent} onChange={event=>update({accent:event.target.value as ProfileLayoutData['accent']})}><option value="violet">紫羅蘭</option><option value="blue">海洋藍</option><option value="teal">湖水綠</option><option value="berry">莓果紅</option><option value="amber">琥珀棕</option></select></div>
   <div className="field"><label htmlFor={`${id}-cover`}>封面圖樣</label><select id={`${id}-cover`} value={value.cover_style} onChange={event=>update({cover_style:event.target.value as ProfileLayoutData['cover_style']})}><option value="horizon">山稜</option><option value="grid">方格</option><option value="constellation">星點</option><option value="waves">波紋</option></select></div>
  </div><p className="hint">沒有使用自己的封面圖片時，會顯示所選圖樣。</p></details>
  <details><summary className="profile-editor-summary">關於我與精選作品</summary><div className="stack">
   <div className="field"><label htmlFor={`${id}-about`}>關於我</label><textarea id={`${id}-about`} aria-describedby={`${id}-about-help`} maxLength={1600} rows={6} value={value.about} onChange={event=>update({about:event.target.value})}/><span id={`${id}-about-help`} className="hint">可以換行，最多 1600 字；不支援網頁程式碼。</span></div>
   <h3>精選作品（最多六個）</h3><p className="hint">只加入你親自填寫的作品名稱與 HTTPS 連結，不會抓取網站或自動公開私人作品。</p>
   {value.featured.map((work,index)=><div className="profile-featured-editor stack" key={index}>
    <label className="field">作品名稱 {index+1}<input required maxLength={80} value={work.title} onChange={event=>update({featured:value.featured.map((item,i)=>i===index?{...item,title:event.target.value}:item)})}/></label>
    <label className="field">作品介紹 {index+1}<input maxLength={180} value={work.description} onChange={event=>update({featured:value.featured.map((item,i)=>i===index?{...item,description:event.target.value}:item)})}/></label>
    <label className="field">作品 HTTPS 網址 {index+1}<input required type="url" maxLength={500} value={work.url} onChange={event=>update({featured:value.featured.map((item,i)=>i===index?{...item,url:event.target.value}:item)})}/></label>
    <button type="button" className="btn btn-secondary btn-small" onClick={()=>update({featured:value.featured.filter((_,i)=>i!==index)})}>移除作品 {index+1}</button>
   </div>)}
   {value.featured.length<6&&<button type="button" className="btn btn-secondary btn-small" onClick={()=>update({featured:[...value.featured,{title:'',description:'',url:''}]})}>新增精選作品</button>}
  </div></details>
  <details><summary className="profile-editor-summary">顯示哪些區塊、先後順序</summary><p className="hint">勾選要給訪客看的區塊，再用上移、下移調整。儲存後，這個個人頁不會把未勾選區塊的內容傳給訪客，自己仍可在這裡編輯。顯示名稱、一句話介紹與已選封面不受這些勾選影響。</p><ol className="profile-block-order">
   {value.blocks.map((block,index)=><li key={block.id}><label><input type="checkbox" checked={block.visible} onChange={event=>update({blocks:value.blocks.map(item=>item.id===block.id?{...item,visible:event.target.checked}:item)})}/>{profileBlockLabels[block.id]}</label><button type="button" className="btn btn-secondary btn-small" disabled={disabled||index===0} aria-label={`上移${profileBlockLabels[block.id]}`} onClick={()=>onChange(moveProfileBlock(value,block.id,-1))}>上移</button><button type="button" className="btn btn-secondary btn-small" disabled={disabled||index===value.blocks.length-1} aria-label={`下移${profileBlockLabels[block.id]}`} onClick={()=>onChange(moveProfileBlock(value,block.id,1))}>下移</button></li>)}
  </ol><p className="hint">稱號和社群認證須在<a href="#account">帳號設定</a>另外同意展示；只會向符合個人頁隱私規則的登入會員顯示。認證不代表管理員審核過每段介紹與連結。</p></details>
 </fieldset>;
}
