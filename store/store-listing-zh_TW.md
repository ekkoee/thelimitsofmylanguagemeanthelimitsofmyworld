# Chrome 線上應用程式商店文案（繁體中文）

名稱（23 字，上限 75）：

雙語對照翻譯 — 網頁與 YouTube 字幕

## 簡短說明

86 字，上限 132。與 `public/_locales/zh_TW/messages.json` 的 `extDescription` 相同。

免費網頁雙語對照：原文一行、譯文一行。支援任何網頁（Alt+A）、X、Reddit、YouTube 與 Netflix 字幕。預設免費引擎、免 API 金鑰，繁簡中文皆可。

## 詳細說明

把正在讀的外文排成原文一行、譯文一行。

X 與 Reddit 開啟後即逐行、逐句對照。LinkedIn 與其他網站按 Alt+A，或點工具列的「翻譯這個網頁」。已翻過的頁面再按一次，會在「原文加譯文」「只顯示譯文」「只顯示原文」之間切換。

YouTube、Netflix 觀看頁，以及 X 推文裡的影片，可顯示雙語字幕，並可選擇譯文在上或原文在上。燒在畫面裡、沒有文字軌的字幕無法翻譯。

反白一段文字可看譯文。單字附簡短字義與那一句的譯文，可複製、朗讀原文。星星把單字存在這台電腦；設定頁可搜尋、刪除，並匯出 CSV 或 TXT。

在圖片上按右鍵即可翻譯。預設在本機辨識文字再翻譯，不限次數。若貼上自己的 Gemini 金鑰，也可改由 Gemini 看圖。

翻譯成：繁體中文、简体中文、English、日本語、한국어、Español、Français、Deutsch。已經是目標語言的句子會略過。介面可跟隨瀏覽器，或改成上述八種語言。外觀可調譯文樣式、顏色、左側標記、淡底色與字級。

預設使用免費的 Google 翻譯，不必申請金鑰。Google 失敗時，同一段自動改問 Microsoft，仍免金鑰。

## 單一用途

在網頁與影片字幕旁顯示譯文，讓原文與譯文可以逐行對照。

## 權限說明（商店表單）

storage：設定與選用的 Gemini 金鑰存在 chrome.storage.sync；單字本、翻譯快取與額度狀態存在 chrome.storage.local。

activeTab：使用者點工具列圖示，或按下已綁定的 Alt+A 時，只對目前分頁插入譯文。

scripting：插入翻譯樣式與頁面腳本（整頁翻譯與圖片翻譯）。

contextMenus：在圖片上提供「翻譯這張圖片」。

offscreen：在背景文件中執行本機文字辨識（Tesseract），避免佔用網頁執行緒。

主機權限 https://x.com/* 與 https://twitter.com/*：讀取 X 的貼文與影片字幕以便對照。

主機權限 https://www.reddit.com/*：讀取 Reddit 貼文以便對照。

主機權限 https://www.youtube.com/*：讀取 YouTube 字幕以便對照。

主機權限 https://www.netflix.com/* 與 https://netflix.com/*：讀取 Netflix 觀看頁字幕以便對照。

主機權限 https://translate.googleapis.com/*：把要翻譯的文字送到免費的 Google 翻譯接口。

主機權限 https://edge.microsoft.com/*：Google 失敗時，把同一段文字送到免費的 Microsoft 接口。

主機權限 https://generativelanguage.googleapis.com/*：僅在使用者貼上自己的 Gemini 金鑰並選用該引擎（或看圖模式）時，傳送文字或圖片。

主機權限 https://cdn.jsdelivr.net/*：第一次使用本機英文辨識時，下載語言資料檔並核對 SHA-256。該檔不是程式碼。

所有 http 與 https 網站的內容腳本：讓 Alt+A、反白翻譯與右鍵圖片翻譯能在使用者正在看的任意網頁上運作。不會因此自動把每個網頁的全文送出。

以上權限皆有對應程式路徑，此版本不移除任何一項。

## 隱私權做法（商店表單）

本擴充套件沒有分析、沒有廣告，也不把瀏覽紀錄另存後送出。

會離開瀏覽器的資料：

- 使用者觸發翻譯時的網頁文字、反白文字、字幕文字，以及本機辨識後的文字，預設送到 translate.googleapis.com。
- 若 Google 請求失敗，同一段文字改送到 edge.microsoft.com。
- 使用者自行貼上 Gemini 金鑰並選用 Gemini 時，翻譯文字會送到 generativelanguage.googleapis.com。網頁內文翻譯時，頁面標題可一併作為用語上下文。只有選了 Gemini 看圖，圖片像素才會送出。金鑰存在 chrome.storage.sync，只傳給該 API。
- 第一次本機英文辨識會向 cdn.jsdelivr.net 下載語言資料檔（非可執行碼），核對後存入 IndexedDB。辨識本身在本機完成。

留在瀏覽器的資料：

- 單字本（chrome.storage.local 的 ibt_vocab）只存在這台電腦，匯出 CSV／TXT 由使用者自行儲存。
- 翻譯快取存在 chrome.storage.local。
- 其餘設定存在 chrome.storage.sync。若使用者開啟 Chrome 同步，設定與金鑰會跟著 Google 帳號到其他裝置。

不蒐集的項目：健康資訊、財務與付款資訊、通訊內容、精確地理位置、使用者活動紀錄，以及獨立的網頁瀏覽歷史。
