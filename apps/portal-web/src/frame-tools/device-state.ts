/** The page owns persistence. No enumeration or caller-selected namespace. */
export class DeviceState {
 constructor(private storage:Pick<Storage,'getItem'|'setItem'>,private namespace:string){}
 private load():Record<string,string>{try{const v=JSON.parse(this.storage.getItem('freedom.tool.v2.'+this.namespace)??'{}');if(v&&typeof v==='object'&&!Array.isArray(v)&&new TextEncoder().encode(JSON.stringify(v)).length<=2000000)return v;}catch{}return {};}
 get(key:string){return this.load()[key]??null;}
 put(key:string,value:string|null){
 if(value!==null&&new TextEncoder().encode(value).length>1300000)throw Error('value_too_large');
 const values=this.load();if(value===null)delete values[key];else Object.defineProperty(values,key,{value,enumerable:true,configurable:true,writable:true});
 const text=JSON.stringify(values);if(Object.keys(values).length>64||new TextEncoder().encode(text).length>2000000)throw Error('storage_quota');
 this.storage.setItem('freedom.tool.v2.'+this.namespace,text);return {saved:true};
 }
}
