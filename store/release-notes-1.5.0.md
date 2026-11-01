# 1.5.0

商店送審版本。翻譯行為與 1.4.55 相同。

Store submission. Translation behavior is unchanged from 1.4.55.

## 這版整理進來的用法

- 網頁逐行對照。X、Reddit 自動；LinkedIn 與其他網站按 Alt+A。三種呈現：對照、只顯示譯文、只顯示原文。
- YouTube、Netflix 觀看頁、X 影片的雙語字幕。
- 反白翻譯、單字卡與例句。單字本存在本機，可匯出 CSV／TXT。
- 右鍵圖片翻譯：預設本機辨識，也可改用自己的 Gemini 金鑰看圖。
- 目標語言八種。介面語言八種，或跟隨瀏覽器。已經是目標語言的句子會略過。
- 韓文在空白處換行，日文依禁則換行。介面把譯文稱為「譯文」。
- 預設免費 Google，免金鑰。Google 失敗時改問 Microsoft。免費翻譯恢復同時送出，並改走較快的接口。

## What this release collects

- Line-by-line pages. X and Reddit start on their own. LinkedIn and other sites use Alt+A. Three views: both, translation only, original only.
- Bilingual captions on YouTube, Netflix watch pages, and videos on X.
- Selection translation, a word card with an example sentence, and a local word list with CSV/TXT export.
- Right-click image translation: on-device recognition by default, or Gemini vision with your own key.
- Eight target languages and eight interface languages, or follow the browser. Lines already in the target language are skipped.
- Korean wraps at spaces. Japanese follows line-break rules. The interface says “translation,” not “Chinese,” when it means the translated line.
- Free Google by default, with no key. Microsoft is the fallback when Google fails. Free requests run concurrently again, on the faster endpoint.
