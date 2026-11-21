// Live youtube.com, real player DOM: flip the real #movie_player into its ad state
// and check the extension reacts (used where YouTube won't actually play, e.g. on
// datacenter IPs that get the "confirm you're not a bot" wall).
import { launch, sleep, waitFor } from './helpers.mjs';
const { ctx } = await launch();
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('https://www.youtube.com/watch?v=kJQP7kiw5Fk', {
  waitUntil: 'domcontentloaded'
});
await waitFor(
  () =>
    page.evaluate(
      () =>
        !!document.querySelector('#movie_player video') &&
        document.documentElement.dataset.adSpeeder
    ),
  { timeout: 20000, msg: 'player + extension' }
);
const st = () =>
  page.evaluate(() => {
    const p = document.querySelector('#movie_player'),
      v = p.querySelector('video');
    return {
      cls: p.className
        .split(' ')
        .filter((c) => c.startsWith('ad-'))
        .join(','),
      rate: v.playbackRate,
      muted: v.muted,
      ext: document.documentElement.dataset.adSpeeder
    };
  });
const ok = (c, m) => {
  console.log(c ? '  PASS' : '  FAIL', m);
  if (!c) process.exitCode = 1;
};
console.log('before:', await st());
await page.evaluate(() => {
  const v = document.querySelector('#movie_player video');
  v.playbackRate = 1.25;
  v.muted = false;
});
await page.evaluate(() =>
  document.querySelector('#movie_player').classList.add('ad-showing')
);
await waitFor(async () => (await st()).rate === 16, { msg: '16x' }).catch(
  () => {}
);
let s = await st();
console.log('during ad:', s);
ok(
  s.rate === 16 && s.muted && s.ext === 'ad',
  'real YouTube player in ad state → 16x + muted'
);
await page.evaluate(() => {
  const b = document.createElement('button');
  b.className = 'ytp-skip-ad-button';
  b.textContent = 'Skip';
  b.onclick = () => {
    window.__skipped = true;
    document.querySelector('#movie_player').classList.remove('ad-showing');
    b.remove();
  };
  document.querySelector('#movie_player').appendChild(b);
});
await waitFor(() => page.evaluate(() => window.__skipped === true), {
  msg: 'skip'
}).catch(() => {});
ok(
  await page.evaluate(() => window.__skipped === true),
  'Skip button clicked inside real player'
);
await waitFor(async () => (await st()).ext === 'content', {
  msg: 'restore'
}).catch(() => {});
s = await st();
console.log('after ad:', s);
ok(s.rate === 1.25 && !s.muted, 'speed 1.25x and sound restored after ad');

// --- auto-skip scenarios on the real player DOM ---
const AD = () =>
  page.evaluate(() => {
    const v = document.querySelector('#movie_player video');
    v.playbackRate = 1.25;
    v.muted = false;
    document.querySelector('#movie_player').classList.add('ad-showing');
  });
