# 雙語對照翻譯 1.5.8 安全與隱私檢查

檢查對象是 1.5.8。這次沒有改翻譯邏輯、速度、字幕、圖片分組或淡底色，也沒有把 Gemini 失敗自動改走 Google。說明見 [SECURITY.md](../SECURITY.md) 與 [PRIVACY.md](../PRIVACY.md)。

## 結論

擴充套件沒有自己的伺服器，也沒有分析或遙測。會離開這台電腦的，只有你要求翻譯的文字、你自己的 Gemini 金鑰，以及第一次英文認字時的一份語言資料。1.5.8 把金鑰從 Chrome 同步改到這台電腦，金鑰不再出現在網址裡，紀錄也不再印出金鑰或整段原文。

## 發現與處理

| 嚴重度 | 發現 | 處理 |
|---|---|---|
| 高 | Gemini 金鑰放在 `chrome.storage.sync` 的 `ibt_settings.apiKeys.gemini`。開啟 Chrome 同步時，金鑰會跟著 Google 帳號到其他裝置。 | 已改。金鑰只寫 `chrome.storage.local` 的 `ibt_gemini_key`。同步設定裡的金鑰一律清成空字串。這台電腦若還留著舊金鑰，下次讀取設定時搬到本機再清掉同步複本。其他電腦不會自動得到這把金鑰。 |
| 高 | 網頁翻譯把金鑰放在 `generativelanguage.googleapis.com` 的網址查詢參數。網址比標頭更容易進到紀錄與中介記錄。 | 已改。與看圖、金鑰檢查相同，改放 `x-goog-api-key` 標頭。請求本文、模型與重試沒有改。 |
| 中 | `src/content/yt-main.ts` 用 `textarea.innerHTML` 解 YouTube 字幕裡的 HTML 實體。字幕若含 `</textarea>` 後面的標籤，有機會被當成 HTML。 | 已改。先把 `<` 跳脫，再用 `DOMParser` 解實體，不執行標籤。字幕文字結果不變。 |
| 中 | `chrome.runtime.onMessage` 沒有檢查發送者。清單沒有 `externally_connectable`，一般網頁本來就不能對擴充套件發訊息。 | 已加上 `sender.id === chrome.runtime.id`。背景、內容腳本與 offscreen 都只收自己的擴充套件。頁面裡的 `window.postMessage`（YouTube、X、Alt+A）本來就檢查來源，沒有改那條路。 |
| 中 | 內容腳本比對 `http://*/*` 與 `https://*/*`，而且 `all_frames: true`。Chrome 線上應用程式商店會顯示可讀取並更改所有網站的資料。 | 保留。這是 Alt+A、反白翻譯與右鍵圖片翻譯在任意網頁可用的條件。它不是 `host_permissions` 的 `<all_urls>`，也不會因此把每個網頁的全文自動送出。X、Reddit 才會在打開後自動對照。 |
| 低 | `[IBT]` 紀錄會印出完整網址（含查詢字串）、原文前 60 或 80 字、圖片 base64 前綴，以及最長 500 字的錯誤本文。錯誤本文有機會帶回金鑰或請求片段。 | 已收斂。網址只留主機名，原文改記長度，不再印圖片簽章。錯誤先遮掉 `key=`、`AIza…`、`AQ.…` 與 `x-goog-api-key`，再截到約 180 字。計時與句數仍保留。 |
| 低 | 翻譯快取 `ibt_tc_*` 沒有筆數上限，只在超出瀏覽器配額時放棄寫入。圖片翻譯快取在記憶體，內容是該張圖的原文與譯文。 | 未改快取策略，避免影響速度。兩者都不含金鑰。圖片快取在關掉分頁或背景程式結束後消失。 |
| 低 | 第一次英文認字會向 `cdn.jsdelivr.net` 下載 `eng.traineddata.gz`。 | 保留。下載的是資料檔，寫入前核對 SHA-256，存在 IndexedDB。Tesseract 的 js 與 wasm 已打包在 `dist/ocr/`，不是遠端程式。 |
| 資訊 | `src/providers/openai.ts` 與 `ollama.ts` 仍在原始碼裡。設定頁不能選它們，清單也沒有 `api.openai.com` 或本機 Ollama 的網址。 | 未刪、未加權限。目前的介面走不到這兩條。 |
| 資訊 | 設定頁刪除鈕用 `innerHTML` 塞一段固定的 SVG。 | 未改。那不是譯文，也不是網頁內容。譯文與頁面文字走 `textContent`。 |
| 資訊 | 清單沒有 `incognito`。Chrome 預設 spanning：允許無痕後，與一般視窗共用同一份儲存。 | 未改行為。已寫進 PRIVACY.md。 |
| 資訊 | `npm audit` 有一則 esbuild `<=0.24.2`（中度，GHSA-67mh-4wv8-2f99）。問題在開發用的 esbuild 伺服器，不在擴充套件包裡。唯一修法是升到 0.28，屬於主要版本。 | 未強制升級。 |

