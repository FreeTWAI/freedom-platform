# 社群入口總覽

公開靜態入口 #community-hub，列出自由工坊共同經營的 LINE、Discord 與 Facebook 社群，以及平台內的參與入口。會員工作頁仍依原登入與權限流程。

資料由 [groups.ts](groups.ts) 維護；communityLinks 從 Community.tsx 移入，頁尾和總覽共用唯一來源。尚未提供的名稱、邀請網址明列 TODO，url 為 null，不產生連結。status active 僅表示已提供入口，不是即時可用性探測。

[work.ts](work.ts) 以 TabId 驗證站內目的地；不宣稱個別社群的即時進度。介面文字支援五種語言，社群原名保留。

驗證：npm run typecheck、npm run module:check、node --import tsx --test tests/runtime/community-hub.test.ts。瀏覽器測試由呼叫端先 build 再執行。

補資料流程見 [COORDINATION.md](COORDINATION.md)。無資料庫、API、旗標或遠端寫入。