async function skipScenario(name, markup, { hiddenFirstMs = 0, pod = 1 } = {}) {
  await page.evaluate(
    ({ markup, hidden, pod }) => {
      window.__clicks = 0;
      window.__early = 0;
      const host =
        document.querySelector('#movie_player .video-ads') ||
        document.querySelector('#movie_player');
      const wrap = document.createElement('div');
      wrap.className = 'ytp-ad-player-overlay-layout';
      wrap.style.cssText = 'position:absolute;right:0;bottom:60px;z-index:999';
      // YouTube enforces Trusted Types (no innerHTML), so build the button with DOM calls
      const b = document.createElement('button');
      b.dataset.skip = '';
      if (markup.cls) b.className = markup.cls;
      if (markup.aria) b.setAttribute('aria-label', markup.aria);
      b.textContent = markup.text;
      wrap.appendChild(b);
      host.appendChild(wrap);
      // real YouTube CSS hides some of these until the ad UI is live; force a visible state we control
      b.style.setProperty(
        'visibility',
        hidden ? 'hidden' : 'visible',
        'important'
      );
      b.style.setProperty('display', 'inline-block', 'important');
      b.addEventListener('click', () => {
        if (getComputedStyle(b).visibility === 'hidden') {
          window.__early++;
          return;
        }
        window.__clicks++;
        window.__lastAt = performance.now();
        if (window.__clicks < pod) {
          b.style.setProperty('visibility', 'hidden', 'important');
          setTimeout(() => {
            b.style.setProperty('visibility', 'visible', 'important');
            window.__shownAt = performance.now();
          }, 300);
        } else {
          document
            .querySelector('#movie_player')
            .classList.remove('ad-showing');
          wrap.remove();
        }
      });
      window.__wrap = wrap;
    },
    { markup, hidden: hiddenFirstMs > 0, pod }
  );
  if (hiddenFirstMs) {
    await sleep(hiddenFirstMs);
    await page.evaluate(() => {
      const b = window.__wrap.querySelector('[data-skip]');
      b.style.setProperty('visibility', 'visible', 'important');
      window.__shownAt = performance.now();
      return window.__shownAt;
    });
  }
  await waitFor(() => page.evaluate((pod) => window.__clicks === pod, pod), {
    timeout: 4000,
    msg: name
  }).catch(() => {});
  const r = await page.evaluate(() => ({
    clicks: window.__clicks,
    early: window.__early,
    lat: window.__lastAt - window.__shownAt
  }));
  await waitFor(async () => (await st()).ext === 'content', {
    msg: 'ad over'
  }).catch(() => {});
  const after = await st();
  ok(
    r.clicks === pod && after.rate === 1.25 && !after.muted,
    `${name}: clicks=${r.clicks}/${pod}${hiddenFirstMs || pod > 1 ? `, latency after (re)appear ${r.lat.toFixed(0)}ms` : ''}, restored=${after.rate}x muted=${after.muted}`
  );
  if (hiddenFirstMs || pod > 1)
    ok(r.lat < 300, `${name}: clicked within 300ms of appearing`);
}
for (const [name, markup] of [
  ['.ytp-skip-ad-button', { cls: 'ytp-skip-ad-button', text: 'Skip' }],
  [
    '.ytp-ad-skip-button',
    { cls: 'ytp-ad-skip-button ytp-button', text: 'Skip Ads' }
  ],
  [
    '.ytp-ad-skip-button-modern',
    { cls: 'ytp-ad-skip-button-modern ytp-button', text: 'Skip' }
  ],
  ['aria-label "Skip ad"', { cls: 'zz', aria: 'Skip ad', text: '»' }]
]) {
  await AD();
  await skipScenario(`real player, ${name}`, markup);
}
await AD();
await skipScenario(
  'real player, countdown then skip',
  { cls: 'ytp-skip-ad-button', text: 'Skip' },
  { hiddenFirstMs: 1500 }
);
await AD();
await skipScenario(
  'real player, back-to-back pod of 2 (same button)',
  { cls: 'ytp-skip-ad-button', text: 'Skip' },
  { pod: 2 }
);

// --- viewer speed restored even when the player resets to 1x as the ad starts ---
await page.evaluate(() => {
  document.querySelector('#movie_player video').playbackRate = 1.5;
});
await sleep(1500);
await page.evaluate(() => {
  document.querySelector('#movie_player video').playbackRate = 1;
  document.querySelector('#movie_player').classList.add('ad-showing');
});
await waitFor(async () => (await st()).rate === 16, { msg: '16x' }).catch(
  () => {}
);
await page.evaluate(() =>
  document.querySelector('#movie_player').classList.remove('ad-showing')
);
await waitFor(async () => (await st()).ext === 'content', { msg: 'end' }).catch(
  () => {}
);
await sleep(400);
const sp = await st();
ok(
  sp.rate === 1.5,
  `real player: 1.5x viewer, reset to 1x at ad start → restored ${sp.rate}x`
);

ok(
  !errs.some((e) => /AdSpeeder|content\.js/.test(e)),
  'no extension errors on page'
);
await ctx.close();
