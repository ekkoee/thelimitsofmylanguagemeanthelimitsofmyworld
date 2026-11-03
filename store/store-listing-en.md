# Chrome Web Store copy (English)

Name (46 characters, limit 75):

Bilingual Translate — Web and YouTube captions

## Short description

108 characters, limit 132. Same text as `extDescription` in `public/_locales/en/messages.json`.

Original and translation, line by line. Any page (Alt+A), X, Reddit, YouTube, and Netflix. Free, no API key.

## Detailed description

Read foreign text with the original on one line and the translation on the next.

X and Reddit translate as you open them. On LinkedIn and any other site, press Alt+A or use “Translate this page” in the toolbar popup. After a page is translated, Alt+A cycles three views: original and translation, translation only, and original only.

YouTube, a Netflix watch page, and videos inside X posts can show bilingual captions. Put the translation above or below the original. Captions burned into the picture, with no text track, cannot be translated.

Select text to see a translation. A word includes a short gloss and a translation of its sentence. Copy it, hear the original, or drag the card. A star saves the word on this computer. Search, delete, and export CSV or TXT from the options page.

Right-click an image to translate it. By default the extension recognizes the text on your computer and then translates it, with no quota. If you paste your own Gemini key, you can switch images to Gemini vision.

Target languages: Traditional Chinese, Simplified Chinese, English, Japanese, Korean, Spanish, French, and German. Lines that are already in the target language are skipped. The interface can follow the browser or use any of those eight languages. Appearance covers translation style, color, a left-hand mark, a tint, and font size.

The default engine is free Google Translate. No API key is required. If Google fails, the same passage is sent to Microsoft, still with no key.

## Single purpose

Show a translation beside the original so web pages and video captions can be read line by line.

## Permission justifications (store form)

storage: Settings and an optional Gemini key are kept in chrome.storage.sync. The word list, translation cache, and quota state are kept in chrome.storage.local.

activeTab: A click on the toolbar icon, or a bound Alt+A, injects the translation into the current tab only.

scripting: Inserts the translation stylesheet and the page scripts for whole-page and image translation.

contextMenus: Adds “Translate this image” to the image context menu.

offscreen: Runs local text recognition (Tesseract) in a background document so it does not block the page.

Host permission https://x.com/* and https://twitter.com/*: Read posts and video captions on X in order to show a translation beside them.

Host permission https://www.reddit.com/*: Read Reddit posts in order to show a translation beside them.

Host permission https://www.youtube.com/*: Read YouTube captions in order to show a translation beside them.

Host permission https://www.netflix.com/* and https://netflix.com/*: Read captions on a Netflix watch page.

Host permission https://translate.googleapis.com/*: Send the text being translated to the free Google endpoint.

Host permission https://edge.microsoft.com/*: Send that same text to the free Microsoft endpoint when Google fails.

Host permission https://generativelanguage.googleapis.com/*: Used only after the user pastes their own Gemini key and chooses Gemini for text or for images.

Host permission https://cdn.jsdelivr.net/*: On the first local English recognition, download a language-data file and check its SHA-256. The file is not code.

Content scripts on all http and https sites: Make Alt+A, selection translation, and image translation available on the page the user is reading. They do not automatically upload the full text of every page.

Every permission above has a call site. This release does not remove any of them.

## Privacy practices (store form)

This extension has no analytics and no ads. It does not export a separate copy of browsing history.

Data that leaves the browser:

- Page text, selected text, caption text, and text recognized from an image are sent to translate.googleapis.com when the user translates.
- If the Google request fails, the same text is sent to edge.microsoft.com.
- If the user pastes their own Gemini key and selects Gemini, the text is sent to generativelanguage.googleapis.com. For page prose, the page title may be included as context for wording. Image pixels are sent only when Gemini vision is selected. The key is stored in chrome.storage.sync and is sent only to that API.
- The first local English recognition downloads a language-data file (not executable code) from cdn.jsdelivr.net, checks it, and stores it in IndexedDB. Recognition itself runs on the device.

Data that stays in the browser:

- The word list (ibt_vocab in chrome.storage.local) stays on this computer. CSV and TXT export is a file the user saves.
- The translation cache stays in chrome.storage.local.
- Other settings stay in chrome.storage.sync. If the user has Chrome Sync on, settings and the key follow the Google account to other devices.

Not collected: health information, financial or payment information, personal communications, precise location, user-activity logs, or a standalone web-history record.