沒有 `eval`、`new Function`、`sendBeacon`，也沒有分析網址。

## 權限

沒有可選權限，沒有 `externally_connectable`，沒有 `web_accessible_resources`。這次沒有新增任何權限。

| 權限 | 誰在用 | 是否必要 |
|---|---|---|
| `storage` | 設定（sync）、金鑰、單字本、翻譯快取、額度（local） | 必要 |
| `activeTab` | 工具列與 `Alt+A` 只對目前分頁插入譯文 | 必要 |
| `scripting` | 插入 `bilingual.css`、`universal-inject.js`、`image-inject.js` | 必要 |
| `contextMenus` | 右鍵「翻譯這張圖片」 | 必要 |
| `offscreen` | 本機認字的 worker 文件 | 必要 |
| `https://x.com/*`、`https://twitter.com/*` | X 的貼文與字幕腳本 | 必要 |
| `https://www.reddit.com/*` | Reddit 貼文 | 必要 |
| `https://www.youtube.com/*` | YouTube 字幕與頁面攔截腳本 | 必要 |
| `https://www.netflix.com/*`、`https://netflix.com/*` | Netflix 觀看頁字幕 | 必要 |
| `https://translate.googleapis.com/*` | 免費 Google：`/translate_a/single` 與 `/translate_a/t` | 必要 |
| `https://edge.microsoft.com/*` | Google 失敗時的 Microsoft 備援 | 必要 |
| `https://generativelanguage.googleapis.com/*` | Gemini 文字、看圖備援、金鑰檢查 | 必要 |
| `https://cdn.jsdelivr.net/*` | 一次英文認字資料，有 SHA-256 | 必要 |
| 內容腳本 `http://*/*`、`https://*/*` | `alt-a-global.js`（隔離世界）與 `alt-a-page.js`（MAIN），皆 `all_frames` | 必要，範圍寬。見上方「中」 |

內容安全政策是 `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`。`wasm-unsafe-eval` 只給已打包的 Tesseract wasm，不是遠端程式。

## 對外主機

| 主機 | 送出什麼 | 不送什麼 |
|---|---|---|
| `translate.googleapis.com` | 你要求翻譯的網頁、反白、字幕文字 | 金鑰、圖片 |
| `edge.microsoft.com` | 同一段文字，且只在這次 Google 失敗、引擎本來就是 Google 時 | 金鑰。Gemini 失敗不會走到這裡 |
| `generativelanguage.googleapis.com` | 金鑰（僅 HTTPS 標頭）。網頁或字幕文字；選了 Gemini 看圖時是辨出的段落。認不到字才送縮小後的 JPEG。檢查金鑰時只送金鑰 | 不會把金鑰放進網址 |
| `cdn.jsdelivr.net` | 無。只下載認字資料 | 網頁文字、金鑰 |
| 圖片自己的網址 | 背景程式可能向那張圖的網址要位元組，以便本機認字。不在允許清單裡的網站會失敗，改由頁面畫出來 | 不是分析。位元組留在本機 |

YouTube 與 X 會攔截網頁自己已經發出的字幕請求（`fetch` / `XMLHttpRequest`），再交給隔離世界。這不是新的對外連線。

`scripts/` 裡的測試會連 Google、Microsoft 或本機 Chrome。那些檔案不在安裝 zip 裡。

## 秘密與快取

- 金鑰：`chrome.storage.local` / `ibt_gemini_key`。同步的 `ibt_settings` 寫入時 `apiKeys.gemini` 固定是空字串。
- 金鑰只經 HTTPS 送到 `generativelanguage.googleapis.com` 的標頭。
- 單字本 `ibt_vocab`、翻譯快取 `ibt_tc_`、額度 `ibt_quota` 都在 `chrome.storage.local`。單字本含你按下儲存時的頁面網址，那是你主動存的。
- 記憶體裡的圖片快取與 `blockCache` 含該張圖的原文與譯文，不含金鑰，沒有寫進磁碟。
- 無痕視窗在你允許之後與一般視窗共用這份儲存（spanning）。

## 依賴

`npm audit`：1 則中度，esbuild `<=0.24.2`，只影響開發伺服器。`npm audit fix` 在不使用 `--force` 時沒有可套用的非破壞性更新。未升級。

已加入：

- `.github/workflows/codeql.yml`：`javascript-typescript`，在推送、拉取請求與每週排程執行。
- `.github/dependabot.yml`：npm 與 GitHub Actions，每週。

## 測試

`tsc --noEmit` 通過。金鑰、Gemini 請求形狀、圖片、X 字幕、Netflix 字幕，以及其他既有的單元測試通過。`scripts/page-translate-test.mjs` 的「chinese unit is skipped on linkedin」在改動之前就失敗，這次沒有改判斷原文是否略過的邏輯，所以沒有動它。

沒有在瀏覽器裡重走設定頁。這次沒有改版面。金鑰的讀寫與標頭是程式與單元測試核對的。
