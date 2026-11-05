# 技能書介紹頁改版 · 2026-11-03

平台負責人 Ted 於 2026-11-03 指示：「我認為現在技能書的分享介紹頁面做得太醜了, 不管是配色還有圖, 都很沒有意義, 我希望我們技能書的頁面參考這樣 : https://ted-h-com.github.io/ai-security-scanner/index.html https://ted-h-com.github.io/multi-ai-chat-desktop/?lang=zh-TW https://ted-h-com.github.io/AI-Intune/?lang=zh-TW 這種帶著 SVG 流程圖的說明頁面 比較一目了然, 然後再把那些分享的按鈕加上去, 需要用 gpt 畫圖你就叫它們重畫, 你可以把所有技能書的介紹頁面重新做過嗎?」

本次重做全部 55 本目錄技能書的 `/development/skills/<id>`，並把分享圖換成依頁面內容渲染的分享卡。導讀、分享介紹、來源與公會綁定都沒有改；其他開發指引頁與會員投稿頁仍是原本的深色版面。

## 版面

參考頁的共同做法是：大標題配一句標語，用一張 SVG 流程圖說明怎麼運作，接著是用途卡片和深色的開始區塊。技能書頁依序為：

1. **開場**：類別、書名、標語、用途、行動按鈕、署名與徽章；右側「你會拿到」列出 3 項成果與收錄格式，書封縮小放在卡片角落。
2. **怎麼運作**：三步流程的 SVG 示意圖。SVG 只是裝飾（`aria-hidden`）；同樣的三步也寫成有序清單，螢幕閱讀器和窄螢幕都讀這份清單。720px 以下隱藏 SVG，只留清單卡片。
3. **用途與適用範圍**：適合誰、主要功能、使用前先知道。
4. **開始使用**（深色區塊）：開始前準備、練習步驟、原作的起步指令（有的話）、練習成果。
5. 原作與使用入口、分享、加入工坊、GitHub 數據與版本來源、協作、活動、完整指南與來源。

導讀裡每一句（適合誰、狀態、功能、準備、步驟、成果）仍出現在頁面上，順序也不變。

## 每本書的頁面內容

標語、3 項成果和三步流程寫在 `modules/community/skill-pages/<id>.json`：

| 欄位 | 內容 | 限制 |
| --- | --- | --- |
| `headline` | 開場標語 | 6–30 字，以。！？結尾 |
| `outcomes` | 「你會拿到」的 3 項成果 | 各 4–30 字，不重複 |
| `flow.title`／`flow.lead` | 流程區的標題與說明 | 4–24 字／10–100 字 |
| `flow.steps` | 3 步，各有 `icon`、`title`、`note` | 圖示需在 `SKILL_FLOW_ICONS`；標題 2–14 字；說明 8–60 字 |
| `flow.caption` | 圖下的提醒 | 10–90 字 |
| `flow.loop` | 是否畫出回到第一步的箭頭 | 可省略 |

內容只寫該書導讀已核對的事實；成果和步驟不能超出導讀，也不能宣稱工坊已安裝或驗證原作。`skillPageContentProblems()` 會拒絕未知欄位、連結、HTML，以及 SVG 方框容納不下的文字。渲染時不截斷文字；內容無效的書不會出現流程區。

SVG 與分享卡上的步驟文字由 `wrapFlowText()`（`modules/development/skill-flow.ts`）換行：

- 行數和逐字排滿時相同。
- 優先斷在標點後、中英文交界或英文字之間，各行長度盡量接近。
- 只有其他斷點都放不下時，才在連續中文字中間斷行。

分享卡的步驟標題每行約 8 個中文字。較長的標題最好含「、」「，」或英文詞，讓它斷在詞與詞之間。

## 樣式

`skillPageCss`（`modules/development/skill-page.ts`）用淺色紙張底、深墨字、萊姆綠標記與藍色輔助色。共用元素的樣式都限定在 `html.skill-page` 底下，其餘只用 `sp-`／`sf-` class，所以 `/development.css` 不會改到其他頁。`developmentHtml(..., {layout:'skill'})` 會在 `<html>` 加上 `skill-page`。

## 分享

- 分享區保留「分享技能書」對話框（換一句、分享、複製介紹與連結），並在頁面和對話框都加上 LINE、Facebook、X、Threads 連結。
- 連結格式：
  - LINE：`https://social-plugins.line.me/lineit/share?url=…&text=…`
  - Facebook：`https://www.facebook.com/sharer/sharer.php?u=…`（Facebook 只接受連結）
  - X：`https://twitter.com/intent/tweet?text=…`（介紹、換行、連結）
  - Threads：`https://www.threads.com/intent/post?text=…`（介紹、換行、連結）
- 頁面上的連結帶目前選中的介紹；沒選時用「書名 · 自由工坊」。對話框裡的連結每次換一句都會更新，網址與 `sharePlatformUrl()` 相同。

## 分享圖

原本 `apps/portal-web/public/brand/skill-illustrations/<id>.webp` 是抽象插畫，看不出書在做什麼。現在改成 1200×630 的分享卡，內容有書名、標語與三步流程，同時用於 OG／Twitter 圖片、頁面分享區和 SPA 技能書對話框。頁面分享區的圖說改為「分享到社群時的預覽圖。」；SPA 對話框仍標「功能示意圖，非實際操作截圖。」。

不用 imagegen 的原因：卡片上的中文要一字不差，而生成圖的規則禁止圖中出現文字。分享卡以程式渲染：

```sh
npx tsx scripts/render-skill-share-cards.ts            # 全部 55 本
npx tsx scripts/render-skill-share-cards.ts <id> ...   # 指定的書
```

- 腳本用 Playwright Chromium 以 1200×630、DPR 1 截圖 `skillShareCardHtml()`，再用 sharp 編成 WebP（quality 90）。
- 系統需要 Noto Sans CJK TC。沒有這個字型時腳本會停止，不會用替代字型出圖。
- 文字放不下時逐 px 縮小字級，到下限仍放不下就報錯。
- 腳本會更新 `docs/design/skill-illustration-manifest.json`：`mode` 為 `rendered-share-card`，`source_sha256` 是卡片 HTML 的雜湊，另記檔案大小與 SHA-256。
- 改了頁面內容或卡片樣式後要重跑；`tests/runtime/skill-pages.test.ts` 會比對雜湊。

圖片的替代文字由頁面內容組成：書名（冒號前）、標語與三步標題（`skillShareCardAlt()`）。`skillShareContentVersion` 因此升為 `2026-11-03.2`。書封（`docs/design/skill-book-art-manifest.json`）不變。

圖片網址沒有改。Facebook、LINE 等平台已快取的舊預覽，要等快取過期，或用平台的分享除錯工具重新抓取。

## 驗證

- `tests/runtime/skill-pages.test.ts` 檢查四件事：
  - 每本書都有有效的頁面內容。
  - 驗證規則會拒絕放不下或不安全的內容。
  - 頁面順序與 `html.skill-page`；CSS 只作用在技能書頁。
  - 分享卡 manifest、雜湊與替代文字。
- `tests/runtime/skill-sharing.test.ts` 新增四個平台的連結格式、頁面與對話框的一致性，以及換一句後的更新。
- 兩份會員分享技能書測試改為：書封核對生成提示詞，分享圖核對渲染來源雜湊。
