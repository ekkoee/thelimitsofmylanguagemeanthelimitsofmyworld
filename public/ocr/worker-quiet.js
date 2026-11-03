// Worker entry for local OCR. Patches this worker's console before Tesseract
// loads, so "Estimating resolution" never reaches chrome://extensions.
// Real errors still pass through.
(function hush() {
  var noise = /Estimating resolution|Detected \d+ diacritics|Invalid resolution/i;
  function textOf(args) {
    return args.map(function (part) {
      return String(part && part.message ? part.message : part);
    }).join(' ');
  }
  ['error', 'warn', 'log'].forEach(function (name) {
    var orig = console[name].bind(console);
    console[name] = function () {
      if (noise.test(textOf([].slice.call(arguments)))) return;
      return orig.apply(console, arguments);
    };
  });
})();
importScripts(new URL('worker.min.js', self.location.href).href);
