// Documents the provider-aware hybrid gate (mirrors service-worker hybridEnabled).
function hybridEnabled(settings) {
  const freeProvider = settings.provider === 'google' || settings.provider === 'microsoft';
  return !!(settings.hybridPolish && settings.apiKeys.gemini?.trim() && freeProvider);
}

const key = { gemini: 'AIza...' };
const cases = [
  [{ hybridPolish: true, provider: 'gemini', apiKeys: key }, false, 'Gemini provider → hybrid off'],
  [{ hybridPolish: true, provider: 'openai', apiKeys: key }, false, 'OpenAI provider → hybrid off'],
  [{ hybridPolish: true, provider: 'google', apiKeys: key }, true, 'Google + key → hybrid on'],
  [{ hybridPolish: true, provider: 'microsoft', apiKeys: key }, true, 'MS + key → hybrid on'],
  [{ hybridPolish: true, provider: 'google', apiKeys: { gemini: '' } }, false, 'no Gemini key → off'],
  [{ hybridPolish: false, provider: 'google', apiKeys: key }, false, 'checkbox off → off'],
];

let fail = 0;
for (const [s, exp, label] of cases) {
  const got = hybridEnabled(s);
  if (got !== exp) {
    fail++;
    console.error(`FAIL ${label}: got ${got}, want ${exp}`);
  }
}
console.log(`${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
