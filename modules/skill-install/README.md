# skill-install

技能書「一鍵安裝」：在技能書介紹視窗把工坊收錄版本裝進本機 Claude Code／Codex／OpenClaw。

## 負責範圍

- 模組 ID：`skill-install`；維護角色：`foundation`（不是 GitHub 寫入權或業務授權）。
- 對外入口：`index.ts`；檔案包實作：`bundle.ts`；HTTP：`apps/platform-api/src/routes/skill-install.ts`。
- 前端：`apps/portal-web/src/modules/SkillInstall.tsx`（UI）與 `skill-install-client.ts`（驗證、寫入、zip、指令）。

## 行為

- `GET /api/v1/skills/:id/install-bundle`：公開唯讀。只接受目錄內 `repository_url` 為 GitHub、且 `source_commit` 為 40 碼的技能書，
  不接受任意 repo／分支，所以不是 GitHub 代理。未收錄或未鎖版本回 404，不會對外發出請求。
- 依 exact commit 讀 tree 與檔案，排除 `.github/`、`tests/`、`.gitignore` 等開發檔；逐檔比對 git blob SHA-1，
  不符回 502 並不快取。根目錄沒有 `SKILL.md` 回 422。上限 300 檔、單檔 2MB、總計 8MB。
- commit 不可變，以 repo@commit 在記憶體快取（最多 32 份）。有 `GITHUB_METRICS_TOKEN` 時用它提高 API 額度。
- 前端走同源 API（CSP `connect-src 'self'` 不變），寫入前再驗一次每個檔案與 manifest digest。
- 安裝方式：Chrome／Edge 以 File System Access API 寫入使用者選定的資料夾；其他瀏覽器下載 zip；或複製鎖 commit 的 shell／PowerShell 指令。
- 更新：瀏覽器遇到既有非空技能資料夾或偵測到同名檔案出現時停止，安裝器永不刪除目的資料夾裡的檔案，也不以 `.freedom-install.json` 授予覆寫權；要更新請先自行移走或刪除舊資料夾再安裝，或改用下載 zip。失敗可能留下部分檔案，請確認後自行處理，或改用下載 zip。shell／PowerShell 先在暫存資料夾下載與解壓縮，確認 `SKILL.md` 後以不接受既有目的地的方式建立目錄，再複製內容；僅清理暫存目錄。
- 瀏覽器 API 沒有 exclusive create，無法完全排除其他程式在檢查與寫入之間同時寫入。

## 與 SPEC-SKL-03 的界線

`.freedom-install.json` 是本機收據，只含版本、目標與指紋，不含路徑、帳號或檔案內容。它**不是** A1 receipt，
也不建立或投影 MemberSkillInstallation 的 `verified` 狀態；之後的 CLI adapter 可讀取它再走正式回報。

## 驗證

```sh
node scripts/freedom.mjs module-check
npx tsx --test tests/runtime/skill-install-bundle.test.ts
npm run typecheck
npm run build
```
