<div align="center">

<img src="public/icons/icon128.png" width="96" alt="雙語對照翻譯 icon">

# 雙語對照翻譯 · Bilingual Translate

**原文一行、譯文一行，讀外文像讀母語一樣自然。**<br>
Line-by-line bilingual reading for the web and video captions.

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-安裝%20%2F%20Install-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/hhhlkbfhcnbonndnnooanhdopbepjban)
[![Release](https://img.shields.io/github/v/release/ekkoee/thelimitsofmylanguagemeanthelimitsofmyworld?label=release)](https://github.com/ekkoee/thelimitsofmylanguagemeanthelimitsofmyworld/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

[繁體中文](#zh-hant) · [English](#english)

</div>

<a id="zh-hant"></a>

## 簡介

把正在讀的外文，排成原文一行、譯文一行。網頁、YouTube、Netflix 與 X 的影片字幕都能對照。預設走免費的 Google 翻譯，不必申請 API 金鑰。

適合每天在 X、Reddit、LinkedIn 追外文資訊、看 YouTube 和 Netflix 學語言的人：不用切換分頁、不用複製貼上，原文和譯文就排在一起，讀得快，也看得懂原句怎麼說。

👉 **[從 Chrome 線上應用程式商店安裝](https://chromewebstore.google.com/detail/hhhlkbfhcnbonndnnooanhdopbepjban)**

## 主要功能

- **網頁雙語。** X 與 Reddit 開啟後即逐行、逐句對照。LinkedIn 與其他網站按 `Alt+A`，或點工具列的「翻譯這個網頁」。
- **三種呈現。** 原文加譯文、只顯示譯文、只顯示原文。
- **影片字幕。** YouTube、Netflix 觀看頁，以及 X 推文裡的影片，可顯示雙語字幕。可選譯文在上或原文在上。燒在畫面裡、沒有文字軌的字幕無法翻譯。
- **反白翻譯。** 選取一段文字可看譯文。單字附簡短字義，以及那一句的譯文。可複製、朗讀原文、拖曳。按 Esc 或點到別處即關閉。
- **單字本。** 星星把單字存在這台電腦。設定頁可搜尋、排序、刪除，並匯出 CSV 或 TXT。
- **圖片翻譯。** 在圖片上按右鍵。預設在本機辨識文字再翻譯；也可改用自己的 Gemini 金鑰看圖。
- **引擎。** 預設免費 Google。Google 失敗時，同一段自動改問 Microsoft，仍免金鑰。想換模型時，貼上自己的 Gemini 金鑰即可。
- **翻譯成**繁體中文、简体中文、English、日本語、한국어、Español、Français、Deutsch。已經是目標語言的句子會略過。
- **介面語言八種**，或跟隨瀏覽器：繁體中文、简体中文、English、日本語、한국어、Deutsch、Français、Español。
- **外觀。** 譯文樣式、譯文顏色、左側標記、淡底色與字級。設定頁有即時預覽。翻成繁體時，免費引擎會把常見科技用語改成較通行的說法。

## 安裝

### Chrome 線上應用程式商店（推薦）

前往 [雙語對照翻譯 — Chrome 線上應用程式商店](https://chromewebstore.google.com/detail/hhhlkbfhcnbonndnnooanhdopbepjban)，點「加到 Chrome」即可，之後會自動更新。

### 載入未封裝項目

1. 到 [Releases](https://github.com/ekkoee/thelimitsofmylanguagemeanthelimitsofmyworld/releases) 下載 zip，解壓縮。資料夾裡要有 `manifest.json`，請把整個資料夾留在原處。
2. 開啟 `chrome://extensions`，打開右上角的「開發人員模式」。
3. 點「載入未封裝項目」，選剛剛解壓的資料夾。

從原始碼建置時，載入的是下面產生的 `dist/`。

Chrome 有時會在啟動時詢問是否停用開發人員模式擴充功能。手動安裝時按「保留」即可。

## 使用與快捷鍵

| 你想做的事 | 怎麼做 |
|---|---|
| 翻譯目前網頁，或在三種呈現之間切換 | `Alt+A`，或點工具列圖示裡的「翻譯這個網頁」 |
| 改目標語言或呈現方式 | 點工具列圖示 |
| 引擎、外觀、單字本、介面語言 | 點「設定」 |
| 翻譯圖片 | 在圖片上按右鍵 |
| 關掉反白卡片 | Esc，或點頁面其他地方 |

清單裡唯一向 Chrome 登記的快速鍵是 `Alt+A`（命令名稱 `toggle-page-translation`）。載入未封裝項目時，Chrome 有時不會自動綁上。若按了沒反應，到 `chrome://extensions/shortcuts` 自行指定。Esc 只關掉畫面上的反白卡片，不是 Chrome 快速鍵。

X、Reddit、YouTube 會自動處理頁面或字幕。Netflix 只在觀看頁自動顯示字幕；瀏覽頁和其他網站用 `Alt+A`。

## 隱私

- 沒有分析、沒有廣告。擴充套件不會把瀏覽紀錄另存一份送出去。
- 你按下翻譯、反白，或打開有字幕的影片時，那段文字會送到 Google 的翻譯接口。Google 失敗時，同一段會改送到 Microsoft（`edge.microsoft.com`）。
- 只有在你貼上自己的 Gemini 金鑰，並選用 Gemini 時，文字才會送到 Gemini。頁面標題只在這時當作用語上下文，不會被當成要翻譯的正文。看圖模式才會把圖片像素送到 Gemini。
- 本機圖片辨識在你的電腦上進行。辨出的文字再依上面的規則送去翻譯。第一次辨識英文時，會從 jsDelivr 下載一份語言資料，核對 SHA-256 後存在本機。那是資料檔，不是遠端程式。
- 單字本與翻譯快取只在這台電腦的 `chrome.storage.local`。
- 設定與 Gemini 金鑰存在 `chrome.storage.sync`。若你開啟 Chrome 同步，它們會跟著 Google 帳號到其他裝置。金鑰只會傳給 Gemini 的 API。

## 權限

| 權限 | 為什麼需要 |
|---|---|
| `storage` | 設定與金鑰存 `chrome.storage.sync`。單字本、翻譯快取與額度狀態存 `chrome.storage.local`。 |
| `activeTab` | 你點工具列或按下已綁定的 `Alt+A` 時，只對目前分頁插入譯文。 |
| `scripting` | 插入翻譯樣式與頁面腳本。 |
| `contextMenus` | 圖片上的右鍵「翻譯這張圖片」。 |
| `offscreen` | 在背景文件裡跑本機文字辨識，避免擋住網頁。 |
| `https://x.com/*`、`https://twitter.com/*` | X 的貼文與影片字幕。 |
| `https://www.reddit.com/*` | Reddit 貼文。 |
| `https://www.youtube.com/*` | YouTube 字幕。 |
| `https://www.netflix.com/*`、`https://netflix.com/*` | Netflix 觀看頁字幕。 |
| `https://translate.googleapis.com/*` | 預設的免費 Google 翻譯。 |
| `https://edge.microsoft.com/*` | Google 失敗時的免費備援。 |
| `https://generativelanguage.googleapis.com/*` | 僅在你提供自己的 Gemini 金鑰時使用。 |
| `https://cdn.jsdelivr.net/*` | 第一次本機辨識時下載英文語言資料。 |
| 所有 http／https 網站的內容腳本 | 讓 `Alt+A`、反白翻譯與右鍵圖片翻譯在任意網頁可用。不會因此把每個網頁的全文自動送出。 |

## 從原始碼建置

需要 Node.js。

```bash
npm install
npm run build       # 產生 dist/
npm run typecheck   # tsc --noEmit
npm run watch       # 改檔後重建
npm run smoke       # 探測免費翻譯接口是否可連
npm run zip         # 把 dist/ 包成專案根目錄的 immersive-bilingual.zip
```

在 `chrome://extensions` 載入 `dist/`。`manifest.json` 必須在所選資料夾的最外層。

## 授權

[MIT](LICENSE)。Copyright (c) 2026 ekko@keemail.me。

<a id="english"></a>

## Overview

Read foreign text as the original on one line and the translation on the next. It covers web pages and captions on YouTube, Netflix, and videos inside X posts. The default engine is free Google Translate, and it does not ask for an API key.

Built for people who follow news on X, Reddit, and LinkedIn in other languages, or learn a language through YouTube and Netflix: no tab switching and no copy-paste. The original and the translation sit side by side, so you read faster and still see how it was really said.

👉 **[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/hhhlkbfhcnbonndnnooanhdopbepjban)**

## Features

- **Pages.** X and Reddit translate line by line as you open them. On LinkedIn and any other site, press `Alt+A` or use “Translate this page” in the toolbar popup.
- **Three views.** Original and translation, translation only, or original only.
- **Video captions.** YouTube, a Netflix watch page, and videos in X posts can show bilingual captions. Put the translation above or below the original. Captions burned into the picture, with no text track, cannot be translated.
- **Selection.** Select text to see a translation. A word includes a short gloss and a translation of its sentence. Copy, speak the original, or drag the card. Esc or a click elsewhere closes it.
- **Word list.** A star saves the word on this computer. Search, sort, delete, and export CSV or TXT from the options page.
- **Images.** Right-click an image. The default path recognizes text on your computer, then translates it. You can switch to Gemini vision with your own key.
- **Engines.** Free Google is the default. If Google fails, that same passage is sent to Microsoft, still with no key. Paste your own Gemini key if you want that engine instead.
- **Target languages:** Traditional Chinese, Simplified Chinese, English, Japanese, Korean, Spanish, French, and German. Lines that are already in the target language are skipped.
- **Eight interface languages,** or follow the browser: Traditional Chinese, Simplified Chinese, English, Japanese, Korean, German, French, and Spanish.
- **Appearance.** Translation style, color, a left-hand mark, a tint behind the translation, and font size, with a live preview. When the target is Traditional Chinese, the free engine also replaces common technology terms with the usual wording.

## Install

### Chrome Web Store (recommended)

Open [Bilingual Translate on the Chrome Web Store](https://chromewebstore.google.com/detail/hhhlkbfhcnbonndnnooanhdopbepjban) and choose Add to Chrome. Updates install automatically.

### Load unpacked

1. Download the zip from [Releases](https://github.com/ekkoee/thelimitsofmylanguagemeanthelimitsofmyworld/releases) and unzip it. Keep the folder that contains `manifest.json`.
2. Open `chrome://extensions` and turn on Developer mode.
3. Choose Load unpacked and select that folder.

If you build from source, load the `dist/` folder produced below.

Chrome may ask on startup whether to disable a developer-mode extension. For a manual install, choose Keep.

## Use and shortcuts

| Goal | Action |
|---|---|
| Translate the current page, or cycle the three views | `Alt+A`, or “Translate this page” in the toolbar popup |
| Change the target language or the view | Open the toolbar popup |
| Engine, appearance, word list, interface language | Open Settings |
| Translate an image | Right-click the image |
| Close the selection card | Esc, or click elsewhere on the page |

The only shortcut registered with Chrome is `Alt+A` (`toggle-page-translation`). An unpacked install sometimes does not bind it. If the key does nothing, set it at `chrome://extensions/shortcuts`. Esc only closes the selection card. It is not a Chrome command.

X, Reddit, and YouTube start on their own. Netflix captions start on a watch page. Browse pages and every other site use `Alt+A`.

## Privacy

- No analytics and no ads. The extension does not ship a copy of your browsing history.
- When you translate, select text, or play a video that has captions, that text is sent to Google’s translate endpoints. If Google fails, the same text is sent to Microsoft (`edge.microsoft.com`).
- Text is sent to Gemini only after you paste your own key and choose Gemini. In that mode the page title may be included as context for wording. It is not translated as its own passage. Image pixels are sent to Gemini only if you choose Gemini for images.
- Local image recognition runs on your computer. The recognized text is then translated under the rules above. The first English recognition downloads a language-data file from jsDelivr, checks its SHA-256, and stores it locally. That file is data, not remote code.
- The word list and the translation cache stay in `chrome.storage.local` on this computer.
- Settings and the Gemini key live in `chrome.storage.sync`. If Chrome Sync is on, they follow your Google account to other devices. The key is sent only to the Gemini API.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Settings and the key in `chrome.storage.sync`. Word list, translation cache, and quota state in `chrome.storage.local`. |
| `activeTab` | A click on the toolbar, or a bound `Alt+A`, injects the translation into the current tab only. |
| `scripting` | Inserts the translation stylesheet and page scripts. |
| `contextMenus` | The “Translate this image” item. |
| `offscreen` | Runs local text recognition in a background document so the page stays responsive. |
| `https://x.com/*`, `https://twitter.com/*` | Posts and video captions on X. |
| `https://www.reddit.com/*` | Reddit posts. |
| `https://www.youtube.com/*` | YouTube captions. |
| `https://www.netflix.com/*`, `https://netflix.com/*` | Captions on a Netflix watch page. |
| `https://translate.googleapis.com/*` | The default free Google engine. |
| `https://edge.microsoft.com/*` | Free fallback when Google fails. |
| `https://generativelanguage.googleapis.com/*` | Used only when you supply your own Gemini key. |
| `https://cdn.jsdelivr.net/*` | Downloads English recognition data on first local OCR. |
| Content scripts on all http/https sites | Makes `Alt+A`, selection translation, and image translation available on any page. It does not automatically upload the full text of every page. |

## Build from source

Node.js is required.

```bash
npm install
npm run build       # writes dist/
npm run typecheck   # tsc --noEmit
npm run watch       # rebuilds on change
npm run smoke       # checks that the free translate endpoint answers
npm run zip         # packs dist/ into immersive-bilingual.zip at the repo root
```

Load `dist/` at `chrome://extensions`. `manifest.json` has to sit at the top of the folder you select.

## License

[MIT](LICENSE). Copyright (c) 2026 ekko@keemail.me.
