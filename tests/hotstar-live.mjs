// Live smoke test on the real hotstar.com / jiohotstar.com: the content script
// injects without errors on both domains. Hotstar serves its player only to
// Indian residential IPs, so the ad markup (#ad-video-container) is covered by
// the mock tests, not here.
import { launch, sleep } from './helpers.mjs';

const { ctx } = await launch();
let ok = true;
for (const url of [
  'https://www.hotstar.com/in',
  'https://www.jiohotstar.com/'
]) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page
    .goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    .catch((e) => console.log('goto err', e.message));
  await sleep(6000);
  const state = await page.evaluate(
    () => document.documentElement.dataset.adSpeeder ?? 'NOT INJECTED'
  );
  const extErrs = errs.filter((e) => /AdSpeeder|content\.js/.test(e));
  console.log(
    url,
    '→',
    page.url(),
    '| adSpeeder state:',
    state,
    '| ext errors:',
    extErrs
  );
  if (state === 'NOT INJECTED' || extErrs.length) ok = false;
  await page.close();
}
await ctx.close();
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
