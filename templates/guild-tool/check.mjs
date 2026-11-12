import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const manifest=JSON.parse(readFileSync('freedom-tool.json','utf8'));
assert.equal(manifest.bridge_version,'freedom.guild-launchpad/v2');assert.equal(manifest.profile,'sandboxed');assert.ok(/^[a-z][a-z0-9-]{0,47}$/.test(manifest.tool_id));
for(const file of ['index.html','main.js','bridge.js','style.css'])assert.ok(readFileSync(file).length>0);
for(const op of ['context.get','share.compose','device-state.get','device-state.put','ui.open','navigate','resize'])assert.ok(readFileSync('main.js','utf8').includes(op));
console.log('Manifest and all seven operations checked. Real-host conformance runs in freedom-platform.');
