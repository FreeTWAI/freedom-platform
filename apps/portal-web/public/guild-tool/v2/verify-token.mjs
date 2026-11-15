/** Copyable backend verifier (Node 24/WebCrypto). Trust issuer/audience/JWKS from
 * backend configuration, never from the incoming token or a caller's URL. */
export async function verifyGuildToolToken(token,{issuer,audience,jwks}) {
 const fail=()=>{throw Error('Invalid guild-tool token');};
 if(typeof token!=='string'||token.length>4096)fail();
 const parts=token.split('.');if(parts.length!==3||parts.some(x=>!x||!/^[A-Za-z0-9_-]+$/.test(x)))fail();
 const bytes=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
 const json=s=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes(s)));
 const h=json(parts[0]),p=json(parts[1]),now=Math.floor(Date.now()/1000);
 if(h.alg!=='ES256'||h.typ!=='freedom-guild-tool+jwt'||h.crit||h.b64!==undefined||typeof h.kid!=='string')fail();
 const key=jwks.keys?.find(k=>k.kid===h.kid&&k.kty==='EC'&&k.crv==='P-256'&&k.alg==='ES256'&&k.use==='sig'&&!k.d);if(!key)fail();
 const imported=await crypto.subtle.importKey('jwk',key,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},imported,bytes(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))fail();
 if(p.iss!==issuer||p.aud!==audience||p.purpose!=='guild-tool-identity'||!Number.isInteger(p.iat)||!Number.isInteger(p.exp)||p.exp<=now||p.iat>now||p.exp-p.iat>600||p.exp<=p.iat||typeof p.sub!=='string'||typeof p.jti!=='string'||!Number.isInteger(p.revision)||p.revision<1||!Array.isArray(p.scopes)||p.scopes.length!==1||p.scopes[0]!=='context:read'||p.nbf!==undefined&&p.nbf>now)fail();
 return p;
}
