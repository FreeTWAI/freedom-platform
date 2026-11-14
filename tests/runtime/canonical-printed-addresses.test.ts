import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Pool} from 'pg';
import {createPublishedSkillRoutes} from '../../apps/platform-api/src/routes/published-skills.js';
import {skillUploadProtocolMarkdown} from '../../apps/platform-api/src/generated/runtime-text.js';
import {publicSkillAcquisition} from '../../modules/development/skill-acquisition.js';
import {reviewUrl} from '../../modules/skill-submissions/service.js';

test('submission review URLs point at the resources view',()=>{
  assert.equal(reviewUrl('https://example.test/path'),'https://example.test/#explore/resources');
});
test('the generated upload protocol prints the canonical review URL',()=>{
  assert.match(skillUploadProtocolMarkdown,/https:\/\/freetwai\.com\/#explore\/resources/);
  assert.doesNotMatch(skillUploadProtocolMarkdown,/https:\/\/freetwai\.com\/#skills/);
});
test('public skill acquisition links use the current label and address',()=>{
  const html=publicSkillAcquisition('/development/skills/social-post');
  assert.match(html,/href="\/#explore\/resources"/);
  assert.match(html,/探索 → 資源/);
});
test('the public skill upload page prints the current label and address',async()=>{
  const app=createPublishedSkillRoutes(null as unknown as Pool,'https://example.test');
  const response=await app.request('https://example.test/development/skill-upload');
  assert.equal(response.status,200);const html=await response.text();
  assert.match(html,/href="\/#explore\/resources"/);
  assert.match(html,/探索 → 資源/);
});
