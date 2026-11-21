// Live smoke test on the real primevideo.com: content script injects without errors,
// and collect the player SDK's ad-related CSS class names to validate our selectors.
import { launch, sleep } from './helpers.mjs';
const { ctx } = await launch();
const page = await ctx.newPage();
const errs = [],
  adClasses = new Set(),
  scripts = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => {
  if (m.text().includes('AdSpeeder')) console.log('  console:', m.text());
});
page.on('response', async (r) => {
  const u = r.url();
  if (!/\.(js|css)(\?|$)/.test(u)) return;
  scripts.push(u);
  try {
    const t = await r.text();
    for (const m of t.matchAll(/atvwebplayersdk-[a-z0-9-]*ad[a-z0-9-]*/gi))
      adClasses.add(m[0]);
  } catch {
    // some responses (redirects, opaque) have no readable body
  }
});
for (const url of [
  'https://www.primevideo.com/',
  'https://www.primevideo.com/detail/0QSQ9ZB4GPQYIDF9XF2J47QH7R/'
]) {
  await page
    .goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    .catch((e) => console.log('goto err', e.message));
  await sleep(6000);
  console.log(
    url,
    '-> title:',
    await page.title(),
    '| adSpeeder state:',
    await page.evaluate(
      () => document.documentElement.dataset.adSpeeder ?? 'NOT INJECTED'
    )
  );
}
console.log(
  'scripts loaded:',
  scripts.length,
  '| page errors from extension:',
  errs.filter((e) => /AdSpeeder|content\.js/.test(e))
);
console.log('ad-ish player classes found:', [...adClasses].sort());
await page.screenshot({ path: 'tests/prime-live.png' });
await ctx.close();
