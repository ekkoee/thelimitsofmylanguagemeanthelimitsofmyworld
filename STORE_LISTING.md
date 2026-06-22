# Chrome Web Store — 上架文案（草稿）

## 名稱
Immersive Bilingual — X / Reddit / YouTube 雙語

## 簡短說明（≤132 字元）
原文一行、中文一行的沉浸式雙語顯示。支援 X/Twitter、Reddit 貼文留言與 YouTube 字幕，深色模式友善。

## 詳細說明
把英文內容直接變成雙語閱讀，不必跳到別的分頁、也不是把整段塞到頁尾。

• X / Twitter：推文、回覆、引用、個人簡介
• Reddit：貼文標題、內文、留言
• YouTube：影片字幕即時雙語疊加

特色
• 逐句對齊 — 每句英文對每句中文，閱讀節奏自然
• 顯示模式可切換：雙語對照 / 只中文 / 只英文
• 排列可切換：英文在上或中文在上
• 自備引擎：OpenAI、Gemini，或用 Ollama 跑本地模型
• 內建快取與佇列，控制 API 成本；可設定「只翻可見內容」
• 深色模式友善、字體大小可調

你的 API key 只存在本機瀏覽器，不會上傳到我們的伺服器。

## 權限說明（提供給審查與使用者）
• storage：儲存你的設定與翻譯快取（本機）。
• host：x.com / twitter.com / reddit.com / youtube.com — 在這些頁面插入雙語內容。
• host：api.openai.com / generativelanguage.googleapis.com / localhost —
  依你所選的引擎，將要翻譯的文字送往你自己設定的供應商。

## 隱私
本擴充不蒐集、不販售個人資料。要翻譯的文字會傳送至你選擇的翻譯供應商
（OpenAI / Google Gemini / 你本機的 Ollama）以取得翻譯結果。API key 僅儲存於
你瀏覽器的 chrome.storage，不會傳給開發者。
