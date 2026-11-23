// Live smoke test on the real sonyliv.com: the content script injects without errors,
// and the player script still uses the ad class names content.js relies on.
// Playback itself needs an Indian IP; ad detection is covered by the mock tests.
import { launch, sleep } from './helpers.mjs';

const NEEDED = [
  'ad-wrapper ad-layer-hidden',
  'ad-layer-hidden',
  'dai-ad-playing',
  'ad-label-container',
  'ad-info-container'
];
const { ctx } = await launch();
const page = await ctx.newPage();
const errs = [];
const found = new Set();
let playerScript = null;
page.on('pageerror', (e) => errs.push(e.message));
page.on('response', async (r) => {
  const u = r.url();
  if (!/player\.sonyliv\.com\/.*sp-player-web[^/]*\.js/.test(u)) return;
  playerScript = u;
  try {
    const t = await r.text();
    for (const n of NEEDED) if (t.includes(n)) found.add(n);
  } catch {
    // opaque / redirected response
  }
});
await page
  .goto('https://www.sonyliv.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  })
  .catch((e) => console.log('goto err', e.message));
await sleep(4000);
const link = await page.evaluate(
  () =>
    [...document.querySelectorAll('a[href*="watch=true"]')].map(
      (a) => a.href
    )[0] || null
);
if (link)
  await page
    .goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 })
    .catch((e) => console.log('goto err', e.message));
await sleep(15000);
const state = await page.evaluate(
  () => document.documentElement.dataset.adSpeeder ?? 'NOT INJECTED'
);
const missing = NEEDED.filter((n) => !found.has(n));
console.log('page:', page.url());
console.log('adSpeeder state:', state);
console.log('player script:', playerScript ?? 'not loaded');
console.log('ad class names found:', [...found].sort());
console.log('missing:', missing);
const extErrs = errs.filter((e) => /AdSpeeder|content\.js/.test(e));
console.log('page errors from extension:', extErrs);
await page.screenshot({ path: 'tests/sonyliv-live.png' });
await ctx.close();
const ok =
  state !== 'NOT INJECTED' &&
  playerScript &&
  !missing.length &&
  !extErrs.length;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
