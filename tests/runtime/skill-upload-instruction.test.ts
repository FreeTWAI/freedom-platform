import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { formatIsoLocal } from '../../apps/portal-web/src/format.js';
import { chatSkillInstruction, type ChatSkillSeed } from '../../apps/portal-web/src/modules/skill-upload-chat.js';
import { agentInstruction, SKILL_UPLOAD_GUIDE } from '../../apps/portal-web/src/modules/skill-upload-instruction.js';

// Synthetic values only. Frozen plain output from main 95aae4daccb01eabfca6feff551a7f8f3b9a178d.
const origin = 'https://example.test';
const secret = Object.freeze({ token: 'synthetic-private-grant', expiresAt: 'synthetic-expiry', submitUrl: `${origin}/agent-api/v1/skill-submissions/synthetic-draft` });
const expectedPlain = `# 自由工坊 · 技能上傳（私人指令，請勿轉傳）
先閱讀公開指南：https://example.test/development/skill-upload/SKILL.md（完整欄位規格與插圖格式以指南為準）。

任務：讀取「目前工作目錄」這個 repository 的 README、LICENSE 與程式碼，依實際內容以繁體中文撰寫：
1. title：技能名稱。
2. description：真實介紹，只寫專案確實具備的功能與授權。
3. use_notes：適合誰、需要什麼、第一個使用步驟與限制。
4. share_introductions：剛好 100 則彼此不同的分享短文，每則 8–200 字，不重複、不誇大。
5. 插圖（選填）：只依公開指南的格式提供；無法確認格式就省略 cover_image。

規則：
- relationship 預設 curator（推薦／整理者）；只有我明確聲明是原作者、維護者或貢獻者，才改為 author／maintainer／contributor。這是本人自行聲明，不是身分驗證。
- 不捏造使用人數、成效、官方身分或授權；不確定就寫「尚未確認」。
- 不讀取專案中的 .env、cookie、私鑰或客戶資料，不附上其他憑證；只用下方 Authorization 標頭，不使用任何瀏覽器 cookie。
- 本指令只交給我選擇的 Agent，不轉傳、不寫入 Repo、shell history 或日誌。憑證只能用於下方上傳端點。
- 這只會上傳私人草稿；是否公開由我本人在自由工坊預覽後決定。

POST https://example.test/agent-api/v1/skill-submissions/synthetic-draft
Authorization: Bearer synthetic-private-grant
Content-Type: application/json
（一次性憑證，只能上傳這份草稿，synthetic-expiry 到期）

{
  "repository_url": "https://github.com/<owner>/<repository>",
  "title": "技能名稱",
  "description": "真實介紹",
  "use_notes": "如何開始使用與限制",
  "demo_url": null,
  "relationship": "curator",
  "share_introductions": ["第 1 則分享短文", "第 2 則分享短文", "……共 100 則，彼此不同"]
}
`;

test('private instruction preserves every plain-output byte and null/omitted seed behavior', () => {
  assert.equal(SKILL_UPLOAD_GUIDE, '/development/skill-upload');
  assert.equal(agentInstruction(origin, secret), expectedPlain);
  assert.equal(agentInstruction(origin, secret, undefined), expectedPlain);
  assert.equal(agentInstruction(origin, secret, null), expectedPlain);
  assert.ok(expectedPlain.endsWith('}\n'));
});

test('seed fields retain order, JSON escaping and the two newlines before POST', () => {
  const seed = Object.freeze({
    title: '合成 "技能"', description: '第一行\n第二行', use_notes: '路徑\\示範\t步驟',
    relationship: 'maintainer', demo_url: 'https://example.test/?q="示範"',
  });
  const block = [
    '我已在自由工坊登錄這件作品，下列欄位請照抄；只有和 repo 內容不符時才修正：',
    'title："合成 \\"技能\\""',
    'description："第一行\\n第二行"',
    'use_notes："路徑\\\\示範\\t步驟"',
    'relationship："maintainer"',
    'demo_url："https://example.test/?q=\\"示範\\""',
  ].join('\n');
  const before = JSON.stringify(seed);
  assert.equal(agentInstruction(origin, secret, seed), expectedPlain.replace(`POST ${secret.submitUrl}`, `${block}\n\nPOST ${secret.submitUrl}`));
  assert.equal(JSON.stringify(seed), before);
});

test('an explicitly supplied empty seed is not omitted and null demo remains JSON null', () => {
  const seed: ChatSkillSeed = { title: '', description: '', use_notes: '', relationship: '', demo_url: null };
  const block = '我已在自由工坊登錄這件作品，下列欄位請照抄；只有和 repo 內容不符時才修正：\ntitle：""\ndescription：""\nuse_notes：""\nrelationship：""\ndemo_url：null';
  assert.equal(agentInstruction(origin, secret, seed), expectedPlain.replace(`POST ${secret.submitUrl}`, `${block}\n\nPOST ${secret.submitUrl}`));
  // Stored UI metadata does not implicitly select a seed; the caller passes the third argument.
  const stored = Object.freeze({ ...secret, submissionId: 'synthetic-unused-id', seed });
  assert.equal(agentInstruction(origin, stored), expectedPlain);
});

test('expiry keeps the existing localized formatting, empty fallback and invalid-text fallback', () => {
  for (const expiresAt of ['', 'not-a-date', '2026-10-26T12:00:00Z', '2026-10-26T20:00:00+08:00']) {
    const input = Object.freeze({ ...secret, expiresAt });
    assert.equal(agentInstruction(origin, input), expectedPlain.replace('synthetic-expiry', formatIsoLocal(expiresAt)));
  }
});

test('formatter interpolates origin and grant fields verbatim without normalizing or mutating them', () => {
  for (const value of ['', '合成 😀 <tag> ${literal} `', 'synthetic\nline\\path\tend']) {
    const input = Object.freeze({ token: value, expiresAt: secret.expiresAt, submitUrl: value });
    const expected = expectedPlain
      .replace(`${origin}/development`, `${value}/development`)
      .replace(secret.submitUrl, value)
      .replace(secret.token, value);
    assert.equal(agentInstruction(value, input), expected);
    assert.deepEqual(input, { token: value, expiresAt: secret.expiresAt, submitUrl: value });
  }
});

test('private instructions retain safety wording while chat instructions remain credential-free', () => {
  const text = agentInstruction(origin, secret);
  assert.equal(text.split(secret.token).length, 2);
  assert.match(text, /Authorization: Bearer synthetic-private-grant/);
  assert.match(text, /不讀取專案中的 \.env、cookie、私鑰或客戶資料/);
  assert.match(text, /不轉傳、不寫入 Repo、shell history 或日誌/);
  assert.match(text, /這只會上傳私人草稿；是否公開由我本人在自由工坊預覽後決定/);
  const chat = chatSkillInstruction('https://github.com/example/synthetic-skill');
  assert.doesNotMatch(chat, /synthetic-private-grant|agent-api|Authorization: Bearer/);
});

test('SkillUpload keeps its original export wired to the same leaf function', () => {
  const source = readFileSync(new URL('../../apps/portal-web/src/modules/SkillUpload.tsx', import.meta.url), 'utf8');
  const module = { exports: {} as { agentInstruction: typeof agentInstruction } };
  runInNewContext(transformSync(source, { loader: 'tsx', format: 'cjs' }).code, {
    module, exports: module.exports,
    require: (name: string) => name === './skill-upload-instruction' ? { agentInstruction, SKILL_UPLOAD_GUIDE } : {},
  });
  assert.equal(module.exports.agentInstruction, agentInstruction);
  assert.equal(module.exports.agentInstruction(origin, secret), expectedPlain);
});
