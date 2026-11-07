/** The two Agent entrypoints request the same authored, source-grounded page. */
export const skillPageContentInstruction = `page_content：依 README 與實際程式碼填完整介紹頁，全部為純文字，不傳 HTML、SVG、網址或額外欄位：
  - headline：6–30 字的具體效益主標，以「。」「！」「？」結尾。
  - problem：12–100 字，說明誰在什麼情境遇到什麼問題。
  - mechanism：20–160 字，解釋專案實際如何處理輸入、完成工作與產生結果；不要只重複效益。
  - outcomes：剛好 3 個不同的真實產出，每個 4–30 字；不是捏造使用成效。
  - flow：title 4–24 字、lead 10–100 字（使用環境、前置資料與條件）、caption 10–90 字、steps 剛好 3 步。
  - 每步含 icon、title（2–14 字）、note（8–60 字）。icon 使用 doc、sliders、check 等協定列出的固定圖示名稱；步驟寫專案真實的輸入→處理→輸出，不以「看介紹、看原作、開始使用」冒充功能。
  - flow.loop 只有真實循環才填 true，否則省略或 false。資料不足時先補讀原作文件，不要虛構功能或把範例文字當成果。`;
