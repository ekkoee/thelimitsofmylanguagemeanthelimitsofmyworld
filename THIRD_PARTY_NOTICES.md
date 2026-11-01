# Third-party notices

This extension is MIT licensed. FluentRead (GPL-3.0) was used only as a design reference for local OCR, paragraph grouping, and selection translation. No FluentRead source code is included.

## Bundled

- **tesseract.js 5.1.1** — Apache-2.0. Copyright Naptha and contributors. Browser build (`tesseract.min.js`) and `worker.min.js`.
- **tesseract.js-core 5.1.1** — Apache-2.0. `tesseract-core-simd-lstm.wasm.js` (LSTM WebAssembly, SIMD). Copyright Naptha and contributors.

## Downloaded on first image translation (not in the zip)

- **English traineddata** `@tesseract.js-data/eng` `4.0.0_best_int` — Apache-2.0, from the Tesseract tessdata project. URL `https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz`. SHA-256 `45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91`. Cached in IndexedDB after the hash matches.

## Reviewed and not bundled

- **onnxruntime-web** — MIT. The WASM runtime is about 10 MB, so it is not in this package.
- **ppu-paddle-ocr** — MIT. Not included.
- **PaddleOCR and the PP-OCRv4/v5 ONNX detection weights** — Apache-2.0 (PaddlePaddle/PaddleOCR and the ppu-paddle-ocr-models collection). Not included.

Manga mode in this version finds light speech bubbles and runs a second Tesseract pass on the image rotated 90 degrees, then fills each box with the sampled background color. It does not ship a Paddle model.
