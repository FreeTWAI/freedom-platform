const iso=(date:Date)=>date.toISOString().slice(0,10);
export function weekDates(selected:string){
 const date=new Date(selected+'T00:00:00Z');
 date.setUTCDate(date.getUTCDate()-date.getUTCDay());
 return Array.from({length:7},()=>{const day=iso(date);date.setUTCDate(date.getUTCDate()+1);return day;});
}
export function monthDates(selected:string){
 const [year,month]=selected.split('-').map(Number),first=new Date(Date.UTC(year,month-1,1));
 const blanks=(first.getUTCDay()+6)%7,days=new Date(Date.UTC(year,month,0)).getUTCDate();
 return [...Array<string|null>(blanks).fill(null),...Array.from({length:days},(_,i)=>iso(new Date(Date.UTC(year,month-1,i+1))))];
}
