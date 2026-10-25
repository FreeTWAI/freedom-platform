// Source: Jason and Hao 哥, authorized local quiz-v2.html (original 8 careers, 15 questions and score tables).
// 18-guild extension (11 added careers, added options and weights) drafted in Traditional Chinese for Jason's review;
// see career-redesign notes. Original option indices are preserved so stored answers keep their meaning.
export type Career = "content" | "automation" | "coach" | "visual" | "product" | "marketing" | "outsourcer" | "consultant" | "video" | "music" | "stage" | "host" | "researcher" | "engineer" | "security" | "broker" | "shopkeeper" | "maker" | "accountant";
export type Dimension = "personality" | "lifestyle" | "capability";
export type Question = {q:string;multi?:boolean;maxSelect?:number;options:{text:string;scores:Partial<Record<Career,number>>}[]};
export const CLASSES_V2 = {
  "content": {
    "name": "AI 內容獵人",
    "tagline": "用 AI 幫某個產業寫文章，讓對的人在 Google 找到",
    "plainIntro": "你用 AI 幫公司 / 店家 / 品牌寫文章、網頁、社群貼文，讓更多客人在網路上找到他們",
    "color": "from-blue-500 to-cyan-500",
    "hex": "#22d3ee",
    "actions": [
      "挑 1 個產業垂直（律師 / 牙醫 / 房仲）",
      "產 5 篇樣品文展示實力",
      "冷郵 30 間目標企業找第一個客戶"
    ]
  },
  "automation": {
    "name": "AI 自動化技師",
    "tagline": "把重複流程變成「按一下就搞定」",
    "plainIntro": "你幫人把「每天重複要做的雜事」設計成「按一下就跑完」的流程，省他們的時間和人力",
    "color": "from-green-500 to-emerald-500",
    "hex": "#10b981",
    "actions": [
      "選 1 個工具（Make / n8n）練到神",
      "幫朋友免費做 1 案當 case study",
      "把 case study 拍成 demo 接第二案"
    ]
  },
  "coach": {
    "name": "AI 知識教練",
    "tagline": "把你會的東西變成別人願意付錢學的服務",
    "plainIntro": "你把自己的專長做成課程、教學或一對一諮詢，教別人學得會（他們願意付錢學）",
    "color": "from-purple-500 to-pink-500",
    "hex": "#a855f7",
    "actions": [
      "找出你比 90% 人強的主題",
      "做 1 場免費 90 分鐘工作坊練流程",
      "收 2 位付費學生迭代內容"
    ]
  },
  "visual": {
    "name": "AI 視覺煉金師",
    "tagline": "用 AI 把創意變成品牌圖、商品照與設計",
    "plainIntro": "你用 AI 幫品牌 / 個人做品牌圖、商品照與平面設計（他們需要視覺但不會做）；影片剪輯另由 AI 影音導演承接",
    "color": "from-pink-500 to-rose-500",
    "hex": "#ec4899",
    "actions": [
      "選 1 個風格練到神等級",
      "IG / Threads 日更展示作品",
      "DM 10 個品牌談收費案子"
    ]
  },
  "product": {
    "name": "AI 產品鍛造師",
    "tagline": "用 AI 自己做小工具或 App，讓人每月付錢用",
    "plainIntro": "你自己用 AI 做一個小工具 / App / 網站，解決某群人的痛點，讓他們每月付錢繼續用",
    "color": "from-indigo-500 to-purple-500",
    "hex": "#6366f1",
    "actions": [
      "找自己每天重複的痛",
      "週末寫出 V1（能用就好）",
      "上 ProductHunt 找前 10 個用戶"
    ]
  },
  "marketing": {
    "name": "AI 行銷操盤手",
    "tagline": "幫品牌用 AI 跑廣告、經營社群",
    "plainIntro": "你幫品牌 / 店家用 AI 做廣告、經營 IG / FB、分析數據，讓他們生意變好",
    "color": "from-orange-500 to-red-500",
    "hex": "#f97316",
    "actions": [
      "選 1 個產業深挖",
      "幫朋友免費跑 1 個月廣告出數據",
      "結果做成 case study 接付費案"
    ]
  },
  "outsourcer": {
    "name": "AI 外包代理商",
    "tagline": "國內外接案、拆清範圍，用 AI 加速交件",
    "plainIntro": "你在國內外接案平台或熟人介紹接工作，把需求拆成清楚範圍，用 AI 做快一倍交件給客戶",
    "color": "from-teal-500 to-cyan-500",
    "hex": "#14b8a6",
    "actions": [
      "註冊 Upwork / Fiverr 完成平台認證",
      "用 AI 加速接前 3 案累評價",
      "建立品牌或雇協作者放大產能"
    ]
  },
  "consultant": {
    "name": "AI 導入顧問",
    "tagline": "幫傳統企業把「業務痛點」翻譯成「AI 解決方案」",
    "plainIntro": "你幫傳統公司（不懂 AI 的老闆）找出「哪裡可以用 AI 省錢或賺更多」，再幫他們實際裝好用起來；醫療、法務、財會等產業專家也可以從這裡起步",
    "color": "from-yellow-500 to-amber-500",
    "hex": "#f59e0b",
    "actions": [
      "選 1 個你熟悉的產業",
      "免費幫 1 家朋友公司診斷 AI 可用點",
      "做成 case study + 影片接付費案"
    ]
  },
  "video": {
    "name": "AI 影音導演",
    "tagline": "用 AI 剪片、上字幕，把影片產線自動化",
    "plainIntro": "你幫品牌或創作者把素材剪成短影音、長片與字幕版本，並把重複的剪輯流程做成可重用的產線",
    "color": "from-red-500 to-orange-500",
    "hex": "#f97316",
    "actions": [
      "挑 1 種影片格式（短影音 / 教學片）練到穩定",
      "幫 1 位朋友把 10 支素材做成系列片",
      "把剪輯、字幕、輸出步驟寫成檢查表接第一案"
    ]
  },
  "music": {
    "name": "AI 音律吟遊詩人",
    "tagline": "用 AI 寫歌、編曲，配上 MV 說故事",
    "plainIntro": "你用 AI 輔助作詞、作曲、編曲與 MV 分鏡，替個人、品牌或活動做出能被記住的聲音與故事",
    "color": "from-fuchsia-500 to-purple-500",
    "hex": "#d946ef",
    "actions": [
      "確認你使用的 AI 音樂工具授權條款",
      "完成 1 首 60 秒作品＋簡易 MV",
      "幫 1 個小店或活動做主題曲 demo"
    ]
  },
  "stage": {
    "name": "AI 光影造夢師",
    "tagline": "用投影與動態視覺，把牆面、展場變成舞台",
    "plainIntro": "你用 AI 生成動態素材、規劃投影與播放流程，讓展場、活動或店面變成會說故事的空間",
    "color": "from-violet-500 to-blue-500",
    "hex": "#8b5cf6",
    "actions": [
      "用家用投影機在牆面完成 1 段 30 秒光影",
      "記錄場地尺寸、亮度與播放設定",
      "找 1 場小型活動提案現場光影"
    ]
  },
  "host": {
    "name": "AI 聚會召喚師",
    "tagline": "辦讀書會、聚會、社群活動，讓人來了就不想走",
    "plainIntro": "你策劃讀書會、小聚與社群活動，用 AI 處理報名、提醒與回顧，讓參加的人找到下一步",
    "color": "from-orange-400 to-amber-500",
    "hex": "#fb923c",
    "actions": [
      "定一個主題，辦 1 場 6 人以內小聚",
      "用表單＋AI 整理報名與會後回顧",
      "把流程寫成可複製的活動手冊"
    ]
  },
  "researcher": {
    "name": "AI 研究考據師",
    "tagline": "用 AI 讀資料、查來源，把複雜框架整理成可信筆記",
    "plainIntro": "你用 AI 協助閱讀文獻與資料，逐一查核來源、並列不同觀點，整理成別人看得懂、也查得到出處的筆記",
    "color": "from-slate-500 to-sky-600",
    "hex": "#0284c7",
    "actions": [
      "選 1 個你好奇的主題列 10 個原始來源",
      "寫 1 份附出處與不同觀點的整理筆記",
      "邀 3 位同好共讀並記錄回饋"
    ]
  },
  "engineer": {
    "name": "AI 平台架構師",
    "tagline": "串 API、整資料、顧穩定，讓系統不半夜爆炸",
    "plainIntro": "你用 AI 協助串接 API、整理資料流與監控，讓團隊的平台穩定、好維護、出問題找得到原因",
    "color": "from-gray-600 to-slate-800",
    "hex": "#475569",
    "actions": [
      "挑 1 個常用服務，練熟它的 API 與錯誤處理",
      "幫自己的小專案加上紀錄與健康檢查",
      "把一次除錯過程寫成事後回顧"
    ]
  },
  "security": {
    "name": "AI 資安守門人",
    "tagline": "在授權範圍內找漏洞、驗修復，幫系統上鎖",
    "plainIntro": "你在自己或客戶書面授權的系統範圍內，用 AI 協助整理檢查清單、找出風險並驗證修復",
    "color": "from-emerald-600 to-gray-700",
    "hex": "#059669",
    "actions": [
      "只用自己的帳號與系統練基本檢查",
      "整理 1 份密碼、權限、備份的自我檢查表",
      "幫 1 個朋友的網站在授權下做健檢報告"
    ]
  },
  "broker": {
    "name": "AI 商機牽線人",
    "tagline": "聽懂需求、找對夥伴，把合作牽成",
    "plainIntro": "你聽懂一方的需求、找到合適的另一方，用 AI 整理提案與追蹤，把合作與交易牽成",
    "color": "from-amber-500 to-red-500",
    "hex": "#ef4444",
    "actions": [
      "列出你身邊 20 位可能互補的人",
      "每週介紹 2 組人認識並追蹤結果",
      "把一次成功媒合寫成合作提案範本"
    ]
  },
  "shopkeeper": {
    "name": "AI 電商掌櫃",
    "tagline": "選貨開店、服務買家，讓小店穩穩賣",
    "plainIntro": "你用 AI 協助選品、寫商品頁、回覆買家與整理訂單，把一間小網店經營得井井有條",
    "color": "from-lime-500 to-green-600",
    "hex": "#65a30d",
    "actions": [
      "挑 1 類你懂的商品，找 3 個貨源比較",
      "開 1 個小賣場上架 5 件商品",
      "用 AI 整理常見問題並回覆前 10 位買家"
    ]
  },
  "maker": {
    "name": "AI 供應鍛冶師",
    "tagline": "把實體好貨的規格、交期與品質講清楚",
    "plainIntro": "你用 AI 整理實體商品的規格、打樣、交期與品管紀錄，讓買家與合作方信得過這批貨",
    "color": "from-stone-500 to-amber-700",
    "hex": "#b45309",
    "actions": [
      "挑 1 件你熟悉的實體商品寫完整規格表",
      "記錄 1 次打樣或進貨的品質檢查",
      "把供貨條件整理成給買家的一頁說明"
    ]
  },
  "accountant": {
    "name": "AI 帳房先生",
    "tagline": "收款、對帳、整理帳目，讓每一筆錢都對得上",
    "plainIntro": "你用 AI 協助商家整理收款紀錄、核對訂單與入帳差異，做出老闆看得懂的月報；稅務與法規判斷仍交給合格專業人士",
    "color": "from-teal-600 to-emerald-700",
    "hex": "#0f766e",
    "actions": [
      "用試算表整理自己 1 個月的收支",
      "練習核對 1 份訂單與收款明細的差異",
      "幫 1 位小店老闆做一份月對帳摘要"
    ]
  }
};
export const EXTRA_DATA_V2 = {
  "content": {
    "dayInLife": [
      {
        "time": "09:00",
        "act": "看目標產業新聞、找熱門議題"
      },
      {
        "time": "10:00",
        "act": "Claude 寫 3-4 篇 SEO 文初稿"
      },
      {
        "time": "13:30",
        "act": "精修 + SEO 檢查 + 上稿"
      },
      {
        "time": "16:00",
        "act": "冷郵 10 封開發新客 + 回客訊"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "挑 1 產業 + 產 5 篇樣品展示"
      },
      {
        "week": "W2",
        "goal": "冷郵 30 家 SME 找第 1 個客戶"
      },
      {
        "week": "W3",
        "goal": "簽第 1 單，開始交付"
      },
      {
        "week": "W4",
        "goal": "收款 + 找第 2 個客戶"
      }
    ],
    "painPoints": [
      {
        "pain": "寫出來沒流量、沒人看",
        "solution": "先挑競爭低的長尾關鍵字（3-5 字以上），不要硬拼大詞"
      },
      {
        "pain": "覺得我文筆不好不敢交件",
        "solution": "客戶要的是 ROI（流量、轉單），不是文學獎。你已經贏 80% 不用 AI 的同行"
      },
      {
        "pain": "客戶改來改去沒完沒了",
        "solution": "第一版先給「大綱 + 首段」讓客戶確認方向，有共識再寫全文"
      }
    ],
    "ally": {
      "key": "marketing",
      "reason": "你的內容 + 他的廣告操盤 = 品牌爆發組合"
    },
    "rival": {
      "key": "product",
      "reason": "你要廣度、他要深度；合作節奏很難拿捏"
    },
    "traits": {
      "tech": 2,
      "creative": 2,
      "sales": 2,
      "discipline": 5,
      "vision": 3,
      "network": 2
    }
  },
  "automation": {
    "dayInLife": [
      {
        "time": "09:00",
        "act": "看昨天流程執行報告、找 bug"
      },
      {
        "time": "10:00",
        "act": "設定 / 除錯 Make 或 n8n 流程"
      },
      {
        "time": "14:00",
        "act": "訪談新客戶找自動化痛點"
      },
      {
        "time": "16:00",
        "act": "寫交付文件 + 客戶教育"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "選 1 工具（Make / n8n）練熟 + 做 demo"
      },
      {
        "week": "W2",
        "goal": "幫 1 位朋友免費做案拍 case study"
      },
      {
        "week": "W3",
        "goal": "Demo 錄影 + 冷接觸 20 家"
      },
      {
        "week": "W4",
        "goal": "簽第 1 付費單"
      }
    ],
    "painPoints": [
      {
        "pain": "客戶講不清楚自己要什麼",
        "solution": "請他示範一次流程給你看，你錄下來當 SDD 規格"
      },
      {
        "pain": "第三方 API 掛掉，整個流程斷",
        "solution": "加「錯誤備援 + LINE 即時通知」機制，客戶不會怪你"
      },
      {
        "pain": "客戶用 1 週發現新例外沒處理",
        "solution": "合約寫清楚：第一次出包免費修，之後按時計費"
      }
    ],
    "ally": {
      "key": "consultant",
      "reason": "他找痛點、你實作自動化；SME 導入一條龍"
    },
    "rival": {
      "key": "visual",
      "reason": "邏輯 vs 美感；不是敵人，但不是最佳拍檔"
    },
    "traits": {
      "tech": 5,
      "creative": 1,
      "sales": 2,
      "discipline": 4,
      "vision": 3,
      "network": 2
    }
  },
  "coach": {
    "dayInLife": [
      {
        "time": "09:00",
        "act": "回學生問題 + 整理常見 FAQ"
      },
      {
        "time": "10:00",
        "act": "寫本週課程內容 / 講義"
      },
      {
        "time": "14:00",
        "act": "錄教學影片"
      },
      {
        "time": "19:00",
        "act": "開 1 對 1 諮詢 / 小班直播課"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "找你比 90% 人強的主題 + 大綱"
      },
      {
        "week": "W2",
        "goal": "做 1 場免費 90 分鐘工作坊練流程"
      },
      {
        "week": "W3",
        "goal": "收 2 位付費 1 對 1 學生"
      },
      {
        "week": "W4",
        "goal": "辦 1 場付費小班 (3-5 人)"
      }
    ],
    "painPoints": [
      {
        "pain": "內容設計很好但沒人報名",
        "solution": "先做 1 對 1 低價驗證內容，不要直接上線課程"
      },
      {
        "pain": "學生買了卻沒執行",
        "solution": "課程設計成「做完才解鎖下一章」，強迫行動"
      },
      {
        "pain": "被要求退費或給負評",
        "solution": "先收 1/3 定金，學生達成小目標才收剩下 2/3"
      }
    ],
    "ally": {
      "key": "content",
      "reason": "你教內容、他擴散；知識觸及 × 10"
    },
    "rival": {
      "key": "outsourcer",
      "reason": "你要深度、他要速度；商業模式很難整合"
    },
    "traits": {
      "tech": 2,
      "creative": 2,
      "sales": 4,
      "discipline": 3,
      "vision": 4,
      "network": 4
    }
  },
  "visual": {
    "dayInLife": [
      {
        "time": "09:00",
        "act": "滑 Pinterest / IG 找靈感"
      },
      {
        "time": "10:00",
        "act": "Midjourney 產 20-30 張篩 3 張"
      },
      {
        "time": "14:00",
        "act": "Canva / PS 精修 + 交付客戶"
      },
      {
        "time": "17:00",
        "act": "IG 發作品 + DM 品牌談合作"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "選 1 風格練到神 + IG 發 7 張作品"
      },
      {
        "week": "W2",
        "goal": "DM 10 個小品牌談收費合作"
      },
      {
        "week": "W3",
        "goal": "簽第 1 單（月費型最好）"
      },
      {
        "week": "W4",
        "goal": "穩定交付 + 找第 2 單"
      }
    ],
    "painPoints": [
      {
        "pain": "客戶說「不是我要的感覺」",
        "solution": "交件前先給 3 個風格 mini-mockup，讓他選方向再做完整版"
      },
      {
        "pain": "修圖修到無底洞",
        "solution": "報價時明說「含 2 次大改、1 次小改」，超過要加價"
      },
      {
        "pain": "Midjourney 產的商業不能直接用",
        "solution": "prompt 功力 + 後製微調，這才是「用 AI」跟「被 AI 用」的差別"
      }
    ],
    "ally": {
      "key": "marketing",
      "reason": "你做素材、他下廣告；品牌好看又有效"
    },
    "rival": {
      "key": "automation",
      "reason": "美感 vs 流程；溝通成本高，不是最佳組合"
    },
    "traits": {
      "tech": 2,
      "creative": 5,
      "sales": 3,
      "discipline": 3,
      "vision": 2,
      "network": 3
    }
  },
  "product": {
    "dayInLife": [
      {
        "time": "09:00",
        "act": "看使用者反饋 + 監控 metrics"
      },
      {
        "time": "10:00",
        "act": "用 Claude Code 寫新功能 / 修 bug"
      },
      {
        "time": "14:00",
        "act": "部署 + 測試 + 寫文件"
      },
      {
        "time": "17:00",
        "act": "寫 build in public 貼文"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "找你每天的痛 + 拆 第一版規格"
      },
      {
        "week": "W2",
        "goal": "週末衝 V1 上線（Vercel）"
      },
      {
        "week": "W3",
        "goal": "ProductHunt + Threads 推，找前 10 位用戶"
      },
      {
        "week": "W4",
        "goal": "依反饋迭代 + 加付費選項"
      }
    ],
    "painPoints": [
      {
        "pain": "做完沒人用",
        "solution": "做前先 pre-sale 驗證 — 願意付錢的痛才真，再 build"
      },
      {
        "pain": "一直加功能沒時間推廣",
        "solution": "每週只做 1 個新功能 + 4 天推廣，build in public 的紀律"
      },
      {
        "pain": "怕被大廠 copy",
        "solution": "社群 + 品牌才是護城河，功能永遠會被抄"
      }
    ],
    "ally": {
      "key": "marketing",
      "reason": "你做產品、他推廣；獨立開發者 + 流量師的王道組合"
    },
    "rival": {
      "key": "content",
      "reason": "你要深、他要廣；合作不好拿捏節奏"
    },
    "traits": {
      "tech": 5,
      "creative": 3,
      "sales": 2,
      "discipline": 4,
      "vision": 4,
      "network": 2
    }
  },
  "marketing": {
    "dayInLife": [
      {
        "time": "09:00",
        "act": "檢查昨天廣告表現 (廣告報酬 / CPM)"
      },
      {
        "time": "10:00",
        "act": "調整出價 / 關閉爛素材 / 開新測試"
      },
      {
        "time": "14:00",
        "act": "Claude 產新廣告素材、文案"
      },
      {
        "time": "16:00",
        "act": "客戶週報 + 策略會議"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "選 1 產業深挖 + 讀競品 10 家"
      },
      {
        "week": "W2",
        "goal": "幫朋友免費跑 1 個月廣告出數據"
      },
      {
        "week": "W3",
        "goal": "結果做成 case study 發社群"
      },
      {
        "week": "W4",
        "goal": "冷接觸 10 家找第 1 個付費代操"
      }
    ],
    "painPoints": [
      {
        "pain": "客戶不願意給廣告預算",
        "solution": "改用「月費 + 效果分潤」綁在一起，客戶才有動力投錢"
      },
      {
        "pain": "跑廣告 3 週沒單嚇到客戶",
        "solution": "第一週測「素材」不是測「出價」，找對內容方向再放量"
      },
      {
        "pain": "客戶自己偷偷調廣告",
        "solution": "合約寫清楚「未溝通改動即停止服務」，護產出品質"
      }
    ],
    "ally": {
      "key": "visual",
      "reason": "你操盤廣告、他出素材；數據 + 創意雙引擎"
    },
    "rival": {
      "key": "coach",
      "reason": "你要 ROI、他要人味；短期 vs 長期磨合難"
    },
    "traits": {
      "tech": 3,
      "creative": 3,
      "sales": 5,
      "discipline": 3,
      "vision": 4,
      "network": 4
    }
  },
  "outsourcer": {
    "dayInLife": [
      {
        "time": "09:00",
        "act": "刷 Upwork 新案、投 5-10 份提案"
      },
      {
        "time": "10:00",
        "act": "AI 幫寫提案 / 翻譯客戶訊息"
      },
      {
        "time": "14:00",
        "act": "執行手上案子"
      },
      {
        "time": "20:00",
        "act": "對接美歐時區客戶（晚上活躍）"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "註冊 Upwork / Fiverr + 完整 profile"
      },
      {
        "week": "W2",
        "goal": "投 50 份提案 + 簽 2-3 案練評價"
      },
      {
        "week": "W3",
        "goal": "衝第 3-5 個 5 星評價"
      },
      {
        "week": "W4",
        "goal": "提高單價 + 養第 1 位回頭客"
      }
    ],
    "painPoints": [
      {
        "pain": "Upwork 投 50 份只上 1",
        "solution": "前 5 案接低價先衝 5 星評價，之後才有資格提價"
      },
      {
        "pain": "客戶 brief 爛但期待高",
        "solution": "Discovery call 必做，20 分鐘問清楚再報價"
      },
      {
        "pain": "收款被卡或被坑",
        "solution": "一律用平台 escrow（Upwork/Fiverr），絕不接私下匯款"
      }
    ],
    "ally": {
      "key": "automation",
      "reason": "你接案、他幫你自動化放大產能；效率飛天"
    },
    "rival": {
      "key": "coach",
      "reason": "你要速度、他要深度；合作節奏差太多"
    },
    "traits": {
      "tech": 2,
      "creative": 2,
      "sales": 4,
      "discipline": 5,
      "vision": 2,
      "network": 5
    }
  },
  "consultant": {
    "dayInLife": [
      {
        "time": "09:00",
        "act": "讀產業新聞 / 客戶公司動態"
      },
      {
        "time": "10:00",
        "act": "訪談潛在客戶 / 做流程診斷"
      },
      {
        "time": "14:00",
        "act": "Claude 整理診斷報告 / 做 PPT"
      },
      {
        "time": "16:00",
        "act": "寫提案 / 跟進月費合約"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "選 1 產業 + 免費診斷 1 家朋友公司"
      },
      {
        "week": "W2",
        "goal": "做成 case study + 錄 demo 影片"
      },
      {
        "week": "W3",
        "goal": "冷接觸 10 家 SME 老闆"
      },
      {
        "week": "W4",
        "goal": "簽下第 1 單付費診斷案"
      }
    ],
    "painPoints": [
      {
        "pain": "老闆聽不懂技術",
        "solution": "把 AI 成果換算成「省 X 小時/週」或「多賺 X 萬/月」，用錢換算才有感"
      },
      {
        "pain": "公司決策慢得像死水",
        "solution": "要找真老闆/實際決策者談，不要和中階主管耗時間"
      },
      {
        "pain": "做完診斷他們不執行",
        "solution": "把診斷 + 陪跑綁成一套賣（總價高且保證執行），不要只賣診斷"
      }
    ],
    "ally": {
      "key": "automation",
      "reason": "你找痛點、他實作自動化；SME 導入完美搭檔"
    },
    "rival": {
      "key": "product",
      "reason": "你賣客製、他賣標準產品；定位衝突"
    },
    "traits": {
      "tech": 3,
      "creative": 2,
      "sales": 5,
      "discipline": 3,
      "vision": 5,
      "network": 4
    }
  },
  "video": {
    "dayInLife": [
      {
        "time": "09:00",
        "act": "整理素材、標記可用片段"
      },
      {
        "time": "10:30",
        "act": "AI 粗剪＋自動字幕"
      },
      {
        "time": "14:00",
        "act": "精修節奏、配樂、調色"
      },
      {
        "time": "16:30",
        "act": "輸出多版本並回覆客戶意見"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "選定格式＋做 3 支樣片"
      },
      {
        "week": "W2",
        "goal": "建立剪輯與字幕檢查表"
      },
      {
        "week": "W3",
        "goal": "接第 1 案並準時交付"
      },
      {
        "week": "W4",
        "goal": "整理成套餐報價找第 2 案"
      }
    ],
    "painPoints": [
      {
        "pain": "剪一支要好幾天",
        "solution": "先定模板與片頭片尾，素材進來只換內容"
      },
      {
        "pain": "客戶說「感覺不對」",
        "solution": "開剪前先給 3 支參考片讓客戶選方向"
      },
      {
        "pain": "擔心素材版權",
        "solution": "只用客戶提供或授權清楚的素材，並記錄來源"
      }
    ],
    "ally": {
      "key": "music",
      "reason": "你的畫面＋他的聲音＝一支完整作品"
    },
    "rival": {
      "key": "researcher",
      "reason": "你追求速度與節奏，他要逐字查證，進度常卡住"
    },
    "traits": {
      "tech": 3,
      "creative": 4,
      "sales": 2,
      "discipline": 4,
      "vision": 2,
      "network": 2
    }
  },
  "music": {
    "dayInLife": [
      {
        "time": "10:00",
        "act": "聽參考曲、整理情緒關鍵字"
      },
      {
        "time": "11:00",
        "act": "AI 協助寫詞與旋律草稿"
      },
      {
        "time": "14:00",
        "act": "編曲、混音微調"
      },
      {
        "time": "17:00",
        "act": "做 MV 分鏡並與客戶對稿"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "確認工具授權＋完成 1 首 demo"
      },
      {
        "week": "W2",
        "goal": "做 1 支簡易 MV"
      },
      {
        "week": "W3",
        "goal": "幫 1 個活動或小店做主題曲"
      },
      {
        "week": "W4",
        "goal": "整理作品集與報價"
      }
    ],
    "painPoints": [
      {
        "pain": "不知道 AI 生成的歌能不能商用",
        "solution": "每次使用前讀工具條款，並保存生成紀錄"
      },
      {
        "pain": "作品聽起來都很像",
        "solution": "保留自己的人聲、樂器或歌詞，讓 AI 只做輔助"
      },
      {
        "pain": "不知道怎麼收費",
        "solution": "用「秒數＋用途＋修改次數」定價"
      }
    ],
    "ally": {
      "key": "video",
      "reason": "他幫你把歌變成好看的 MV"
    },
    "rival": {
      "key": "accountant",
      "reason": "你憑感覺創作，他要每筆都對得上，節奏不同"
    },
    "traits": {
      "tech": 2,
      "creative": 5,
      "sales": 2,
      "discipline": 2,
      "vision": 3,
      "network": 3
    }
  },
  "stage": {
    "dayInLife": [
      {
        "time": "10:00",
        "act": "勘場、量牆面與動線"
      },
      {
        "time": "11:30",
        "act": "AI 生成動態素材草稿"
      },
      {
        "time": "14:00",
        "act": "投影校正與播放排程"
      },
      {
        "time": "19:00",
        "act": "活動現場控台與收場紀錄"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "完成 1 段家中牆面光影"
      },
      {
        "week": "W2",
        "goal": "整理場勘與設備檢查表"
      },
      {
        "week": "W3",
        "goal": "在 1 場小活動試做"
      },
      {
        "week": "W4",
        "goal": "做成案例影片找下一場"
      }
    ],
    "painPoints": [
      {
        "pain": "設備很貴",
        "solution": "先租借或用家用投影機做小場"
      },
      {
        "pain": "現場光線和預想不同",
        "solution": "場勘時拍照記錄亮度，準備備援素材"
      },
      {
        "pain": "活動方只給很短準備時間",
        "solution": "準備可替換文字與色彩的模板素材"
      }
    ],
    "ally": {
      "key": "host",
      "reason": "他把人找來，你把現場變成舞台"
    },
    "rival": {
      "key": "engineer",
      "reason": "你要現場效果，他要系統穩定，常為了改動拉扯"
    },
    "traits": {
      "tech": 3,
      "creative": 5,
      "sales": 2,
      "discipline": 3,
      "vision": 4,
      "network": 3
    }
  },
  "host": {
    "dayInLife": [
      {
        "time": "10:00",
        "act": "回覆報名、確認場地"
      },
      {
        "time": "13:00",
        "act": "AI 整理主題資料與提醒訊息"
      },
      {
        "time": "19:00",
        "act": "主持聚會、帶討論"
      },
      {
        "time": "21:30",
        "act": "寫會後回顧與下次邀約"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "辦 1 場 6 人小聚"
      },
      {
        "week": "W2",
        "goal": "整理報名與提醒流程"
      },
      {
        "week": "W3",
        "goal": "辦第 2 場並收集回饋"
      },
      {
        "week": "W4",
        "goal": "寫成活動手冊、找合作場地"
      }
    ],
    "painPoints": [
      {
        "pain": "擔心沒人來",
        "solution": "先邀 3 位確定會來的朋友，再擴大"
      },
      {
        "pain": "現場冷場",
        "solution": "準備 3 個暖場問題與分組小任務"
      },
      {
        "pain": "辦完就散了",
        "solution": "會後 24 小時內寄回顧與下一步"
      }
    ],
    "ally": {
      "key": "broker",
      "reason": "你聚人，他把聚來的人牽成合作"
    },
    "rival": {
      "key": "security",
      "reason": "你想讓人輕鬆進來，他想把門鎖緊，要互相理解"
    },
    "traits": {
      "tech": 1,
      "creative": 3,
      "sales": 4,
      "discipline": 3,
      "vision": 2,
      "network": 5
    }
  },
  "researcher": {
    "dayInLife": [
      {
        "time": "09:00",
        "act": "列出今天要查的問題"
      },
      {
        "time": "10:00",
        "act": "AI 協助摘要文獻，逐條核對原文"
      },
      {
        "time": "14:00",
        "act": "整理不同觀點與出處"
      },
      {
        "time": "16:30",
        "act": "寫筆記並標示不確定處"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "選主題＋列 10 個原始來源"
      },
      {
        "week": "W2",
        "goal": "寫第 1 份附出處的筆記"
      },
      {
        "week": "W3",
        "goal": "辦 1 次共讀收集回饋"
      },
      {
        "week": "W4",
        "goal": "整理成系列筆記或小講座"
      }
    ],
    "painPoints": [
      {
        "pain": "AI 摘要有時會編造",
        "solution": "每一條都回到原文核對頁碼或段落"
      },
      {
        "pain": "觀點太多不知道怎麼寫",
        "solution": "並列呈現、標明出處，不急著下結論"
      },
      {
        "pain": "寫得太難沒人看",
        "solution": "每篇開頭先用三句話說重點"
      }
    ],
    "ally": {
      "key": "coach",
      "reason": "你把資料查清楚，他把它教得好懂"
    },
    "rival": {
      "key": "video",
      "reason": "他要快、你要準，時程常對不上"
    },
    "traits": {
      "tech": 3,
      "creative": 2,
      "sales": 1,
      "discipline": 5,
      "vision": 4,
      "network": 2
    }
  },
  "engineer": {
    "dayInLife": [
      {
        "time": "09:00",
        "act": "看監控與昨晚紀錄"
      },
      {
        "time": "10:00",
        "act": "AI 協助寫串接與測試"
      },
      {
        "time": "14:00",
        "act": "整理資料流與文件"
      },
      {
        "time": "16:30",
        "act": "排查問題並寫回顧"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "練熟 1 個服務的 API"
      },
      {
        "week": "W2",
        "goal": "幫小專案加紀錄與健康檢查"
      },
      {
        "week": "W3",
        "goal": "完成 1 個資料串接"
      },
      {
        "week": "W4",
        "goal": "把除錯流程寫成文件"
      }
    ],
    "painPoints": [
      {
        "pain": "半夜被叫起來修",
        "solution": "先做監控與警示，問題小時就發現"
      },
      {
        "pain": "沒人看得懂系統怎麼接",
        "solution": "畫一張資料流向圖放在說明文件"
      },
      {
        "pain": "AI 寫的程式不敢上線",
        "solution": "每段都寫測試，先在測試環境驗證"
      }
    ],
    "ally": {
      "key": "security",
      "reason": "你把系統蓋穩，他幫你把門鎖好"
    },
    "rival": {
      "key": "stage",
      "reason": "他要臨場變化，你要流程穩定"
    },
    "traits": {
      "tech": 5,
      "creative": 1,
      "sales": 1,
      "discipline": 4,
      "vision": 4,
      "network": 1
    }
  },
  "security": {
    "dayInLife": [
      {
        "time": "09:00",
        "act": "確認今天的授權範圍"
      },
      {
        "time": "10:00",
        "act": "依清單檢查設定與權限"
      },
      {
        "time": "14:00",
        "act": "AI 協助整理風險與修復建議"
      },
      {
        "time": "16:00",
        "act": "驗證修復並寫報告"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "在自己的系統練基本檢查"
      },
      {
        "week": "W2",
        "goal": "整理自我檢查表"
      },
      {
        "week": "W3",
        "goal": "在授權下幫 1 個朋友網站健檢"
      },
      {
        "week": "W4",
        "goal": "把報告格式做成範本"
      }
    ],
    "painPoints": [
      {
        "pain": "不確定什麼可以測",
        "solution": "只碰自己或有書面授權的系統，範圍寫清楚"
      },
      {
        "pain": "報告太技術沒人看",
        "solution": "先寫給老闆看的三行摘要，再附細節"
      },
      {
        "pain": "修好了又壞",
        "solution": "每次修復都留驗證步驟，定期重跑"
      }
    ],
    "ally": {
      "key": "engineer",
      "reason": "他蓋系統、你守系統，搭配最穩"
    },
    "rival": {
      "key": "host",
      "reason": "他想讓更多人進來，你想把門鎖緊"
    },
    "traits": {
      "tech": 5,
      "creative": 1,
      "sales": 1,
      "discipline": 5,
      "vision": 3,
      "network": 1
    }
  },
  "broker": {
    "dayInLife": [
      {
        "time": "09:30",
        "act": "整理名單與需求筆記"
      },
      {
        "time": "11:00",
        "act": "約 2 場咖啡或線上聊"
      },
      {
        "time": "14:00",
        "act": "AI 協助寫合作提案"
      },
      {
        "time": "17:00",
        "act": "追蹤進度、介紹下一組人"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "列 20 位互補的人"
      },
      {
        "week": "W2",
        "goal": "每週介紹 2 組人"
      },
      {
        "week": "W3",
        "goal": "促成第 1 個合作"
      },
      {
        "week": "W4",
        "goal": "整理媒合流程與抽成方式"
      }
    ],
    "painPoints": [
      {
        "pain": "介紹了卻沒下文",
        "solution": "介紹時寫清楚雙方各自要什麼，一週後追蹤"
      },
      {
        "pain": "不知道怎麼收費",
        "solution": "事前講好媒合費或分潤，寫成書面"
      },
      {
        "pain": "人脈太散",
        "solution": "用試算表標記每個人的需求與專長"
      }
    ],
    "ally": {
      "key": "host",
      "reason": "他的聚會就是你的人脈池"
    },
    "rival": {
      "key": "researcher",
      "reason": "你要快速成交，他要查清楚才肯動"
    },
    "traits": {
      "tech": 1,
      "creative": 2,
      "sales": 5,
      "discipline": 2,
      "vision": 4,
      "network": 5
    }
  },
  "shopkeeper": {
    "dayInLife": [
      {
        "time": "09:00",
        "act": "看訂單與買家訊息"
      },
      {
        "time": "10:30",
        "act": "AI 協助寫商品頁與回覆"
      },
      {
        "time": "14:00",
        "act": "包貨、出貨、補貨"
      },
      {
        "time": "17:00",
        "act": "看銷售數字、調整上架"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "選品＋比較 3 個貨源"
      },
      {
        "week": "W2",
        "goal": "開店上架 5 件"
      },
      {
        "week": "W3",
        "goal": "服務前 10 位買家"
      },
      {
        "week": "W4",
        "goal": "整理回購與常見問題"
      }
    ],
    "painPoints": [
      {
        "pain": "上架了沒人買",
        "solution": "先賣給身邊 10 個人，問他們為什麼買"
      },
      {
        "pain": "客服回不完",
        "solution": "用 AI 整理常見問題與回覆範本"
      },
      {
        "pain": "庫存壓太多",
        "solution": "先小量進貨，賣得動再補"
      }
    ],
    "ally": {
      "key": "maker",
      "reason": "他把貨做好，你把貨賣好"
    },
    "rival": {
      "key": "product",
      "reason": "你想先賣看看，他想先做到完美"
    },
    "traits": {
      "tech": 2,
      "creative": 3,
      "sales": 4,
      "discipline": 4,
      "vision": 3,
      "network": 3
    }
  },
  "maker": {
    "dayInLife": [
      {
        "time": "09:00",
        "act": "確認打樣或生產進度"
      },
      {
        "time": "11:00",
        "act": "AI 協助整理規格與檢驗紀錄"
      },
      {
        "time": "14:00",
        "act": "和工廠或師傅對細節"
      },
      {
        "time": "16:30",
        "act": "更新交期與供貨說明"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "寫 1 件商品完整規格表"
      },
      {
        "week": "W2",
        "goal": "記錄 1 次打樣品檢"
      },
      {
        "week": "W3",
        "goal": "整理供貨條件一頁說明"
      },
      {
        "week": "W4",
        "goal": "找 1 位買家試單"
      }
    ],
    "painPoints": [
      {
        "pain": "工廠說的交期常延誤",
        "solution": "每週固定確認進度並留紀錄"
      },
      {
        "pain": "品質每批不一樣",
        "solution": "訂出簡單檢驗標準，每批拍照存檔"
      },
      {
        "pain": "買家問題問不完",
        "solution": "把規格、尺寸、保固寫成一頁說明"
      }
    ],
    "ally": {
      "key": "shopkeeper",
      "reason": "你顧品質，他顧銷售"
    },
    "rival": {
      "key": "marketing",
      "reason": "他想先打廣告，你想先確認貨沒問題"
    },
    "traits": {
      "tech": 3,
      "creative": 3,
      "sales": 2,
      "discipline": 5,
      "vision": 3,
      "network": 2
    }
  },
  "accountant": {
    "dayInLife": [
      {
        "time": "09:00",
        "act": "匯入昨日訂單與收款紀錄"
      },
      {
        "time": "10:30",
        "act": "AI 協助比對差異並標記"
      },
      {
        "time": "14:00",
        "act": "追查退款、手續費與漏單"
      },
      {
        "time": "16:30",
        "act": "整理月報給老闆"
      }
    ],
    "monthPlan": [
      {
        "week": "W1",
        "goal": "整理自己 1 個月收支"
      },
      {
        "week": "W2",
        "goal": "練習訂單與收款對帳"
      },
      {
        "week": "W3",
        "goal": "幫 1 位老闆做月對帳摘要"
      },
      {
        "week": "W4",
        "goal": "整理成固定月服務"
      }
    ],
    "painPoints": [
      {
        "pain": "帳對不起來找不到原因",
        "solution": "先依日期與金額逐筆配對，再看手續費與退款"
      },
      {
        "pain": "老闆看不懂報表",
        "solution": "只放三個數字：收入、支出、差異"
      },
      {
        "pain": "碰到稅務問題",
        "solution": "記錄問題並轉介合格會計或稅務專業人士"
      }
    ],
    "ally": {
      "key": "shopkeeper",
      "reason": "他把東西賣出去，你讓每筆錢對得上"
    },
    "rival": {
      "key": "music",
      "reason": "他憑靈感，你憑紀錄，需要互相包容"
    },
    "traits": {
      "tech": 3,
      "creative": 1,
      "sales": 2,
      "discipline": 5,
      "vision": 3,
      "network": 2
    }
  }
};
export const DIMENSION_MAP_V2: Record<number,Dimension> = {
  "0": "personality",
  "1": "personality",
  "2": "lifestyle",
  "3": "lifestyle",
  "4": "personality",
  "5": "personality",
  "6": "lifestyle",
  "7": "lifestyle",
  "8": "capability",
  "9": "lifestyle",
  "10": "lifestyle",
  "11": "capability",
  "12": "capability",
  "13": "lifestyle",
  "14": "lifestyle"
};
export const DIMENSION_META_V2 = {
  "personality": {
    "label": "做自己",
    "sub": "你天生的樣子",
    "color": "from-purple-500 to-indigo-500",
    "why": "你天生會怎麼做事、什麼樣的人 / 事會讓你自然發光、不會累"
  },
  "lifestyle": {
    "label": "過生活",
    "sub": "你想要的人生",
    "color": "from-emerald-500 to-teal-500",
    "why": "你不會放棄的生活品質、不想變成的樣子、你的人生優先級"
  },
  "capability": {
    "label": "用強項",
    "sub": "你已經會什麼",
    "color": "from-amber-500 to-orange-500",
    "why": "你現有的專業、產業、經驗 —— 能被 AI 放大最快變現的"
  }
};
export const RADAR_AXES_V2 = [
  {
    "key": "tech",
    "label": "技術深度",
    "hint": "能自己做 vs 需人協作"
  },
  {
    "key": "creative",
    "label": "創意視覺",
    "hint": "設計感 / 視覺輸出"
  },
  {
    "key": "sales",
    "label": "溝通銷售",
    "hint": "對客戶 pitch"
  },
  {
    "key": "discipline",
    "label": "執行紀律",
    "hint": "持續交付"
  },
  {
    "key": "vision",
    "label": "策略遠見",
    "hint": "看趨勢 / 整合"
  },
  {
    "key": "network",
    "label": "關係社群",
    "hint": "人脈 / 影響力"
  }
];
export const QUESTIONS_V2: Question[] = [
  {
    "q": "週六下午空三小時，你最想做？",
    "options": [
      {
        "text": "寫個腳本解掉一個煩人的重複動作",
        "scores": {
          "automation": 1,
          "product": 2,
          "engineer": 3
        }
      },
      {
        "text": "把這週的靈感剪成一支短片",
        "scores": {
          "visual": 2,
          "video": 2,
          "music": 3
        }
      },
      {
        "text": "寫一篇把某個觀念講清楚的長文",
        "scores": {
          "content": 1,
          "coach": 2,
          "researcher": 3
        }
      },
      {
        "text": "約個剛認識的前輩喝咖啡",
        "scores": {
          "marketing": 1,
          "outsourcer": 1,
          "consultant": 1,
          "broker": 1
        }
      },
      {
        "text": "去看展、逛市集，或找個場地辦小聚",
        "scores": {
          "stage": 3,
          "host": 4,
          "maker": 3
        }
      }
    ]
  },
  {
    "q": "下面哪句回饋讓你最有成就感？",
    "options": [
      {
        "text": "「你這個自動化幫我每週省 5 小時」",
        "scores": {
          "automation": 1,
          "product": 1,
          "consultant": 2,
          "engineer": 2
        }
      },
      {
        "text": "「看完你那篇我終於搞懂了」",
        "scores": {
          "content": 2,
          "coach": 2,
          "researcher": 4
        }
      },
      {
        "text": "「這個畫面好美我想收藏」",
        "scores": {
          "visual": 1,
          "video": 4,
          "stage": 3
        }
      },
      {
        "text": "「你操盤的廣告讓業績漲了 30%」",
        "scores": {
          "marketing": 2,
          "outsourcer": 4
        }
      },
      {
        "text": "「這場活動讓我認識了好多人」",
        "scores": {
          "host": 1,
          "broker": 4
        }
      }
    ]
  },
  {
    "q": "客戶約你下週三下午 2 點 Zoom（視訊會議）對一下需求，你的反應？",
    "options": [
      {
        "text": "好啊，開會就開會",
        "scores": {
          "coach": 1,
          "marketing": 1,
          "outsourcer": 3,
          "consultant": 1,
          "host": 4,
          "broker": 4,
          "shopkeeper": 3
        }
      },
      {
        "text": "能 email 解決為什麼要開會",
        "scores": {
          "content": 1,
          "automation": 1,
          "product": 1,
          "researcher": 1,
          "engineer": 2,
          "security": 2,
          "accountant": 1
        }
      },
      {
        "text": "只要我不用當主講就好",
        "scores": {
          "content": 3,
          "automation": 1,
          "visual": 2,
          "video": 4,
          "music": 3,
          "accountant": 1
        }
      }
    ]
  },
  {
    "q": "同樣的產出你比較想做哪種深度？",
    "options": [
      {
        "text": "又快又多，30 個客戶各做一點",
        "scores": {
          "visual": 1,
          "marketing": 1,
          "outsourcer": 2,
          "video": 3,
          "shopkeeper": 4
        }
      },
      {
        "text": "少量極深，3 個客戶做很重",
        "scores": {
          "coach": 1,
          "consultant": 1,
          "stage": 3,
          "researcher": 1,
          "security": 1,
          "maker": 2,
          "accountant": 4
        }
      },
      {
        "text": "都不做客戶，產品自己長",
        "scores": {
          "content": 2,
          "product": 3
        }
      }
    ]
  },
  {
    "q": "兩版本比較測試（A/B test）完，轉換率（成交比例）差 0.8%，你的直覺反應？",
    "options": [
      {
        "text": "興奮，想馬上再跑一輪",
        "scores": {
          "product": 1,
          "marketing": 2,
          "shopkeeper": 1
        }
      },
      {
        "text": "好喔，知道結果就好",
        "scores": {
          "content": 1,
          "coach": 2,
          "visual": 1
        }
      },
      {
        "text": "先別動，這可能是雜訊",
        "scores": {
          "automation": 1,
          "product": 1,
          "consultant": 4,
          "researcher": 4,
          "engineer": 3,
          "security": 2,
          "accountant": 2
        }
      }
    ]
  },
  {
    "q": "你熬夜到半夜兩點最可能的原因？",
    "options": [
      {
        "text": "一個 bug（程式錯誤）不解掉睡不著",
        "scores": {
          "automation": 3,
          "product": 2,
          "engineer": 3,
          "security": 4
        }
      },
      {
        "text": "一個畫面就差一點點",
        "scores": {
          "visual": 4,
          "video": 2,
          "music": 3,
          "stage": 3
        }
      },
      {
        "text": "有個想法不寫下來會忘",
        "scores": {
          "content": 3,
          "coach": 2,
          "researcher": 2
        }
      },
      {
        "text": "明天見客戶要改簡報",
        "scores": {
          "marketing": 2,
          "consultant": 4
        }
      },
      {
        "text": "明天活動或出貨，東西還沒到位",
        "scores": {
          "host": 4,
          "shopkeeper": 4,
          "maker": 4
        }
      }
    ]
  },
  {
    "q": "對「一個人關起來做三個月沒人講話」的耐受度？",
    "options": [
      {
        "text": "這是必要條件，被打擾我會煩",
        "scores": {
          "content": 1,
          "automation": 4,
          "product": 1,
          "music": 3,
          "researcher": 3,
          "engineer": 2,
          "security": 1,
          "accountant": 3
        }
      },
      {
        "text": "可以，但每週要幾次人互動",
        "scores": {
          "coach": 1,
          "visual": 1,
          "maker": 2
        }
      },
      {
        "text": "不行，我需要被看見和被反饋",
        "scores": {
          "coach": 2,
          "marketing": 2,
          "outsourcer": 1,
          "consultant": 1,
          "host": 3,
          "broker": 3
        }
      }
    ]
  },
  {
    "q": "對著鏡頭錄自己露臉講話 5 分鐘？",
    "options": [
      {
        "text": "沒差，鏡頭有什麼好怕",
        "scores": {
          "coach": 2,
          "marketing": 2,
          "consultant": 2,
          "music": 2,
          "host": 2,
          "broker": 2
        }
      },
      {
        "text": "可以幕後剪，前面不露",
        "scores": {
          "content": 1,
          "visual": 2,
          "product": 3,
          "video": 1,
          "stage": 4,
          "accountant": 2
        }
      },
      {
        "text": "死都不要",
        "scores": {
          "automation": 3,
          "product": 1,
          "engineer": 3,
          "security": 1
        }
      }
    ]
  },
  {
    "q": "傳統產業老闆用 Excel 管 500 筆訂單，你看到的第一反應？",
    "options": [
      {
        "text": "我可以幫他做個系統，談個月費",
        "scores": {
          "automation": 1,
          "consultant": 1,
          "engineer": 2
        }
      },
      {
        "text": "寫一篇「5 步驟數位轉型」給這類人看",
        "scores": {
          "content": 2,
          "coach": 3
        }
      },
      {
        "text": "想做個 SaaS（訂閱制軟體）賣給 1000 個這種老闆",
        "scores": {
          "product": 1
        }
      },
      {
        "text": "這跟我無關",
        "scores": {
          "visual": 1,
          "outsourcer": 2
        }
      },
      {
        "text": "先問他貨從哪來、怎麼賣，幫他開網店",
        "scores": {
          "broker": 3,
          "shopkeeper": 3,
          "maker": 4
        }
      },
      {
        "text": "先幫他把訂單和收款逐筆對清楚",
        "scores": {
          "accountant": 4
        }
      }
    ]
  },
  {
    "q": "客戶是不會中文的老外，要用 Zoom（視訊會議）討論專案？",
    "options": [
      {
        "text": "OK 啊，不會就查 / 開字幕 / 用 AI 即時翻譯",
        "scores": {
          "outsourcer": 2,
          "consultant": 2,
          "broker": 1,
          "shopkeeper": 2
        }
      },
      {
        "text": "能不用 Zoom 就不用，能 email / 文字解決最好",
        "scores": {
          "automation": 2,
          "visual": 2,
          "product": 1,
          "engineer": 2,
          "accountant": 1
        }
      },
      {
        "text": "寧願全程打字 / 自己錄一段解釋影片傳給對方看，不要即時對話",
        "scores": {
          "content": 1,
          "automation": 2,
          "product": 1,
          "security": 3
        }
      }
    ]
  },
  {
    "q": "你能接受的收入結構？",
    "options": [
      {
        "text": "一堆小額月費疊加，每月慢慢長大",
        "scores": {
          "coach": 2,
          "product": 1,
          "marketing": 4,
          "shopkeeper": 2,
          "accountant": 2
        }
      },
      {
        "text": "三五個大單專案制",
        "scores": {
          "visual": 2,
          "outsourcer": 1,
          "consultant": 2,
          "stage": 2,
          "security": 3,
          "maker": 4
        }
      },
      {
        "text": "每週都有新案進來，現金流快",
        "scores": {
          "visual": 1,
          "marketing": 2,
          "outsourcer": 4,
          "video": 4,
          "host": 4,
          "broker": 4
        }
      },
      {
        "text": "看內容和流量變現，不固定但複利",
        "scores": {
          "content": 2,
          "coach": 2,
          "music": 4
        }
      }
    ]
  },
  {
    "q": "看到別人的作品，你第一個冒出來的念頭通常是？",
    "options": [
      {
        "text": "這邏輯有漏洞，這裡應該…",
        "scores": {
          "automation": 1,
          "product": 2,
          "consultant": 1,
          "engineer": 2,
          "security": 3,
          "accountant": 3
        }
      },
      {
        "text": "這配色太可惜，如果用…",
        "scores": {
          "visual": 4,
          "stage": 3
        }
      },
      {
        "text": "想法有趣但講得不夠清楚",
        "scores": {
          "content": 3,
          "coach": 1,
          "researcher": 4
        }
      },
      {
        "text": "這賣給誰？TA（目標客戶群）對不對？",
        "scores": {
          "marketing": 4,
          "outsourcer": 4,
          "consultant": 1,
          "broker": 1,
          "shopkeeper": 2
        }
      },
      {
        "text": "這來源可靠嗎？證據在哪？",
        "scores": {
          "researcher": 1,
          "security": 4
        }
      }
    ]
  },
  {
    "q": "三個月後你拿到一筆 30 萬預算，會投資在哪？",
    "options": [
      {
        "text": "伺服器 + API（程式介面）+ 開發工具，做一個我想做的工具",
        "scores": {
          "automation": 2,
          "product": 1,
          "engineer": 2
        }
      },
      {
        "text": "相機、螢幕、設計軟體，升級我的產出設備",
        "scores": {
          "visual": 1,
          "video": 4,
          "music": 2,
          "stage": 3
        }
      },
      {
        "text": "買廣告測市場，驗證自己寫的東西有人要",
        "scores": {
          "content": 2,
          "marketing": 2,
          "shopkeeper": 1
        }
      },
      {
        "text": "買線上課 / 找教練 / 跟產業前輩學",
        "scores": {
          "coach": 3,
          "consultant": 1,
          "researcher": 4
        }
      },
      {
        "text": "進一批貨或打樣，開店先賣看看",
        "scores": {
          "shopkeeper": 4,
          "maker": 2
        }
      }
    ]
  },
  {
    "q": "最想避免的工作情境？（最多選 2 個）",
    "multi": true,
    "maxSelect": 2,
    "options": [
      {
        "text": "客戶反覆改稿，每次一點點",
        "scores": {
          "automation": 3,
          "product": 1,
          "engineer": 1
        }
      },
      {
        "text": "整天看後台數字和報表",
        "scores": {
          "content": 1,
          "coach": 1,
          "visual": 1,
          "music": 3,
          "host": 1
        }
      },
      {
        "text": "一個人關三個月沒產出回饋",
        "scores": {
          "coach": 1,
          "marketing": 1,
          "outsourcer": 1,
          "consultant": 1,
          "broker": 1
        }
      },
      {
        "text": "要不斷解釋給非技術的人聽",
        "scores": {
          "visual": 1,
          "product": 1,
          "engineer": 2,
          "security": 3
        }
      },
      {
        "text": "低價搶案、客戶砍價",
        "scores": {
          "coach": 1,
          "product": 1,
          "consultant": 1,
          "maker": 4
        }
      }
    ]
  },
  {
    "q": "假設你只能選一件事做三年，哪個最接近理想？",
    "options": [
      {
        "text": "從 0 養一個工具到 1 萬付費用戶",
        "scores": {
          "product": 3
        }
      },
      {
        "text": "養一個粉絲社群，靠內容和教學活",
        "scores": {
          "content": 2,
          "coach": 1,
          "music": 3,
          "host": 4
        }
      },
      {
        "text": "養一組企業客戶，深度顧問合作",
        "scores": {
          "consultant": 2
        }
      },
      {
        "text": "養一條自動化產線，幫各種品牌跑廣告/內容",
        "scores": {
          "automation": 2,
          "marketing": 3,
          "outsourcer": 4
        }
      },
      {
        "text": "養一個作品庫，作品自己帶客戶來",
        "scores": {
          "visual": 2,
          "video": 1,
          "music": 2,
          "stage": 4
        }
      },
      {
        "text": "養一條供應鏈或一間店，回頭客自己來",
        "scores": {
          "shopkeeper": 2,
          "maker": 4
        }
      },
      {
        "text": "養一張人脈網，幫人牽線成交",
        "scores": {
          "broker": 4
        }
      },
      {
        "text": "當好幾家小店的帳房，每月幫他們把帳對清楚",
        "scores": {
          "accountant": 4
        }
      }
    ]
  }
];
