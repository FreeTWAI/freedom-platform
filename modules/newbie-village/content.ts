// Source: Jason and Hao 哥, authorized local quiz-v2.html. Text and score tables preserved.
export type Career = "content" | "automation" | "coach" | "visual" | "product" | "marketing" | "outsourcer" | "consultant";
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
    "tagline": "用 AI 把創意變成圖、影片、設計產出",
    "plainIntro": "你用 AI 幫品牌 / 個人做圖片、影片、設計（他們需要視覺但不會做）",
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
    "tagline": "上海外平台（Upwork）接案，用 AI 加速交件",
    "plainIntro": "你在海外接案平台（主要英文環境）接工作，用 AI 做快一倍交件給客戶，賺美金",
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
    "plainIntro": "你幫傳統公司（不懂 AI 的老闆）找出「哪裡可以用 AI 省錢或賺更多」，再幫他們實際裝好用起來",
    "color": "from-yellow-500 to-amber-500",
    "hex": "#f59e0b",
    "actions": [
      "選 1 個你熟悉的產業",
      "免費幫 1 家朋友公司診斷 AI 可用點",
      "做成 case study + 影片接付費案"
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
          "automation": 2,
          "product": 1
        }
      },
      {
        "text": "把這週的靈感剪成一支短片",
        "scores": {
          "visual": 2
        }
      },
      {
        "text": "寫一篇把某個觀念講清楚的長文",
        "scores": {
          "content": 2,
          "coach": 1
        }
      },
      {
        "text": "約個剛認識的前輩喝咖啡",
        "scores": {
          "consultant": 2,
          "outsourcer": 1,
          "marketing": 1
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
          "automation": 2,
          "consultant": 1,
          "product": 1
        }
      },
      {
        "text": "「看完你那篇我終於搞懂了」",
        "scores": {
          "content": 2,
          "coach": 2
        }
      },
      {
        "text": "「這個畫面好美我想收藏」",
        "scores": {
          "visual": 2
        }
      },
      {
        "text": "「你操盤的廣告讓業績漲了 30%」",
        "scores": {
          "marketing": 2,
          "outsourcer": 1
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
          "consultant": 2,
          "marketing": 1,
          "coach": 1,
          "outsourcer": 1
        }
      },
      {
        "text": "能 email 解決為什麼要開會",
        "scores": {
          "product": 2,
          "automation": 2,
          "content": 1
        }
      },
      {
        "text": "只要我不用當主講就好",
        "scores": {
          "visual": 1,
          "content": 1,
          "automation": 1
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
          "outsourcer": 2,
          "visual": 1,
          "marketing": 1
        }
      },
      {
        "text": "少量極深，3 個客戶做很重",
        "scores": {
          "consultant": 3,
          "coach": 1
        }
      },
      {
        "text": "都不做客戶，產品自己長",
        "scores": {
          "product": 3,
          "content": 1
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
          "marketing": 2,
          "product": 1
        }
      },
      {
        "text": "好喔，知道結果就好",
        "scores": {
          "visual": 1,
          "coach": 1,
          "content": 1
        }
      },
      {
        "text": "先別動，這可能是雜訊",
        "scores": {
          "automation": 1,
          "consultant": 2,
          "product": 1
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
          "product": 2,
          "automation": 2
        }
      },
      {
        "text": "一個畫面就差一點點",
        "scores": {
          "visual": 3
        }
      },
      {
        "text": "有個想法不寫下來會忘",
        "scores": {
          "content": 2,
          "coach": 1
        }
      },
      {
        "text": "明天見客戶要改簡報",
        "scores": {
          "consultant": 2,
          "marketing": 1
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
          "product": 2,
          "automation": 1,
          "content": 1
        }
      },
      {
        "text": "可以，但每週要幾次人互動",
        "scores": {
          "visual": 1,
          "coach": 1
        }
      },
      {
        "text": "不行，我需要被看見和被反饋",
        "scores": {
          "coach": 2,
          "marketing": 1,
          "consultant": 1,
          "outsourcer": 1
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
          "marketing": 1,
          "consultant": 1
        }
      },
      {
        "text": "可以幕後剪，前面不露",
        "scores": {
          "visual": 1,
          "content": 1,
          "product": 1
        }
      },
      {
        "text": "死都不要",
        "scores": {
          "product": 2,
          "automation": 2
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
          "consultant": 2,
          "automation": 2
        }
      },
      {
        "text": "寫一篇「5 步驟數位轉型」給這類人看",
        "scores": {
          "content": 2,
          "coach": 1
        }
      },
      {
        "text": "想做個 SaaS（訂閱制軟體）賣給 1000 個這種老闆",
        "scores": {
          "product": 3
        }
      },
      {
        "text": "這跟我無關",
        "scores": {
          "visual": 1,
          "outsourcer": 1
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
          "consultant": 1
        }
      },
      {
        "text": "能不用 Zoom 就不用，能 email / 文字解決最好",
        "scores": {
          "product": 1,
          "automation": 1,
          "visual": 1
        }
      },
      {
        "text": "寧願全程打字 / 自己錄一段解釋影片傳給對方看，不要即時對話",
        "scores": {
          "product": 1,
          "content": 1,
          "automation": 1
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
          "product": 2,
          "coach": 1,
          "marketing": 1
        }
      },
      {
        "text": "三五個大單專案制",
        "scores": {
          "consultant": 2,
          "visual": 1,
          "outsourcer": 1
        }
      },
      {
        "text": "每週都有新案進來，現金流快",
        "scores": {
          "outsourcer": 2,
          "visual": 1,
          "marketing": 1
        }
      },
      {
        "text": "看內容和流量變現，不固定但複利",
        "scores": {
          "content": 2,
          "coach": 2
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
          "product": 2,
          "automation": 1,
          "consultant": 1
        }
      },
      {
        "text": "這配色太可惜，如果用…",
        "scores": {
          "visual": 3
        }
      },
      {
        "text": "想法有趣但講得不夠清楚",
        "scores": {
          "content": 2,
          "coach": 1
        }
      },
      {
        "text": "這賣給誰？TA（目標客戶群）對不對？",
        "scores": {
          "marketing": 2,
          "consultant": 1,
          "outsourcer": 1
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
          "product": 3,
          "automation": 1
        }
      },
      {
        "text": "相機、螢幕、設計軟體，升級我的產出設備",
        "scores": {
          "visual": 2
        }
      },
      {
        "text": "買廣告測市場，驗證自己寫的東西有人要",
        "scores": {
          "marketing": 2,
          "content": 1
        }
      },
      {
        "text": "買線上課 / 找教練 / 跟產業前輩學",
        "scores": {
          "coach": 1,
          "consultant": 2
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
          "product": 1,
          "automation": 1
        }
      },
      {
        "text": "整天看後台數字和報表",
        "scores": {
          "visual": 1,
          "coach": 1,
          "content": 1
        }
      },
      {
        "text": "一個人關三個月沒產出回饋",
        "scores": {
          "consultant": 1,
          "coach": 1,
          "outsourcer": 1,
          "marketing": 1
        }
      },
      {
        "text": "要不斷解釋給非技術的人聽",
        "scores": {
          "product": 1,
          "visual": 1
        }
      },
      {
        "text": "低價搶案、客戶砍價",
        "scores": {
          "consultant": 1,
          "coach": 1,
          "product": 1
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
          "coach": 2,
          "content": 2
        }
      },
      {
        "text": "養一組企業客戶，深度顧問合作",
        "scores": {
          "consultant": 3
        }
      },
      {
        "text": "養一條自動化產線，幫各種品牌跑廣告/內容",
        "scores": {
          "marketing": 2,
          "outsourcer": 2,
          "automation": 1
        }
      },
      {
        "text": "養一個作品庫，作品自己帶客戶來",
        "scores": {
          "visual": 3
        }
      }
    ]
  }
];
