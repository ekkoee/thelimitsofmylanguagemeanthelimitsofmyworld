import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
execSync(
  'npx esbuild src/core/i18n.ts --bundle --format=esm --platform=node --outfile=/tmp/ibt-i18n-151.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const api = await import(pathToFileURL('/tmp/ibt-i18n-151.mjs').href);
let failed = 0;
function check(name, got, want) {
  if (got !== want) { failed++; console.error('FAIL', name, JSON.stringify(got), 'want', JSON.stringify(want)); }
  else console.log('ok', name);
}
check('tw', api.resolveUiLang('', 'zh-TW'), 'zh-TW');
check('hk', api.resolveUiLang('', 'zh-HK'), 'zh-TW');
check('hant', api.resolveUiLang('', 'zh-Hant'), 'zh-TW');
check('cn', api.resolveUiLang('', 'zh-CN'), 'zh-CN');
check('hans', api.resolveUiLang('', 'zh-Hans'), 'zh-CN');
check('de-at', api.resolveUiLang('', 'de-AT'), 'de');
check('fr', api.resolveUiLang('', 'fr-CA'), 'fr');
check('ja', api.resolveUiLang('', 'ja-JP'), 'ja');
check('ko', api.resolveUiLang('', 'ko-KR'), 'ko');
check('es', api.resolveUiLang('', 'es-MX'), 'es');
check('fallback', api.resolveUiLang('', 'pt-BR'), 'en');
check('pref wins', api.resolveUiLang('ja', 'de'), 'ja');
api.setUiLang('zh-TW');
check('default view', api.t('viewBoth'), '原文 + 譯文對照');
check('default hint', api.t('altHint'), 'Alt+A 切換原文、譯文、對照');
api.setUiLang('de');
check('de page', api.t('translatePage'), 'Diese Seite übersetzen');
check('de view', api.t('viewBoth'), 'Original und Übersetzung');
check('de hint', api.t('altHint'), 'Alt+A: Original, Übersetzung, beides');
api.setUiLang('en');
check('en view only', api.t('viewTrans'), 'Translation only');
api.setUiLang('ja');
check('ja name', api.t('appName'), '対訳');
api.setUiLang('zh-TW');
check('rate', api.t('rateLimit', { sec: 10 }), '請求太頻繁，10 秒後自動重試');
check('image key', api.t('imageNeedsKey').includes('Gemini 金鑰'), true);
if (failed) process.exit(1);
console.log('PASS');
