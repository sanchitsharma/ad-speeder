// Live test on real youtube.com: play videos that usually carry ads and record what
// the extension does when YouTube shows one.
// Usage: node tests/youtube-live.mjs [secondsPerVideo] [videoId ...]
import { launch, sleep } from './helpers.mjs';
import fs from 'node:fs';

const secs = Number(process.argv[2]) || 70;
const ids = process.argv.slice(3).length
  ? process.argv.slice(3)
  : ['kJQP7kiw5Fk', 'JGwWNGJdvx8', '9bZkp7q19f0', 'OPf0YbXqDm0', 'RgKAFK5djSk'];
fs.mkdirSync('tests/live-shots', { recursive: true });

const { ctx, sw } = await launch({ headless: process.env.HEADED !== '1' });
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.text().includes('[AdSpeeder]'))
    log('ext:', m.text().replace('[AdSpeeder] ', ''));
});
const t0 = Date.now();
const log = (...a) =>
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);

async function acceptConsent() {
  for (const sel of [
    'button[aria-label*="Accept all"]',
    'button[aria-label*="Reject all"]',
    'form[action*="consent"] button'
  ]) {
    const b = page.locator(sel).first();
    if (await b.isVisible().catch(() => false)) {
      await b.click().catch(() => {});
      log('consent dismissed');
      await sleep(2000);
      return;
    }
  }
}

let totalAds = 0;
for (const id of ids) {
  log(`=== https://www.youtube.com/watch?v=${id}`);
  await page.goto(`https://www.youtube.com/watch?v=${id}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  });
  await sleep(3000);
  await acceptConsent();
  await page.evaluate(() => {
    document
      .querySelector('#movie_player video')
      ?.play()
      .catch(() => {});
  });
  let prev = '',
    adsHere = 0,
    shot = 0;
  const end = Date.now() + secs * 1000;
  while (Date.now() < end) {
    const s = await page
      .evaluate(() => {
        const p = document.querySelector('#movie_player');
        const v = p?.querySelector('video');
        const skip = document.querySelector(
          '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-slot button, .ytp-skip-ad button, button[id^="skip-button"]'
        );
        return {
          player: !!p,
          ad:
            !!p &&
            (p.classList.contains('ad-showing') ||
              p.classList.contains('ad-interrupting')),
          ext: document.documentElement.dataset.adSpeeder,
          rate: v?.playbackRate,
          muted: v?.muted,
          t: v ? +v.currentTime.toFixed(1) : null,
          dur: v ? +(v.duration || 0).toFixed(0) : null,
          paused: v?.paused,
          skipVisible:
            !!skip && skip.checkVisibility({ visibilityProperty: true }),
          skipMarkup: skip ? skip.outerHTML.slice(0, 160) : '',
          adBadge:
            document
              .querySelector(
                '.ytp-ad-badge, .ytp-ad-simple-ad-badge, .ad-simple-attributed-string'
              )
              ?.textContent?.trim() || '',
          bot: /confirm you.re not a bot|Sign in to confirm/i.test(
            document.body.innerText.slice(0, 5000)
          )
        };
      })
      .catch((e) => ({ err: e.message }));
    const key = JSON.stringify([
      s.ad,
      s.ext,
      s.rate,
      s.muted,
      s.skipVisible,
      s.bot
    ]);
    if (key !== prev) {
      log(JSON.stringify(s));
      if (s.ad && !JSON.parse(prev || '[false]')[0]) {
        adsHere++;
        totalAds++;
      }
      if (s.ad && shot < 2) {
        await page.screenshot({
          path: `tests/live-shots/${id}-ad-${shot++}.png`
        });
      }
      prev = key;
    }
    if (s.bot) {
      log('YouTube bot-check wall');
      break;
    }
    await sleep(250);
  }
  log(`ads seen on ${id}: ${adsHere}`);
  await page.screenshot({ path: `tests/live-shots/${id}-end.png` });
}
const stats = await sw.evaluate(
  () =>
    new Promise((r) =>
      chrome.storage.local.get({ stats: null }, (x) => r(x.stats))
    )
);
log(
  'TOTAL ad breaks seen:',
  totalAds,
  '| extension stats:',
  JSON.stringify(stats)
);
await ctx.close();
