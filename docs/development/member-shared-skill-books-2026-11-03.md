# 會員分享整理為社群技能書 · 2026-11-03

平台負責人 Ted 於 2026-11-03 指示：「看一下所有新加入的技能書, 都比照傳統的規格, 把插圖什麼該畫的都畫上去, 說明都寫清楚. 有一個 台式英文抓蟲蟲, 請把它變成 語言學習與AI協作公會的指定技能書」。
本次沿用 [2026-10-20 會員分享整理](member-shared-skill-books-2026-10-20.md)的格式與權限邊界。

2026-10-20 之後，「分享技能書」流程新發布 2 個 repo。本次把它們整理為目錄技能書，內容包括導讀、各 100 則分享介紹、書封、功能示意圖、固定版本來源與上架 migration。目錄從 53 本增至 55 本，原作 repo 指引從 59 個增至 61 個。兩本的目錄來源都是 `guilds: []`。台式英文抓蟲器的公會指定只由 migration 198 寫入 `guild_skill_book_bindings`，見[公會指定](#公會指定)。本次不改會員原投稿，也未安裝或執行上游程式。

## 收錄與署名

署名是會員的社群顯示名稱，關係為 `self_declared`，未拿 GitHub 帳號核對身分。核對 commit 是投稿紀錄的固定版本。

| 技能書 id | 社群署名 | 自述關係 | 原作 repo | 核對 commit | 授權 |
| --- | --- | --- | --- | --- | --- |
| `project-hub` | ken-kk | `author` | [kieiken/project-hub](https://github.com/kieiken/project-hub) | [`cfe3ab221f03f84d334ae7b97608dd31f3e643be`](https://github.com/kieiken/project-hub/commit/cfe3ab221f03f84d334ae7b97608dd31f3e643be) | [MIT](https://github.com/kieiken/project-hub/blob/cfe3ab221f03f84d334ae7b97608dd31f3e643be/LICENSE) |
| `taiwanese-english-checker` | Wilson | `author` | [WilsonAImaster/taiwanese-english-checker](https://github.com/WilsonAImaster/taiwanese-english-checker) | [`52532373959436a875fd94209bf32df48bfe8dc9`](https://github.com/WilsonAImaster/taiwanese-english-checker/commit/52532373959436a875fd94209bf32df48bfe8dc9) | [MIT](https://github.com/WilsonAImaster/taiwanese-english-checker/blob/52532373959436a875fd94209bf32df48bfe8dc9/LICENSE) |

| 原投稿 id | 目錄技能書 | 投稿發布時間（UTC） |
| --- | --- | --- |
| `8032d99e-4d15-4180-9773-cd27a9c40060` | `project-hub` | 2026-10-26 13:56 |
| `a03535f9-1b33-4942-9286-d809aa446e65` | `taiwanese-english-checker` | 2026-11-03 16:32 |

和 2026-10-20 相同，`repository-match.ts` 從目錄產生排除鍵，兩筆投稿不再重複出現在已發布清單。原投稿資料與直接閱讀端點保留。

2026-11-03 查詢時，兩個原作的 `main` 都比固定版本多 3 個 commit：Project Hub 為 `9f5f6b5a`，台式英文抓蟲器為 `f76e9f93`。導讀只描述固定版本；換版需重新核對，可用既有的 upstream drift 檢查找出差異。

- **Project Hub**：固定版本的原始碼是 4.125.0（`hub/package.json`）。同一版的日文 `README.md` 稱 4.125 為正式版，發佈的 App 是 Mac 4.125.9 與 Windows 4.125.2，Windows 11 x64 版標為限定試用；繁中 `README.zh-TW.md` 仍寫公開 Beta v4.117.0，尚未跟上。投稿說明與之後的原作 README 改稱 Mac 與 Windows 版皆為正式版。導讀依固定版本的原始碼與日文 README，並註明較新版本未經工坊核對；分享介紹只寫原始碼版本 4.125.0，不寫 Windows 狀態。使用邊界（只聽 127.0.0.1:4545、略過權限、複製設定檔、`git add -A` 與 `--no-verify`、未加密紀錄、未公證）在 `9f5f6b5a` 的 README 仍相同。
- **台式英文抓蟲器**：之後的 3 個 commit 只改作者簡介、介紹頁導語，並刪除範例的「經作者校對」字樣；規則與 SKILL.md 未變。導讀與分享介紹都沒有引用被刪除的字樣；作者簡介只寫兩版共同的「自述有 17 年英語教學經驗」。

2026-10-01 另有一件手動登錄作品 `aqua5230/usage`（目錄 `usage` 是 ken-kk 維護的 `kieiken/usage`，原作歸屬見其 `NOTICE.md`）。它不是 10-20 之後新加入的作品，本次未轉換。

## 使用邊界

- **Project Hub：在一個畫面管理專案與 Claude Code／Codex**：MIT，第三方軟體見 THIRD_PARTY_NOTICES。
  - 供單人在自己的 Mac 使用：只監聽 `127.0.0.1:4545`，會檢查 Host 與 Origin，但沒有使用者登入。
  - 預設以略過權限確認的方式啟動 Claude Code，Codex 另略過沙箱；可在 `_hub/roles.yaml` 的 `permissions` 改成需確認。
  - Git 專案的作業通常在 `Work/` 的工作副本進行，整合時才改主資料夾。作業位置選「在主資料夾作業」、專案原本沒有 Git，或副本建立失敗時，會直接在主資料夾工作（`hub/lib/git.js` 的 `prepare()`、`hub/server.js` 的 `workDir()`），所以導讀不保證一定有副本。
  - 工作副本會複製未納入 Git 的 `.env`、`.dev.vars`、`.npmrc` 與 `.claude/settings.local.json`。
  - 自動儲存先 `git add -A`，再以 `--no-verify` 提交。對話、交接與操作紀錄未加密留在本機。
  - Mac App 自行簽署、尚未公證。付費功能切換文件不代表已開放販售。AI 費用依各 CLI 方案。
  - 工坊未安裝或執行。
- **台式英文抓蟲器：抓出你以為是對的台式英文**：MIT。
  - 內容是給 AI 讀的 `SKILL.md`、`references/rules.md` 的 30 條規則與 7 個情境包，沒有程式或檢查引擎。結果由會員選用的 AI 判讀，可能誤判或漏抓。
  - 貼進 AI 服務的英文依該服務條款處理，不要貼客戶個資或機密。
  - 固定版本 `index.html` 的試用只在瀏覽器組成提示詞並複製，不代為送出。
  - 規則是作者整理的寫作建議，不是考試評分或語言能力認證。工坊未安裝或代為執行。

## 公會指定

「語言學習與AI協作公會」是管理員核准的自訂公會：申請 `e3ab38b6-8bcd-4305-8b79-686477bdabf5`，公會鍵 `guild_custom_e3ab38b68bcd43058b79686477bdabf5`。自訂公會沒有靜態目錄對應，只能透過 `guild_skill_book_bindings` 指定技能書：核准流程寫入這張表，`listGuildSkillBooks` 與技能書探索讀取它。所以目錄來源維持 `guilds: []`，目錄 API 的 `official_guild_keys` 不含這個公會鍵；技能書探索只在有綁定的資料庫回傳它。

`migrations/198_member_shared_skill_books_language_guild.sql` 有三段，都是 `INSERT … ON CONFLICT DO NOTHING`：

1. 兩本加入 `skill_publications`，保留既有上架時間。
2. 該申請存在、狀態為 `approved`、核准鍵正確，且公會目錄列存在時，寫入一筆 `(community_id, guild_custom_e3ab…, taiwanese-english-checker)` 綁定。新建或測試資料庫沒有這筆申請，就略過。
3. 比照 migration 031，替這個公會的現有 active 會員（帳號 active、membership active）補上 `member_skill_book_grants`。

migration 不改 membership、主力公會、同意紀錄或開發授權，也沒有 UPDATE／DELETE。重播不會改變任何列。

套用後，台式英文抓蟲器會從社群技能書架移到公會書架，顯示這個公會的徽章，並出現在該公會成員的已解鎖技能書。啟用技能書星號檢查的環境裡，之後加入這個公會的會員要和其他指定書一樣，先替原作 repo 按星。2026-11-03 唯讀查詢正式環境：這個公會已綁定 `ai-manga-translator` 與 `multi-ai-chat`，另有 7 位 active 成員。本次未寫入任何環境的資料，綁定只隨 migration 198 部署生效。

## 分享介紹

兩個 `modules/community/share-introductions/<id>.json` 各有 100 則相異、8–200 字的繁中文案，句內不放 URL，也不與其他書重複。每則事實都對照固定版本：

- Project Hub：README.zh-TW.md、hub/README.zh-TW.md、CONTRIBUTING.zh-TW.md 與 THIRD_PARTY_NOTICES。
- 台式英文抓蟲器：README、SKILL.md、references/rules.md 的 30 條標題與四類分組，以及情境包與範例。

兩筆投稿的公開 share-content 各只有 1 則「我分享了…」預設句，沒有會員自寫的 100 則可沿用。`skillShareContentVersion` 改為 `2026-11-03.1`。

## 圖像

4 張圖都由 builtin-imagegen 產生，各 1 次。sharp 只用 contain、以 `#101215` 補底，編成不透明 WebP（q82）。風格沿用炭黑、酸萊姆綠 #c4ff20、鈷藍 #3044ff 與鉻金屬；沒有真實人物、品牌標誌、文字／數字、浮水印或假操作截圖。

- 書封：`apps/portal-web/public/art/skills/<id>.webp`，768×512。
- 功能圖：`apps/portal-web/public/brand/skill-illustrations/<id>.webp`，1200×630。
- 完整 prompt、來源路徑、attempts、尺寸、bytes、SHA-256 與 source_note：[書封 manifest](../design/skill-book-art-manifest.json)、[功能圖 manifest](../design/skill-illustration-manifest.json)。

| id | 書封隱喻 | 功能圖流程 |
| --- | --- | --- |
| `project-hub` | 中央發光的鉻金屬樞紐，四根輻條各托一個專案資料夾，邊緣停著兩個助手 | 散落的專案資料夾與任務卡 → 上鎖的本機中樞排成任務樹並分派兩個助手 → 成果收進主資料夾並留下紀錄 |
| `taiwanese-english-checker` | 信封與信卡上停著一隻小蟲，放大鏡與捕蟲網正要抓牠 | 停著小蟲的信件與講稿卡 → 放大鏡對照規則活頁夾把小蟲分到三個等級托盤 → 乾淨的同一封信釘上一張重點卡 |

## GitHub 連結

2026-11-03 對兩本導讀公開的 20 個連結做匿名 GET，全部 HTTP 200：

- 原作、owner、Fork、固定 commit。Fork 最終是登入入口，200 只表示入口可到達。
- reading 與全部 evidence 的固定 blob。
- Issues，以及台式英文抓蟲器的作品網站。

本次未建立 Fork、Star 或 Follow。兩個 repo 都是 `has_issues=true`、`has_discussions=false`、預設分支 `main`，回饋目標保持 `/issues`。

只有台式英文抓蟲器有作品網站 `https://wilsonaimaster.github.io/taiwanese-english-checker/`，來源是 repo metadata homepage 與投稿 demo。Project Hub 沒有宣告網站。

`repository-guidance-index.json` 新增兩筆 `author_source`，`contribution_default_branch` 為 `main`，協作頁的預設 PR 目標是原作 `main`。

## 上架與 migration 編號

新增 `migrations/198_member_shared_skill_books_language_guild.sql`，同步更新以下各處；既有 migration 未改：

- `deploy/cloudflare/environments.json` 的 `migrations.last`
- release compatibility 的已知 ledger
- migration plan、event-missions、community-certification、profile-publication 與 release-compatibility 測試
- guild-launchpad 的 `repo_max_migration`

部署前，release config 擁有者要把兩個環境的 `RELEASE_CONFIG_JSON` `migrationProfile.last` 與 `RELEASE_CONFIG_SHA256` 改到 198。

草稿 PR #1215 也使用 `202_tester_map_accounts.sql`。migration 編號必須連續，後合併的一方要改號，並同步上列 frontier 測試。

## 驗證入口與證據界線

- `npm run typecheck`；`npm run build`。
- 不需 PostgreSQL：
  - `tests/runtime/member-shared-skill-books-2026-11-03.test.ts`：固定 pins、署名、無靜態公會、使用邊界、探索只在有綁定時顯示公會、目錄排除、4 張圖的精確規格與雜湊、分享 JSON、migration 198 的語句範圍。
  - `skill-book-guides.test.ts`、`skill-book-upstreams.test.ts`、`skill-collaboration.test.ts`、`development-map.test.ts`、`skill-share-content.test.ts`、`member-shared-skill-books.test.ts`。
- 需 PostgreSQL：
  - `member-skill-registration.test.ts`：migration 198 在沒有申請、申請 pending、核准後與重播時的綁定、grant 與不變更範圍。
  - `skill-submission-upgrades.test.ts`：兩個 repo 的投稿隱藏與直接閱讀。
  - `resource-scopes.test.ts`：從 075 升級後新增的 publications。
- 需瀏覽器與隔離資料庫：`tests/e2e/skill-book-library.spec.ts`、`audit-skills.spec.ts`、`skill-sharing.spec.ts`。新資料庫沒有該公會，書架期望為 29 本公會技能書與 26 本社群技能書。
- `scripts/verify-public.mjs` 同步 55 本／61 個 repo 的精確期望。
- 本機 PostgreSQL 與單元測試的結果記在 PR，不把本機測試當成可信 CI 或正式部署證據。
