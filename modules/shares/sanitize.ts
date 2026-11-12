/** A deliberately small HTML output language. Nothing from the input is emitted as markup:
 * tokens are parsed, allowlisted and reconstructed; all text/attribute values are escaped.
 * There is no CSS, SVG/MathML, template, form, embedded document, event or arbitrary attribute output.
 */
const tags=new Set('h1 h2 h3 h4 h5 h6 p a img pre code div span br hr ul ol li table thead tbody tfoot tr th td blockquote em strong del s details summary kbd sup sub b i'.split(' '));
const voids=new Set(['img','br','hr']);
const rawText=new Set(['script','style','iframe','object','embed','textarea','title','xmp','plaintext','noscript','template','svg','math']);
const imageHosts=new Set(['raw.githubusercontent.com','user-images.githubusercontent.com','avatars.githubusercontent.com','camo.githubusercontent.com']);
export function escapeReadme(value:string){return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
function entities(value:string):string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt);?/gi,(original,key:string)=>{
    const lower=key.toLowerCase();if(lower[0]!=='#')return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'} as Record<string,string>)[lower]??original;
    const n=lower[1]==='x'?parseInt(lower.slice(2),16):Number(lower.slice(1));
    return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'\ufffd';
  });
}
function safeUrl(raw:string,base:string,image=false):string|null {
  const value=entities(raw).trim();
  if(!value||/[\u0000-\u0020\u007f-\u009f\\]/.test(value))return null;
  try {
    const url=new URL(value,base);
    if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
    if(image&&!imageHosts.has(url.hostname))return null;
    return url.href;
  }catch{return null;}
}
function attributes(source:string):Map<string,string>|null {
  const attrs=new Map<string,string>();let offset=0;
  const pattern=/\s+([a-zA-Z][a-zA-Z0-9_-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/y;
  while(offset<source.length){
    if(/^\s*\/?\s*$/.test(source.slice(offset)))break;
    pattern.lastIndex=offset;const m=pattern.exec(source);if(!m)return null;offset=pattern.lastIndex;
    const name=m[1].toLowerCase();if(!attrs.has(name))attrs.set(name,m[2]??m[3]??m[4]??'');
  }
  return attrs;
}
/** Bounds the scan and output; malformed tags become escaped text. */
export function sanitizeReadme(html:string,repository:string,branch='main'):string {
  if(Buffer.byteLength(html)>1048576)throw new Error('readme_too_large');
  const linkBase=`https://github.com/${repository}/blob/${encodeURIComponent(branch)}/`;
  const imageBase=`https://raw.githubusercontent.com/${repository}/${encodeURIComponent(branch)}/`;
  const output:string[]=[];const stack:string[]=[];let position=0,drop:string|null=null;
  while(position<html.length){
    const start=html.indexOf('<',position);
    if(start<0){if(!drop)output.push(escapeReadme(entities(html.slice(position))));break;}
    if(!drop)output.push(escapeReadme(entities(html.slice(position,start))));
    if(html.startsWith('<!--',start)){const end=html.indexOf('-->',start+4);position=end<0?html.length:end+3;continue;}
    let end=start+1,quote='';
    for(;end<html.length;end++){const c=html[end];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
    if(end===html.length){if(!drop)output.push(escapeReadme(entities(html.slice(start))));break;}
    const source=html.slice(start+1,end);position=end+1;
    const match=/^(\/)?([A-Za-z][A-Za-z0-9]*)([\s\S]*)$/.exec(source);
    if(!match){if(!drop)output.push(escapeReadme('<'+source+'>'));continue;}
    const closing=!!match[1],tag=match[2].toLowerCase();
    if(drop){if(closing&&tag===drop&&/^\s*$/.test(match[3]))drop=null;continue;}
    if(rawText.has(tag)){if(!closing)drop=tag;continue;}
    if(!tags.has(tag))continue;
    if(closing){if(!/^\s*$/.test(match[3])||voids.has(tag))continue;const i=stack.lastIndexOf(tag);if(i<0)continue;while(stack.length>i)output.push(`</${stack.pop()!}>`);continue;}
    const attrs=attributes(match[3]);if(!attrs)continue;
    const out:string[]=[];
    if(tag==='a'){
      const href=attrs.get('href');const safe=href?safeUrl(href,linkBase):null;
      if(safe)out.push(`href="${escapeReadme(safe)}" rel="nofollow noopener noreferrer"`);
    }
    if(tag==='img'){
      const src=attrs.get('src'),safe=src?safeUrl(src,imageBase,true):null;if(!safe)continue;
      out.push(`src="${escapeReadme(safe)}" alt="${escapeReadme(entities(attrs.get('alt')??''))}" loading="lazy" referrerpolicy="no-referrer"`);
    }
    const title=attrs.get('title');if(title)out.push(`title="${escapeReadme(entities(title))}"`);
    // No id/name/data-* attributes: upstream cannot clobber portal controls or create DOM capabilities.
    output.push(`<${tag}${out.length?' '+out.join(' '):''}>`);
    if(!voids.has(tag)){
      if(stack.length>=100)throw new Error('readme_nesting_limit');stack.push(tag);
    }
  }
  while(stack.length)output.push(`</${stack.pop()!}>`);
  return output.join('');
}
/** Sanitized markup only. Extract a small plain-text code example below an installation heading. */
export function readmeQuickStart(sanitized:string,repository:string):string {
  const heading=/<h[1-6]>[^<]*(?:install|quick\s*start|getting\s*started|安裝|快速開始|開始用)[\s\S]*?<\/h[1-6]>/i.exec(sanitized);
  if(heading){const rest=sanitized.slice(heading.index+heading[0].length).split(/<h[1-6]>/)[0];const code=/<pre>(?:<code>)?([\s\S]*?)<\/pre>/.exec(rest);if(code)return entities(code[1].replace(/<[^>]+>/g,'')).trim().slice(0,4000);}
  return `git clone https://github.com/${repository}.git`;
}
