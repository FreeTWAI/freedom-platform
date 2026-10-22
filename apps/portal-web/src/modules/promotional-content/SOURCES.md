# 宣傳圖元件來源

本目錄屬於 freedom-platform 的 personal-content 模組。首輪只提供獨立單頁開發預覽，主站未掛載。

| 材料 | 來源與版本 | 本次使用 |
| --- | --- | --- |
| 文字適配演算法 | 作者提供的 Creator，commit a92dbd55e1eb28e22e104ebe4fdbed48142c0b0b，public/studio/typo/vendor/app.jsx，fitAndWrap | layout.ts 的 fitPromoText 改寫為可測試的純函式；換行加入 grapheme 與 word segmentation，最低字級溢出明確失敗 |
| TYPO 授權 | 同版本 public/studio/typo/LICENSE | 原文完整保留於 [TYPO-LICENSE.txt](licenses/TYPO-LICENSE.txt) |
| 平台品牌圖 | freedom-platform 既有 apps/portal-web/public/brand/freedom-workshop.webp | 沿用原檔與完整比例，只在 preview header 引用；品牌不因程式 MIT 授權而改授權 |
| 字型 | 作業系統與瀏覽器可用的 system-ui 字型組 | 不加入字型二進位、不連外部字型服務；跨裝置字形不保證完全一致 |
| 文案與幾何排版 | 本次新增的可替換範例與 Canvas 幾何圖形 | 範例不代表真實會員、活動或成果；其餘新程式依本倉 MIT |

固定 commit 中來源檔 bytes 的 SHA-256：

~~~text
app.jsx  b220fab9a0508aeac27c3214290c579d168ca7be0ac4befc2e93d781aa7422e1
LICENSE  1a66a150e092baeabf80139ff80fa0f1d199b1cd9461f57ec945d25b90fd7bb4
~~~

沒有搬入 Creator 的整個編輯器、本機服務、原始素材、品牌庫、提示詞歷史、帳號與交易後端。Director 的私有程式、FFmpeg、Python、轉檔與 WebGL 素材均未引入；Editkin 接線不屬於本次整合。

新增圖片、字型、模板與外部程式時逐項擴充此表，保留各自的作者與授權，不把原先可讀的私人來源推定為可公開散布。
