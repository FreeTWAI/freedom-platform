/** The two Agent entrypoints request the same authored, source-grounded page. */
export const skillPageContentInstruction = `page_content：依 README 與實際程式碼填完整介紹頁，全部為純文字，不傳 HTML、SVG、網址或額外欄位：
  - headline：6–30 字的具體效益主標，以「。」「！」「？」結尾。
  - problem：12–100 字，說明誰在什麼情境遇到什麼問題。
  - mechanism：20–160 字，解釋專案實際如何處理輸入、完成工作與產生結果；不要只重複效益。
  - outcomes：剛好 3 個不同的真實產出，每個 4–30 字；不是捏造使用成效。
  - flow：title 4–24 字、lead 10–100 字（使用環境、前置資料與條件）、caption 10–90 字、steps 剛好 3 步。
  - 每步含 icon、title（2–14 字）、note（8–60 字）。icon 使用 doc、sliders、check 等協定列出的固定圖示名稱；步驟寫專案真實的輸入→處理→輸出，不以「看介紹、看原作、開始使用」冒充功能。
  - flow.loop 只有真實循環才填 true，否則省略或 false。資料不足時先補讀原作文件，不要虛構功能或把範例文字當成果。`;

/** Shared editorial brief for both Agent entrypoints; format validation alone cannot judge meaning. */
export const skillShareIntroductionInstruction = `share_introductions：剛好 100 則彼此不同的單行分享短文，每則 8–200 字。
  - 先從 README 與實際程式碼整理核心定位：這是什麼工具或手冊、替誰解決什麼問題、如何得到什麼結果。只使用來源支持的內容。
  - 每一則都要能單獨給完全不認識 Repo 的人閱讀：寫出專案名稱或清楚的產品類型、核心用途，以及讀者為什麼會想用它。不要假設讀者已看過介紹頁或其他 99 則。
  - 100 則可以圍繞相同的核心價值換句話說，變換情境、語序與切入點。不要為了湊不同句子，改講不相關或次要功能。
  - 安裝指令、版本號、測試 gate、通過門檻、範例可重跑、修改紀錄、授權聲明、Fork／Issue／PR 邀請都不能單獨充當介紹；這些資料放在使用說明。
  - 手冊、規則集、設計方案與可執行工具要如實區分。不要把計畫或示範寫成已提供的服務，不捏造省時比例、使用人數、效果或自動完成的範圍。
  - 寫完逐則審查全部 100 則：只看這一句，陌生讀者能否說出「它做什麼、對我有什麼用」？答不出就重寫。刪掉空泛口號、無關補句與無來源的承諾，再檢查字數及重複。`;
