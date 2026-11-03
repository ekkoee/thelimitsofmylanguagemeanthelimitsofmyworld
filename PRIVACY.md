# 隱私說明 · Privacy

[繁體中文](#繁體中文) · [English](#english)

<a id="繁體中文"></a>

## 繁體中文

雙語對照翻譯（Bilingual Translate）在你的瀏覽器裡運作。它沒有自己的伺服器，沒有帳號，也不做分析或遙測。下面寫的是程式實際會碰到的資料，以及那些資料會送到哪裡。

### 會處理哪些資料

- **你要求翻譯的文字。** 包含網頁上的句子、你反白的文字、YouTube、Netflix 與 X 的字幕。X 與 Reddit 會在你打開頁面後自動對照；其他網站要按 `Alt+A` 或工具列的「翻譯這個網頁」才會送出。
- **頁面標題。** 只有在你選用 Gemini 翻譯網頁時，標題會跟著該次請求當作用詞上下文。它不會被當成另一段要翻譯的正文。
- **圖片。** 右鍵「翻譯這張圖片」時，圖片位元組留在這台電腦上做文字辨識。選用 Gemini 且辨識有結果時，送出的是辨出的文字，不是整張圖。只有辨識不到文字時，才會把一張縮小後的 JPEG 送到 Gemini。
- **你存進單字本的項目。** 單字、譯文、你看到的那一句，以及你按下儲存時的頁面標題與網址。這是你主動儲存的，只放在這台電腦。
- **Gemini API 金鑰。** 只有你貼上時才會有。它存在這台電腦，用來呼叫 Gemini。

擴充套件不會讀取你的密碼、Cookie，也不會把瀏覽紀錄另存一份送出去。

### 資料會送到哪裡

所有對外連線都是 HTTPS。

| 服務 | 什麼時候 | 送出什麼 |
|---|---|---|
| `translate.googleapis.com` | 預設的免費 Google 翻譯 | 你要求翻譯的文字 |
| `edge.microsoft.com` | 只有 Google 那一次失敗時 | 同一段文字 |
| `generativelanguage.googleapis.com` | 你貼了自己的金鑰，並選用 Gemini | 文字（網頁、字幕，或圖片辨出的段落）與金鑰。看圖失敗、需要改看像素時，另加一張 JPEG |
| `cdn.jsdelivr.net` | 第一次做英文圖片辨識 | 不下載網頁內容。只下載一份英文辨識資料，核對 SHA-256 後存在本機。那是資料檔，不是程式 |

沒有分析、沒有廣告、沒有其他遙測網址。翻譯結果不會再轉送到別處。

選用 Gemini 時，金鑰放在 `x-goog-api-key` 標頭，不放進網址。檢查金鑰是否有效時，只對 Gemini 的模型列表發一次 GET，同樣只放在標頭。

Google 失敗才改問 Microsoft。這條路徑只發生在本來就用免費 Google 的時候。選了 Gemini 卻失敗時，不會自動改走 Google。

圖片位在其他網站時，背景程式可能會向那張圖自己的網址要一次位元組，以便在本機辨識。那個網址不是我們的伺服器。若該網站不在擴充套件被允許連線的範圍內，這次請求會失敗，改由頁面自己把圖畫出來，位元組仍然留在本機。

YouTube 與 X 的字幕是從網頁自己已經發出的請求裡讀取，不會另外向影片伺服器要一份。

### 存在哪裡

| 項目 | 位置 | 內容 |
|---|---|---|
| Gemini 金鑰 | `chrome.storage.local`（鍵名 `ibt_gemini_key`） | 只有金鑰。不進 Chrome 同步 |
| 外觀、語言、引擎等設定 | `chrome.storage.sync`（鍵名 `ibt_settings`） | 不含金鑰。開啟 Chrome 同步時會跟著 Google 帳號到其他裝置 |
| 單字本 | `chrome.storage.local`（`ibt_vocab`） | 你儲存的單字與當時的頁面網址 |
| 翻譯快取 | `chrome.storage.local`（前綴 `ibt_tc_`） | 譯過的句子，不含金鑰。寫入超過瀏覽器配額時會放棄，不外傳 |
| 額度狀態 | `chrome.storage.local`（`ibt_quota`） | Gemini 額度的本機計數，不含金鑰原文 |
| 英文辨識資料 | IndexedDB（`ibt-ocr/eng.traineddata`） | 語言資料檔 |
| 圖片翻譯暫存 | 分頁與背景程式的記憶體 | 這張圖的原文與譯文。關掉分頁或背景程式結束就沒了。不含金鑰 |

從 1.5.7 或更早升級時，若金鑰還在同步設定裡，這台電腦下次讀取設定會把它搬進 `chrome.storage.local`，並把同步裡的那一份清掉。其他電腦不會自動拿到這把金鑰，需要再貼一次。

### 無痕視窗

清單沒有指定 `incognito`，Chrome 使用預設的 spanning：擴充套件在一般視窗與無痕視窗共用同一份儲存。只有你在 `chrome://extensions` 允許它在無痕模式執行時，無痕視窗才會載入它。允許之後，無痕視窗裡的翻譯會使用同一把金鑰與同一份快取。

### 紀錄

偵錯用的 `[IBT]` 紀錄寫在這台電腦的開發者工具，不上傳。紀錄不包含金鑰，也不包含整段網頁或字幕原文。Netflix 與 X 的額外字幕紀錄預設關閉，只有你在該站把 `ibt-nf-debug` 或 `ibt-x-debug` 設為 `1` 時才會出現。

### 權限

權限清單與每一項的用途寫在 [README](README.md) 的「權限」一節。內容腳本比對 `http://*/*` 與 `https://*/*`，是為了讓 `Alt+A`、反白翻譯與右鍵圖片翻譯在任意網頁可用。這不會把每個網頁的全文自動送出。

沒有 `externally_connectable`，沒有 `web_accessible_resources`，也沒有可選權限。網頁無法呼叫擴充套件的訊息接口。

<a id="english"></a>

## English

Bilingual Translate runs in your browser. It has no server of its own, no account, and no analytics or telemetry. This note describes the data the program actually handles and where that data goes.

### What is processed

- **Text you ask to translate.** Page sentences, a selection, and captions from YouTube, Netflix, and X. X and Reddit start when you open the page. Other sites send text only after `Alt+A` or “Translate this page” in the toolbar.
- **The page title.** Only when you translate a page with Gemini, the title rides along as wording context. It is not translated as its own passage.
- **Images.** “Translate this image” keeps the image bytes on this computer for recognition. With Gemini selected and recognition succeeding, the recognized text is sent, not the picture. A downscaled JPEG is sent to Gemini only when recognition finds no text.
- **Words you save.** The word, its translation, the sentence you were reading, and the page title and URL at the moment you save. That stays on this computer.
- **Your Gemini API key.** Present only if you paste one. It stays on this computer and is used to call Gemini.

The extension does not read passwords or cookies, and it does not ship a separate copy of your browsing history.

### Where data is sent

Every outbound connection uses HTTPS.

| Service | When | What is sent |
|---|---|---|
| `translate.googleapis.com` | The default free Google engine | The text you asked to translate |
| `edge.microsoft.com` | Only when that Google request fails | The same text |
| `generativelanguage.googleapis.com` | You pasted your own key and chose Gemini | The text (page, captions, or lines recognized in an image) and the key. A JPEG is added only when image recognition finds nothing and the vision path runs |
| `cdn.jsdelivr.net` | The first English image recognition | No page content. One English recognition-data file, checked with SHA-256 and stored locally. It is data, not code |

There is no analytics, no advertising, and no other telemetry host. Translations are not forwarded anywhere else.

With Gemini, the key travels in the `x-goog-api-key` header, not in the URL. Checking whether a key works is one GET to Gemini’s model list, also header-only.

Microsoft is used only after Google fails, and only when the free Google engine was already selected. A Gemini failure does not switch to Google.

If an image lives on another site, the background worker may request that image’s own URL so recognition can run locally. That URL is not our server. If the site is outside the hosts the extension is allowed to contact, the request fails and the page draws the image instead. The bytes stay on this computer.

YouTube and X captions are read from requests the page already made. The extension does not ask the video host for a second copy.

### Where it is stored

| Item | Where | Contents |
|---|---|---|
| Gemini key | `chrome.storage.local` (key `ibt_gemini_key`) | The key only. Not included in Chrome Sync |
| Appearance, language, engine, and other settings | `chrome.storage.sync` (key `ibt_settings`) | No API key. With Chrome Sync on, these follow your Google account to other devices |
| Word list | `chrome.storage.local` (`ibt_vocab`) | Words you saved, including the page URL at save time |
| Translation cache | `chrome.storage.local` (prefix `ibt_tc_`) | Translated sentences, not the key. A write that exceeds the browser quota is dropped and is not sent anywhere |
| Quota state | `chrome.storage.local` (`ibt_quota`) | A local count of Gemini quota. Not the key itself |
| English recognition data | IndexedDB (`ibt-ocr/eng.traineddata`) | The language-data file |
| Image-translation scratch | Memory in the tab and the background worker | Source and translation for that image. Gone when the tab or the worker closes. No key |

On upgrade from 1.5.7 or earlier, a key that was still in synced settings is copied into `chrome.storage.local` on this computer the next time settings are read, and the synced copy is cleared. Other computers do not receive that key. Paste it again there.

### Incognito

The manifest does not set `incognito`, so Chrome uses the default spanning mode: the extension shares one storage area between normal and incognito windows. An incognito window loads it only after you allow that at `chrome://extensions`. Once allowed, incognito translation uses the same key and the same cache.

### Logs

`[IBT]` diagnostics stay in the developer tools on this computer. They are not uploaded. They do not include the key or the full text of a page or caption. Extra Netflix and X caption logs stay off unless you set `ibt-nf-debug` or `ibt-x-debug` to `1` on that site.

### Permissions

The permission list and the reason for each item are in the Permissions section of the [README](README.md). Content scripts match `http://*/*` and `https://*/*` so that `Alt+A`, selection translation, and image translation work on any page. That match does not upload the full text of every page.

There is no `externally_connectable`, no `web_accessible_resources`, and no optional permission. A web page cannot call the extension’s message channel.
