# 安全說明 · Security

[繁體中文](#繁體中文) · [English](#english)

這份說明對應 **1.5.8**。資料怎麼被處理，見 [PRIVACY.md](PRIVACY.md)。1.5.8 的檢查與修了什麼，見 [docs/security-audit-1.5.8.md](docs/security-audit-1.5.8.md)。

This note matches **1.5.8**. What data is processed is in [PRIVACY.md](PRIVACY.md). What the 1.5.8 review found and changed is in [docs/security-audit-1.5.8.md](docs/security-audit-1.5.8.md).

<a id="繁體中文"></a>

## 繁體中文

雙語對照翻譯在你的瀏覽器裡執行。它沒有自己的伺服器，沒有帳號，也不收集使用統計。

### 資料

你按下翻譯、反白，或播放有字幕的影片時，那段文字會送出去翻譯。X 與 Reddit 會在打開頁面後自動對照。其他網站要按 `Alt+A` 或工具列按鈕才會送出。選用 Gemini 翻譯網頁時，頁面標題會跟著該次請求當作用詞上下文，不會被當成另一段正文。

圖片翻譯先在這台電腦認字。選了 Gemini 且認得到字時，送出的是文字，不是整張圖。只有認不到字時，才會送一張縮小後的 JPEG。

Gemini 金鑰只存在這台電腦的 `chrome.storage.local`（`ibt_gemini_key`）。它不會寫進 `chrome.storage.sync`。從較早版本升級時，若金鑰還在同步設定裡，這台電腦下次讀取會把它搬到本機，並把同步裡的那一份清掉。其他電腦要再貼一次。

金鑰只經 HTTPS 送到 `generativelanguage.googleapis.com`，放在 `x-goog-api-key` 標頭，不放進網址。檢查金鑰是否有效時，同樣只放在標頭。

單字本、翻譯快取與額度計數也在 `chrome.storage.local`。外觀、語言與引擎選項在 `chrome.storage.sync`，不含金鑰。圖片翻譯的暫存只在記憶體，關掉分頁或背景程式結束就沒了，裡面沒有金鑰。

沒有分析、沒有廣告、沒有遙測。`[IBT]` 紀錄留在這台電腦的開發者工具，不包含金鑰，也不包含整段原文。

### 權限

沒有可選權限，沒有 `externally_connectable`，沒有 `web_accessible_resources`。1.5.8 沒有新增權限。

| 權限 | 為什麼需要 |
|---|---|
| `storage` | 外觀與語言存在 `chrome.storage.sync`。金鑰、單字本、翻譯快取與額度存在 `chrome.storage.local`。 |
| `activeTab` | 點工具列或按下已綁定的 `Alt+A` 時，只對目前分頁插入譯文。 |
| `scripting` | 插入翻譯樣式與頁面腳本。 |
| `contextMenus` | 圖片上的右鍵「翻譯這張圖片」。 |
| `offscreen` | 在背景文件裡跑本機文字辨識，避免擋住網頁。 |
| `https://x.com/*`、`https://twitter.com/*` | X 的貼文與影片字幕。 |
| `https://www.reddit.com/*` | Reddit 貼文。 |
| `https://www.youtube.com/*` | YouTube 字幕。 |
| `https://www.netflix.com/*`、`https://netflix.com/*` | Netflix 觀看頁字幕。 |
| `https://translate.googleapis.com/*` | 預設的免費 Google 翻譯。 |
| `https://edge.microsoft.com/*` | Google 這一次失敗時的免費備援。 |
| `https://generativelanguage.googleapis.com/*` | 你貼了自己的 Gemini 金鑰並選用它時。 |
| `https://cdn.jsdelivr.net/*` | 第一次英文認字時下載一份語言資料。 |
| 內容腳本 `http://*/*`、`https://*/*` | 讓 `Alt+A`、反白與右鍵圖片翻譯在任意網頁可用。不會因此把每個網頁的全文自動送出。 |

### 對外主機

所有由擴充套件主動發出的翻譯連線都是 HTTPS。

| 主機 | 送出什麼 |
|---|---|
| `translate.googleapis.com` | 你要求翻譯的文字。路徑是 `/translate_a/single` 與 `/translate_a/t`。 |
| `edge.microsoft.com` | 同一段文字，而且只在這次 Google 失敗、引擎本來就是 Google 時。選了 Gemini 卻失敗時，不會改走這裡。 |
| `generativelanguage.googleapis.com` | 金鑰（僅標頭），以及網頁、字幕或圖片辨出的文字。認不到字、需要看圖像素時，另加一張 JPEG。 |
| `cdn.jsdelivr.net` | 不下載你的網頁。只下載 `eng.traineddata.gz`，核對 SHA-256 後存在本機。那是資料檔。 |
| 圖片自己的網址 | 背景程式可能向那張圖的網址要位元組，以便在本機認字。不在上面清單裡的網站會失敗，改由頁面把圖畫出來。位元組留在本機。這不是分析。 |

YouTube 與 X 的字幕是從網頁自己已經發出的請求裡讀取，不會另外向影片伺服器要一份。

### 程式從哪裡來

內容腳本、背景程式與 Tesseract 的 JavaScript、wasm 都打包在擴充套件裡。內容安全政策是 `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`。`wasm-unsafe-eval` 只給這個已打包的認字 wasm。原始碼沒有 `eval` 或 `new Function`，也沒有從網路上載入並執行腳本。

### 誰可以傳訊息

`chrome.runtime.onMessage` 只接受 `sender.id` 等於這個擴充套件的訊息。背景頁、內容腳本與 offscreen 文件都做這個檢查。網頁不能從外面呼叫擴充套件。YouTube、X 與 Alt+A 在頁面裡用的 `postMessage` 會檢查來源與訊息形狀。

### 自動檢查

儲存庫有 CodeQL 工作流程（`javascript-typescript`），在推上 `main`、對 `main` 開拉取請求，以及每週排程時執行。Dependabot 每週檢查 npm 與 GitHub Actions。這兩份設定在 1.5.8 加入。預設分支在這份文件寫成時還沒有跑過 CodeQL，所以 README 不放狀態徽章。

`npm audit` 在 1.5.8 時有一則 esbuild 的中度問題，只影響開發用的伺服器，不在安裝包裡。修法是主要版本升級，因此沒有在這一版強制升級。

### 回報漏洞

請用 [GitHub Security Advisories](https://github.com/ekkoee/thelimitsofmylanguagemeanthelimitsofmyworld/security/advisories/new) 私下回報。不適合公開細節時，不要開一般 issue。若只是使用問題，可以用 [Issues](https://github.com/ekkoee/thelimitsofmylanguagemeanthelimitsofmyworld/issues)。

<a id="english"></a>

## English

Bilingual Translate runs in your browser. It has no server of its own, no account, and it does not collect usage statistics.

### Data

Text is sent for translation when you translate a page, select text, or play a video that has captions. X and Reddit start when you open the page. Other sites send text only after `Alt+A` or the toolbar button. When a page is translated with Gemini, the page title may ride along as wording context. It is not translated as its own passage.

Image translation recognizes text on this computer first. With Gemini selected and recognition succeeding, the text is sent, not the picture. A downscaled JPEG is sent only when recognition finds no text.

The Gemini key is stored only on this computer, in `chrome.storage.local` (`ibt_gemini_key`). It is not written to `chrome.storage.sync`. On upgrade, a key still sitting in synced settings is copied to local storage the next time settings are read, and the synced copy is cleared. Other computers need the key pasted again.

The key is sent only to `generativelanguage.googleapis.com`, over HTTPS, in the `x-goog-api-key` header. It is not placed in the URL. The key check uses that same header.

The word list, translation cache, and quota counter are also in `chrome.storage.local`. Appearance, language, and engine choice are in `chrome.storage.sync`, without the key. Image-translation scratch lives in memory until the tab or the background worker closes, and it does not hold the key.

There is no analytics, no advertising, and no telemetry. `[IBT]` logs stay in the developer tools on this computer. They do not include the key or the full source text.

### Permissions

There is no optional permission, no `externally_connectable`, and no `web_accessible_resources`. Version 1.5.8 adds none.

| Permission | Why it is needed |
|---|---|
| `storage` | Appearance and language in `chrome.storage.sync`. The key, word list, translation cache, and quota state in `chrome.storage.local`. |
| `activeTab` | A toolbar click, or a bound `Alt+A`, injects the translation into the current tab only. |
| `scripting` | Inserts the translation stylesheet and page scripts. |
| `contextMenus` | The “Translate this image” item. |
| `offscreen` | Runs local text recognition in a background document so the page stays responsive. |
| `https://x.com/*`, `https://twitter.com/*` | Posts and video captions on X. |
| `https://www.reddit.com/*` | Reddit posts. |
| `https://www.youtube.com/*` | YouTube captions. |
| `https://www.netflix.com/*`, `https://netflix.com/*` | Captions on a Netflix watch page. |
| `https://translate.googleapis.com/*` | The default free Google engine. |
| `https://edge.microsoft.com/*` | Free fallback when that Google request fails. |
| `https://generativelanguage.googleapis.com/*` | Used when you paste your own Gemini key and choose Gemini. |
| `https://cdn.jsdelivr.net/*` | Downloads one English recognition-data file on first OCR. |
| Content scripts on `http://*/*` and `https://*/*` | Makes `Alt+A`, selection translation, and image translation available on any page. It does not automatically upload the full text of every page. |

### External hosts

Translation requests the extension opens itself use HTTPS.

| Host | What is sent |
|---|---|
| `translate.googleapis.com` | Text you asked to translate, via `/translate_a/single` and `/translate_a/t`. |
| `edge.microsoft.com` | The same text, and only when that Google request fails while Google was already the engine. A Gemini failure does not switch here. |
| `generativelanguage.googleapis.com` | The key (header only) and page, caption, or recognized image text. A JPEG is added only when recognition finds nothing and the vision path runs. |
| `cdn.jsdelivr.net` | No page content. One download of `eng.traineddata.gz`, checked with SHA-256 and stored locally. It is a data file. |
| The image’s own URL | The background worker may request that URL so recognition can run locally. Hosts outside the list above fail, and the page draws the image instead. The bytes stay on this computer. This is not analytics. |

YouTube and X captions are read from requests the page already made. The extension does not ask the video host for a second copy.

### Where the code comes from

Content scripts, the background worker, and Tesseract’s JavaScript and wasm are packaged with the extension. The content security policy is `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`. `wasm-unsafe-eval` is there for that bundled recognition wasm. The source does not call `eval` or `new Function`, and it does not load and run a script from the network.

### Who can send a message

`chrome.runtime.onMessage` accepts a message only when `sender.id` is this extension. The background worker, content scripts, and the offscreen document all check that. A web page cannot call the extension from outside. `postMessage` used inside the YouTube, X, and Alt+A page scripts checks the source and the message shape.

### Automated checks

The repository includes a CodeQL workflow (`javascript-typescript`) that runs on pushes to `main`, on pull requests into `main`, and on a weekly schedule. Dependabot checks npm and GitHub Actions weekly. Both were added in 1.5.8. When this note was written, the default branch had not yet run CodeQL, so the README does not carry a status badge.

At 1.5.8, `npm audit` reported one moderate esbuild issue. It affects the development server only and is not in the install package. The fix is a major-version upgrade, so this version does not force it.

### Reporting a vulnerability

Please report privately through [GitHub Security Advisories](https://github.com/ekkoee/thelimitsofmylanguagemeanthelimitsofmyworld/security/advisories/new). Do not open a public issue for details that should stay private. For ordinary use questions, [Issues](https://github.com/ekkoee/thelimitsofmylanguagemeanthelimitsofmyworld/issues) is fine.
