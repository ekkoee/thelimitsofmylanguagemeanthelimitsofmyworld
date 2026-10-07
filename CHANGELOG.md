# 更新紀錄 / Changelog

本專案版本號遵循 [語意化版本](https://semver.org/lang/zh-TW/);格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)。

## [1.3.20] - 2026-10-07

### 改善 Improved
- **Gemini 翻譯大幅加速**：Gemini 3 預設 thinking 等級是 `high`（最高推理深度），翻譯任務根本不需要推理，白白吃掉大量等待時間（尤其 TTFT）。現在對 Gemini 3 系列模型送出 `thinkingConfig: { thinkingLevel: 'minimal' }`（官方定義：Flash 專用，實務上等於不思考），模型、key、設定都不用動，翻譯品質不變、速度明顯提升。非 3.x 的模型字串不送此參數；絕不與 `thinkingBudget` 混用（API 會 400）。

## [1.3.19] - 2026-09-27

### 修正 Fixed
- **其他網站 Alt+A 真正修復**：根因是 `activeTab` 權限。原版靠 `chrome.commands` 觸發時 Chrome 自動授予 `activeTab`，SW 才能 `executeScript`。1.3.18 的 content-script→SW 訊息路徑**不會**授予 `activeTab`，導致 `executeScript` 被拒。1.3.19 改為 `alt-a-global.js` 直接在頁面內實例化 `UniversalTranslator`（跟 `universal-inject.js` 同一套邏輯），不經過 SW、不需要額外權限。

## [1.3.18] - 2026-09-27

### 修正 Fixed
- **其他網站 Alt+A 修復**：新增 `alt-a-global.js`（520 bytes），在所有 http/https 網站注入，只監聽 Alt+A 並轉發給 SW。SW 用同一套 `handleAltA` 邏輯注入通用翻譯。不再依賴 `chrome.commands` 綁定（ID 變更就失效的問題）。X/Reddit/YouTube 由 content.js 直接處理，alt-a-global 自動排除避免重複。

## [1.3.17] - 2026-09-27

### 修正 Fixed
- **恢復 Alt+A keydown 直接監聽**（1.3.14 誤刪）：content script 直接監聽 Alt+A 按鍵，不依賴 `chrome.commands` 綁定。SW 命令若也有觸發，用時間戳去重，確保單次按鍵只切換一次。這是 1.3.10–1.3.13 在 X 上能用的真正原因。

## [1.3.16] - 2026-09-27

### 修正 Fixed
- **移除 1.3.15 的固定 key**：key 造成新 ID，反而讓問題更糟。回到與原版相同的路徑 ID 機制。
- **真正的解法**：把 1.3.16 解壓後**覆蓋到原本能用的原版同一個資料夾**（路徑不變 → ID 不變 → Alt+A 綁定保留），然後在 `chrome://extensions` 按重新載入。Alt+A 程式碼與原版一字不差，ID 相同就一定能用。

## [1.3.15] - 2026-09-27

### 修正 Fixed
- **固定擴充功能 ID**：manifest 新增穩定的 `"key"`，之後所有版本共用同一個 ID（`glbjnfimcajjenihimblfaponejbkoph`）。之前每次解壓到不同資料夾就會產生新 ID，導致 Alt+A 綁定失效——這是 1.3.14 按 Alt+A 沒反應的真正原因（程式碼與原版一字不差，問題在 ID 一直變）。現在綁一次 Alt+A，永久有效。
- Key 保存在 `~/workspace/ext-work/.keys/extension-key.txt`，未來打包必須用同一個 key。

## [1.3.14] - 2026-09-27

### 修正 Fixed
- **Alt+A 完整回歸 GitHub 原版**：`service-worker.ts` 的 `onCommand`、`universal-inject.ts`、`index.ts` 的 Alt+A 訊息處理、`popup.ts`、`popup.html` 已用 `diff` 驗證與原版一字不差（僅版本號不同）。1.3.10–1.3.13 期間加的 keydown 監聽、捲動保護、try/catch 錯誤條、快捷鍵檢測、`{ok}` 回傳值全部移除。
- 今天的翻譯優化全部保留：st2t 繁簡校正、韓文 echo 偵測、Gemini pacing/batch、429 自動降級、parse error 降級、textContent 效能。

## [1.3.13] - 2026-09-27

### 修正 Fixed
- **撤掉 1.3.12 的 `<all_urls>` 授權按鈕**：使用者指出原版不需要授權，應回歸原做法。經比對 GitHub 原檔，`manifest` 權限與 SW 注入路徑確實一模一樣——問題不在授權。
- **Alt+A 快捷鍵綁定檢測**：X 上 Alt+A 能用是因為 content script 直接監聽按鍵（不經 `chrome.commands`）；一般網站必須走 `chrome.commands`，若快捷鍵在 `chrome://extensions/shortcuts` 被解除綁定或衝突，Alt+A 會靜默無效。popup 現在會用 `chrome.commands.getAll()` 檢查，若未綁定就顯示紅字警告，引導去手動綁定。
- **Gemini 降級修復**（1.3.12 的實質修復保留）：`onBatchFallback` 明確從免費 Google 引擎開始（Google 塞車轉 Microsoft），不再用已耗盡的 gemini 重試；LLM 回傳無法解析也不再顯示手動重試，直接走免費引擎補完。

## [1.3.12] - 2026-09-27

### 修正 Fixed
- **Alt+A 在非自動網站（BBC、日文站等）真正可用**：popup「翻譯這個網頁」按鈕一直可用，但 Alt+A 沒反應——原因是 popup 點擊會授予 `activeTab`，而鍵盤快捷鍵從 SW 發起的 `chrome.scripting` 注入拿不到執行權限，只能靜默失敗。現在 popup 新增「🔑 授權 Alt+A 在所有網站運作」按鈕（可選 `<all_urls>`，按一次即可）；授權後 Alt+A 在任何網站都能整頁翻譯。未授權時按 Alt+A 會在圖示顯示 `!` 提示去授權。
- **Gemini 429／壞回應自動降級修復**：之前 `onQuotaError` 用 `settings.provider`（仍是 gemini）重試，根本沒降級，長串文下半部直接顯示「翻譯失敗」按鈕。現在明確從免費 Google 引擎開始（Google 塞車再轉 Microsoft）。另新增：LLM 回傳無法解析（`Could not parse translations`）也不再顯示手動重試，直接走免費引擎補完。

## [1.3.11] - 2026-09-27

### 修正 Fixed
- **Alt+A 切換視圖不再亂跳捲動**：顯示／隱藏數百個翻譯區塊會干擾 Chrome 的捲動錨定（回報：切到「原文+中文」時頁面被甩到最下方）。現在切換前記住捲動位置，切換後兩個 animation frame 內若位置跑掉就還原。三條路徑都修：content script 按鍵監聽、SW 轉發訊息、SW stale-tab DOM fallback；通用注入（非自動網站）的第二次以後 Alt+A 也一樣。
- **通用注入（BBC 等非自動網站）失敗不再靜默**：`universal-inject.ts` 全程 try/catch，任何地方拋錯都會在頁面內顯示紅色錯誤條（含訊息），並回傳 `{ok:false}` 給 SW 記錄；SW 會驗證注入結果，不再以為成功。
- **通用掃描效能**：`collectUnits` 改用 `textContent` 取代 `innerText`（後者每次呼叫強制 reflow，在 BBC 這種重型頁面會讓首次掃描卡住數秒、使用者以為 Alt+A 沒反應）。可見性已由 `getComputedStyle`／`getClientRects` 把關，`textContent` 不會誤抓隱藏文字；`linkDensity` 與 universal fallback 同步改。
- **立即回饋**：通用模式 `activate()` 先顯示「整頁雙語已開啟」toast 再跑掃描，避免重型頁面掃描期間零回應。

## [1.3.3] - 2026-09-27

### 新增 Added
- **免費翻譯自然度優化**（三層）：
  - 英文預改寫（`src/core/paraphrase.ts`）：免費引擎翻譯前，先把社群慣用 idiom 改寫成 plain English（`with zero proof`→`without any evidence`、`paycheck talking`→`business bias`、`fuck around and find out`→`try it yourself and find out`、`touch grass`→`go outside` 等）。只做英→英改寫（注入中文會破壞 Google 語言偵測）；顯示的原文與術語校正仍用未改寫的句子。
  - 人名保留：常見英文名字（matt、john、sarah…約 70 個）＋科技圈人名（Chamath、Elon、Vitalik、Balaji）不再被音譯。
  - 社群用語：`account` 在非金融上下文譯為「帳號」而非「帳戶」；補 Google zh-TW 偶發簡體詞（进行→進行，詞級修正）。

## [1.3.2] - 2026-09-27

### 修正 Fixed
- **LLM 繁簡字形修正**：Gemini／OpenAI 翻譯偶爾會漏出簡體字（prompt 寫了 Traditional Chinese 仍會發生，免費引擎無此問題）。system prompt 新增硬性字形規則：繁體目標要求「全篇繁體、絕不輸出簡體字」，簡體目標亦有對稱規則。
- LLM 快取命名空間加版本（`#prompt-v2`）：prompt 更新後，舊的快取譯文自動失效重翻，避免之前混入簡體的譯文一直被拿出來用。

## [1.3.1] - 2026-09-27

### 新增 Added
- 術語表新增社群／幣圈流行詞：`Ai`→`AI`、`@Muse` 保留原文、`gm`→`GM`、`gn`→`GN`、HODL、frens、wagmi/ngmi、DYOR、NFA、degen、ATH、FOMO、FUD、rekt、`meme coins`→`迷因幣`、`airdrop`→`空投`、`stablecoin`→`穩定幣`、`bull/bear market`→`牛市`/`熊市`、`on-chain`→`鏈上`、vibe coding 保留原文。
- 術語邊界改用 `(?<!\w)`／`(?!\w)`，讓 `@muse` 這類以非英數字開頭的詞也能正確命中。

### 修正 Fixed
- **Gemini／OpenAI 429 自動重試**：遇到限流（429）或 503 時自動重試最多 3 次（指數退避＋抖動，並尊重伺服器回傳的 Retry-After），社群頁面一次載入大量貼文時的短暫限流會自動恢復，不再直接顯示失敗。
- 限流失敗的錯誤訊息改為友善中文提示，不再顯示原始 JSON。

## [1.3.0] - 2026-09-27

### 新增 Added
- **免費翻譯術語校正**：內建 AI／科技術語表（模型、公司、專有名詞＋常見技術詞），Google／Microsoft 免費引擎翻譯完後自動校正術語（例如「開放重量機型」→「開放權重」、「知識萃取」→「知識蒸餾」、「專家混合」→「混合專家」）。雙擊查詞命中術語時直接回傳、不耗 API。第一次遇到的術語才會多一次查詢，之後都走快取。
- 術語校正只對繁體中文目標啟用；一般文章、網址、Email 不受影響。

### 變更 Changed
- Microsoft 免費引擎改用 Edge 單步免金鑰端點（`edge.microsoft.com/translate/translatetext`），舊的兩步授權流程已失效；移除 `api-edge.cognitive.microsofttranslator.com` 權限。
- Gemini 預設模型改為 `gemini-3.5-flash-lite`（高品質可選手動填 `gemini-3.8-flash`）。

### 修正 Fixed
- 免費引擎快取鍵加入術語表版本，舊的未校正譯文會自動重新翻譯校正。

## [1.2.0] - 2026-06-23

### 新增 Added
- 翻譯品質提升:新增頁面上下文感知,專有名詞與產品名翻譯更準確。
- Twitter/X 推文改為段落分組翻譯,跨行語意更連貫。

### 變更 Changed
- LLM 引擎(Gemini/OpenAI/Ollama)依場景分用散文/字幕語氣。

### 修正 Fixed
- 改善 Reddit 長篇貼文對照穩定度(修正偶發重複),網址不再被當作譯文。

### 隱私 Privacy
- 本次無新增權限、無新增資料蒐集。

## [1.1.2] - 2026-06-22

### 新增 Added
- **第二個免費引擎:Microsoft 翻譯(免 API 金鑰)**:作為 Google 免費端點的後備。當 Google 免費端點偶爾被限流(403/429)時,背景 service worker 會自動改用 Microsoft 端點再試一次,讓「永遠免費、免金鑰」更穩。設定頁與 popup 的「翻譯引擎」可直接選用,與 Google 並列、同樣免 key。
- **「翻譯任何網頁(Alt+A)」改用通用版面偵測**:不再只認 `<p>/<li>/<h*>` 等語意標籤,改以 `getComputedStyle` 判斷區塊/行內、找出真正含文字的最低區塊。現在能在以 `<div>`/`<span>` 排版的現代網站(Facebook、Mastodon/Truth Social 等)正確抓到貼文內文,而不再只是把整段倒在最底或抓錯東西。
- **內容 vs 介面雜訊的判斷**:以「地標區域(nav / aside / 側欄)＋ 連結內短文字(人名 / 導覽)＋ 連結密度」過濾,避免翻到作者名、追蹤鈕、導覽列;標題的譯文會比照原文字級顯示。

### 變更 Changed
- 預設引擎仍為 Google,使用者無感;Microsoft 僅作為自動後備或手動選用。

### 修正 Fixed
- 整頁翻譯在 React / SPA 網站(會重繪、虛擬化)上重複插入譯文區塊的問題:改用「來源節點對應 ＋ 相鄰比對 ＋ 內容指紋」的去重,並讓 MutationObserver 只重掃變動的子樹(改善長列表效能)。
- 整頁翻譯誤翻隱藏元素(`visibility:hidden`、0 尺寸的無障礙 / 佔位節點),導致頁面上方堆出一排雜訊區塊的問題。
- 關閉擴充功能時,注入的譯文未被隱藏的 CSS 問題(`data-ibt-enabled` 規則因多餘逗號而失效)。

## [1.1.1] - 2026-06-22

### 新增 Added
- **雙擊單字浮窗**:在任何網頁雙擊單字(或反白詞句),選取處會浮出小視窗 —— 原文＋🔊 朗讀、中文翻譯,單一單字還會顯示**字典卡**(詞性＋多個釋義)。沿用既有的免費 Google 引擎與快取管線;朗讀使用瀏覽器內建、免費的 `speechSynthesis`,並依偵測到的來源語言挑選語音(挑不到用預設)。視窗以 Shadow DOM 隔離,不受網頁 CSS 汙染,並會在靠近邊緣時自動翻轉、點外/Esc/捲動時關閉。
- 此功能**預設關閉、維持最小權限**:於「完整設定 → 進階」開啟,開啟時才請求「在所有網站執行」(`<all_urls>`)的選用權限並動態註冊 content script;關閉時會一併撤除該權限。可編輯欄位(輸入框、textarea、contenteditable)中的選取不會觸發。

### 修正 Fixed
- X 推文按「顯示更多」展開後,現在會偵測到原文變長並重新翻譯完整內容(先前展開後仍停留在截斷版的翻譯)。

## [1.1.0] - 2026-06-22

### 新增 Added
- **多語言來源**:自動偵測任何來源語言(韓文、日文、泰文…)並翻成中文;新增「來源語言」設定(預設 `auto`)。先前僅支援英文來源。
- **Alt+A 三段顯示循環**:原文 → 只顯示中文 → 原文+中文,純 CSS 即時切換、不需重新翻譯;popup「譯文呈現」會同步反映當前狀態。
- **「翻譯這個網頁」保留原文**:逐段插入譯文(與 X/Reddit 一致),三種顯示模式皆可純 CSS 切換。
- **X 文章(長文 Articles)**:標題與內文現在會翻譯。
- **自動跳過已是中文的內容**:X / Reddit / 整頁翻譯遇到本身已是中文(含簡體)的文字會跳過,避免中文→中文的重複對照。
- **可自訂譯文左側標記**:線條 / 粗線 / 虛線 / 隱藏,以及自訂顏色(設定頁即時預覽)。
- 句子分割改用瀏覽器內建、locale-aware 的 `Intl.Segmenter`(更適合中日韓,供 LLM 引擎使用)。

### 變更 Changed
- Reddit 貼文標題的譯文移至標題正下方(先前會跑到貼文最底部),並略為放大字級。

### 修正 Fixed
- 韓文 / 日文等回傳空白、翻不出來的問題。
- X 推文恢復逐行對照;「只顯示中文」現在會正確隱藏原文。
- Reddit 標題無限重複翻譯的迴圈。
- X 文章重複翻譯(向上層層擴散)的迴圈。
- 擴充功能更新 / 重載時的「Extension context invalidated」錯誤改為優雅處理:停止 YouTube 字幕迴圈、顯示「請重新整理此頁面」提示、不再洗錯誤訊息。

## [1.0.0] - 2026-06-21

### 新增 Added
- 首次發佈。X / Twitter、Reddit、YouTube 逐行雙語對照;一鍵整頁翻譯(`Alt+A`)。
- 預設使用免費 Google 翻譯端點(免 API 金鑰);可選 OpenAI / Gemini / 本地 Ollama。
- 繁體 / 簡體中文切換;多種譯文樣式(底線、框線、醒目、學習模式…);可調顏色與字體大小。
- 最小化權限(`activeTab` + `scripting`),金鑰與快取僅存於本機。
