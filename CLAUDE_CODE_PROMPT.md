# 貼給 Claude Code 的指令

> 把整段貼進 Claude Code。它會 build、實測免費翻譯引擎、再告訴你怎麼載入 Chrome。

---

我的專案在這個資料夾：
`C:\Users\User\Desktop\immersive-bilingual-project`

這是一個 Chrome MV3 擴充功能，功能是把 X/Twitter、Reddit、YouTube 的英文內容做成
「一句英文 / 一句中文」的沉浸式雙語顯示。**預設使用免費的 Google 翻譯端點，免 API key。**

請依序幫我做以下事，每一步把結果印出來，遇到錯誤就修好再繼續：

1. `cd` 到上面的資料夾，先 `type README.md`（或 cat）快速看一下架構。
2. 執行 `npm install`。
3. 執行 `npm run typecheck`，確認 TypeScript 沒有型別錯誤。
4. 執行 `npm run smoke`，這會**實際呼叫一次免費翻譯端點**並印出雙語樣本。
   - 如果印出中文翻譯 → 免費引擎正常，免設定就能用。
   - 如果失敗（403/429）→ 告訴我，並在 README 找「Gemini 免費 key」的後備方案。
5. 執行 `npm run build`，產生 `dist\` 資料夾。
6. 印出載入 Chrome 的步驟：
   - 開 `chrome://extensions` → 開啟「開發人員模式」
   - 「載入未封裝項目」→ 選 `C:\Users\User\Desktop\immersive-bilingual-project\dist`
7. 給我一份「真人測試檢查清單」，列出我打開 x.com / reddit.com / youtube.com 後該確認哪些事
   （例如：推文下方有沒有出現中文、Reddit 留言有沒有、YouTube 開字幕後有沒有第二行中文、
   深色模式好不好看、popup 的開關有沒有效）。

接著待命：等我做完真人測試回報問題（最常見的是某個網站的「選擇器」失效，導致那站沒翻譯）。
**所有網站選擇器都集中在 `src\content\selectors.ts`**，如果我說「Reddit 留言沒翻到」或
「X 推文沒反應」，請去那個檔案調整對應的 selector，然後重新 `npm run build`，
我再到 `chrome://extensions` 按該擴充的「重新整理」重載測試。

注意事項：
- 不要改成需要付費 key 的預設；免費（Google）必須是預設引擎。
- 改動後一定要重新 `npm run build`，因為 Chrome 載入的是 `dist\`，不是原始碼。
- 如果免費端點被限流，引導我到選項頁切換到 Gemini（免費 key），不要直接改成 OpenAI。
