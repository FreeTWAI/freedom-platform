import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeReadme,readmeQuickStart } from '../../modules/shares/sanitize.js';
test('README preserves a small, reconstructed language and original relative links/images',()=>{
 const result=sanitizeReadme('<h2>Quick start</h2><pre><code>npm install &amp;&amp; npm start</code></pre><a href="docs/start.md">Guide</a><img src="art.png" alt="a &quot; b">','fixture/repo');
 assert.match(result,/<h2>Quick start<\/h2>/);assert.match(result,/href="https:\/\/github.com\/fixture\/repo\/blob\/main\/docs\/start.md"/);
 assert.match(result,/src="https:\/\/raw.githubusercontent.com\/fixture\/repo\/main\/art.png"/);assert.equal(readmeQuickStart(result,'fixture/repo'),'npm install && npm start');
});
test('hostile HTML cannot retain executable tags, attributes, CSS or dangerous URL schemes',()=>{
 const hostile=[
 '<script>alert(1)</script><style>*{display:none}</style><iframe srcdoc="<script>alert(1)</script>"></iframe>',
 '<a href="javascript:alert(1)" onclick="alert(1)">bad</a><img src="x" onerror="alert(1)">',
 '<a href="java&#x09;script:alert(1)">bad</a><a href="&#106;avascript:alert(1)">bad</a>',
 '<a href="data:text/html,evil">bad</a><a href="vbscript:evil">bad</a>',
 '<svg><a xlink:href="javascript:alert(1)">x</a><foreignObject><iframe></iframe></foreignObject></svg>',
 '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
 '<form id="app"><input name="csrf_token"></form><object data="x"></object><embed src="x">',
 '<img src="https://raw.githubusercontent.com.evil.test/x"><img src="//evil.test/x"><img src="https://user@raw.githubusercontent.com/x">',
 '<p style="background:url(javascript:evil)" id="app" class="overlay" data-action="delete">ok</p>',
 '<a href="https://example.com/\" onmouseover=alert(1)">text</a><img src="https://avatars.githubusercontent.com/x" srcset="https://evil.test/">',
 '<noscript><p title="</noscript><img src=x onerror=alert(1)>">x</p>',
 '<!--><img src=x onerror=alert(1)>--><p>after</p>',
 '<a href="https://example.com" href="javascript:alert(1)">dup</a>',
 ];
 for(const input of hostile){const result=sanitizeReadme(input,'fixture/repo');assert.doesNotMatch(result,/<(?:script|style|iframe|svg|math|form|input|object|embed|template|noscript)\b/i);assert.doesNotMatch(result,/<[a-z][^>]*\s(?:on\w+|style|id|name|class|srcset|data-[\w-]+)=/i);assert.doesNotMatch(result,/(?:href|src)="(?:javascript|data|vbscript):/i);assert.doesNotMatch(result,/src="https:\/\/evil/);assert.equal(sanitizeReadme(result,'fixture/repo'),result,'sanitizer output is stable');}
});
test('bounded input and nesting, malformed markup, entities and fallback',()=>{
 assert.throws(()=>sanitizeReadme('x'.repeat(1048577),'a/b'),/too_large/);
 assert.throws(()=>sanitizeReadme('<div>'.repeat(101),'a/b'),/nesting/);
 assert.equal(sanitizeReadme('<p>&lt;script&gt;&amp;</p>','a/b'),'<p>&lt;script&gt;&amp;</p>');
 assert.equal(readmeQuickStart('<p>Hi</p>','a/b'),'git clone https://github.com/a/b.git');
 assert.doesNotMatch(sanitizeReadme('<img src="unfinished','a/b'),/<img/);
});
