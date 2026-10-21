import assert from 'node:assert/strict';

/** Check the actual serialized projection, including nested strings and keys. */
export function assertCommerceReadinessPrivacy(serialized:string,privateValues:readonly string[]){
  const document:unknown=JSON.parse(serialized);
  assert.equal(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(serialized),false,'projection excludes email addresses');
  for(const value of privateValues)assert.equal(serialized.includes(value),false,'projection excludes fixture private values');
  function walk(value:unknown,key=''){
    if(typeof value==='string'&&value.includes('@')){
      assert.equal(key,'module_release_ref','only exact module release references may contain @');
      assert.match(value,/^[a-z][a-z0-9-]*@[0-9]+\.[0-9]+\.[0-9]+$/);
    }else if(Array.isArray(value)){
      for(const entry of value)walk(entry,key);
    }else if(value!==null&&typeof value==='object'){
      for(const [childKey,entry] of Object.entries(value)){
        const normalized=childKey.replace(/[^a-z]/gi,'').toLowerCase();
        assert.equal(/account(number|name)|contact|phone|email|mobile|branchname/.test(normalized),false,'projection excludes private field names');
        walk(entry,childKey);
      }
    }
  }
  walk(document);
}
