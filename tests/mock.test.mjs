// End-to-end tests of the real extension in Chromium against mock Prime Video /
// YouTube pages. Pages are served at the real hostnames (via request routing) so
// the manifest's content-script matching is exercised too.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, VIDEO, waitFor, sleep, enableDebug } from './helpers.mjs';

const PRIME_URL = 'https://www.primevideo.com/detail/mock-test';
const AMAZON_IN_URL = 'https://www.amazon.in/gp/video/detail/mock-test';
const YT_URL = 'https://www.youtube.com/watch?v=mocktest';
const SONYLIV_URL =
  'https://www.sonyliv.com/shows/mock-show-1700000000/mock-episode-1090000000?watch=true';

const PRIME_HTML = `<!doctype html><html><body style="margin:0;background:#000">
<div id="dv-web-player"><div class="webPlayerSDKContainer"><div class="webPlayerUIContainer">
  <video id="v" src="/test.webm" autoplay loop playsinline style="width:640px;height:360px"></video>
  <div class="atvwebplayersdk-overlays-container" id="overlay" style="position:absolute;top:0;left:0;color:#fff"></div>
</div></div></div></body></html>`;

const YT_HTML = `<!doctype html><html><body>
<div id="movie_player" class="html5-video-player playing-mode">
  <div class="html5-video-container"><video id="v" class="html5-main-video" src="/test.webm" autoplay loop style="width:640px;height:360px"></video></div>
  <div class="ytp-ad-module" id="admod"></div>
</div></body></html>`;

// Mirrors SonyLIV's player DOM (player.sonyliv.com sp-player-web 3.38): the IMA ad
// container is `.ad-wrapper.ad-layer-hidden` until an ad shows; the player's own
// "Skip Intro" button is `.skip-button`.
const SONYLIV_HTML = `<!doctype html><html><body style="margin:0;background:#000">
<div id="player-wrapper" class="video-player-wrapper" style="position:relative;width:640px;height:360px">
  <video id="v" src="/test.webm" autoplay loop playsinline style="width:640px;height:360px"></video>
  <div id="adw" class="ad-wrapper ad-layer-hidden" style="position:absolute;inset:0"></div>
  <div class="skip-button hover-click-effect" id="skipintro" style="position:absolute;right:10px;bottom:10px">Skip Intro</div>
</div></body></html>`;

// Hotstar: client-side ads play in their own <video> inside #ad-video-container on
// top of the paused content; the ad overlay's button is the "Go Ads free" upsell.
const HOTSTAR_URL =
  'https://www.hotstar.com/in/shows/mock-show/1260000000/mock-episode/1271000000/watch';
const JIOHOTSTAR_URL =
  'https://www.jiohotstar.com/in/movies/mock-movie/1260000001/watch';
const HOTSTAR_HTML = `<!doctype html><html><body style="margin:0;background:#000">
<div id="player-root" style="position:relative;width:640px;height:360px">
  <video id="v" src="/test.webm" autoplay loop playsinline style="width:640px;height:360px"></video>
</div></body></html>`;

const HUMANIZE_OFF = {
  youtube: false,
  prime: false,
  sonyliv: false,
  hotstar: false
};

let ctx, sw, extId;

before(async () => {
  ({ ctx, sw, extId } = await launch());
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('/test.webm'))
      return route.fulfill({
        status: 200,
        contentType: 'video/webm',
        body: VIDEO
      });
    if (u.hostname.endsWith('youtube.com'))
      return route.fulfill({ contentType: 'text/html', body: YT_HTML });
    if (u.hostname.endsWith('sonyliv.com'))
      return route.fulfill({ contentType: 'text/html', body: SONYLIV_HTML });
    if (u.hostname.endsWith('hotstar.com'))
      return route.fulfill({ contentType: 'text/html', body: HOTSTAR_HTML });
    if (u.hostname.endsWith('primevideo.com') || u.hostname.includes('amazon.'))
      return route.fulfill({ contentType: 'text/html', body: PRIME_HTML });
    if (u.protocol === 'chrome-extension:') return route.continue();
    return route.abort();
  });
});
after(async () => {
  await ctx?.close();
});

beforeEach(async () => {
  await sw.evaluate(
    () =>
      new Promise((r) =>
        chrome.storage.sync.clear(() => chrome.storage.local.clear(r))
      )
  );
  await enableDebug(sw);
  // Most tests check exact speeds/mute, so they run with humanizing off;
  // the "humanize:" tests turn it back on.
  await setSettings({ humanize: HUMANIZE_OFF });
});

async function openPage(url) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await waitFor(
    () => page.evaluate(() => document.documentElement.dataset.adSpeeder),
    { msg: 'content script loaded' }
  );
  await waitFor(
    () =>
      page.evaluate(
        () =>
          !document.getElementById('v').paused &&
          document.getElementById('v').currentTime > 0.2
      ),
    { msg: 'video playing' }
  );
  page.errors = errors;
  return page;
}
const vstate = (page, id = 'v') =>
  page.evaluate((id) => {
    const v = document.getElementById(id);
    return {
      rate: v.playbackRate,
      muted: v.muted,
      t: v.currentTime,
      state: document.documentElement.dataset.adSpeeder
    };
  }, id);
const setSettings = (s) =>
  sw.evaluate((s) => new Promise((r) => chrome.storage.sync.set(s, r)), s);
const getStats = () =>
  sw.evaluate(
    () =>
      new Promise((r) =>
        chrome.storage.local.get({ stats: null }, (x) => r(x.stats))
      )
  );
async function badgeFor(page) {
  const url = page.url();
  return sw.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    // without "tabs" permission tab.url is hidden, so pick the active tab of the focused window
    const t = tabs.find((t) => t.url === url) || tabs.find((t) => t.active);
    return chrome.action.getBadgeText({ tabId: t.id });
  }, url);
}

// ---------------- Prime Video ----------------

test('prime: no ad → video untouched', async () => {
  const page = await openPage(PRIME_URL);
  await sleep(800);
  const s = await vstate(page);
  assert.equal(s.state, 'content');
  assert.equal(s.rate, 1);
  assert.equal(s.muted, false);
  await page.close();
});

test('prime: ad timer → 16x + muted, then restores user speed 1.5x and sound', async () => {
  const page = await openPage(PRIME_URL);
  await page.evaluate(() => {
    document.getElementById('v').playbackRate = 1.5;
  });
  await page.evaluate(() => {
    document.getElementById('overlay').innerHTML =
      '<div class="atvwebplayersdk-ad-timer"><span class="atvwebplayersdk-ad-timer-text">Ad 0:30</span></div>';
  });
  await waitFor(async () => (await vstate(page)).rate === 16, { msg: '16x' });
  let s = await vstate(page);
  assert.equal(s.muted, true);
  assert.equal(s.state, 'ad');
  assert.equal(await badgeFor(page), 'AD');

  // the video really advances ~16x faster
  const t0 = s.t;
  await sleep(1500);
  const t1 = (await vstate(page)).t;
  const adv = t1 >= t0 ? t1 - t0 : t1 + 120 - t0;
  console.log(`    media advanced ${adv.toFixed(1)}s in 1.5s wall-clock`);
  assert.ok(adv > 6, `expected fast playback, advanced only ${adv}s`);

  await page.evaluate(() => {
    document.getElementById('overlay').innerHTML = '';
  });
  await waitFor(async () => (await vstate(page)).state === 'content', {
    msg: 'ad end'
  });
  s = await vstate(page);
  assert.equal(s.rate, 1.5);
  assert.equal(s.muted, false);
  assert.equal(await badgeFor(page), '');
  const stats = await waitFor(getStats, { msg: 'stats' });
  assert.equal(stats.adsHandled, 1);
  assert.ok(stats.secondsSaved > 10, `secondsSaved=${stats.secondsSaved}`);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('prime: hidden ad timer element is ignored', async () => {
  const page = await openPage(PRIME_URL);
  await page.evaluate(() => {
    document.getElementById('overlay').innerHTML =
      '<div class="atvwebplayersdk-ad-timer" style="display:none">Ad 0:30</div>';
  });
  await sleep(900);
  const s = await vstate(page);
  assert.equal(s.rate, 1);
  assert.equal(s.state, 'content');
  await page.close();
});

test('prime: text fallback ("Ad" + "1 of 2 · 0:30" spans, unknown class names)', async () => {
  const page = await openPage(PRIME_URL);
  await page.evaluate(() => {
    document.getElementById('overlay').innerHTML =
      '<div class="fu4rd6c"><span>Ad</span> <span>1 of 2 · 0:30</span></div>';
  });
  await waitFor(async () => (await vstate(page)).rate === 16, {
    msg: '16x via text'
  });
  await page.evaluate(() => {
    document.getElementById('overlay').innerHTML = '';
  });
  await waitFor(async () => (await vstate(page)).rate === 1, {
    msg: 'restored'
  });
  await page.close();
});

test('prime: subtitle-like text "Ad" / "Add 5:00" does not trigger', async () => {
  const page = await openPage(PRIME_URL);
  await page.evaluate(() => {
    document.getElementById('overlay').innerHTML =
      '<div class="subs"><span>Ad</span></div><div>Add 5:00 to the timer</div><div>Ads are boring</div>';
  });
  await sleep(900);
  assert.equal((await vstate(page)).rate, 1);
  await page.close();
});

test('prime: adtimeindicator variant of the ad timer is detected', async () => {
  const page = await openPage(PRIME_URL);
  await page.evaluate(() => {
    document.getElementById('overlay').innerHTML =
      '<div class="atvwebplayersdk-adtimeindicator-text">Ad 0:20</div>';
  });
  await waitFor(async () => (await vstate(page)).rate === 16, {
    msg: '16x via adtimeindicator'
  });
  await page.close();
});

test('prime: if the site resets speed mid-ad, it is re-applied', async () => {
  const page = await openPage(PRIME_URL);
  await page.evaluate(() => {
    document.getElementById('overlay').innerHTML =
      '<div class="atvwebplayersdk-ad-timer">Ad 0:30</div>';
  });
  await waitFor(async () => (await vstate(page)).rate === 16, { msg: '16x' });
  await page.evaluate(() => {
    document.getElementById('v').playbackRate = 1;
  });
  await waitFor(async () => (await vstate(page)).rate === 16, {
    timeout: 1500,
    msg: 're-applied 16x'
  });
  await page.close();
});

test('prime: separate ad <video> element (client-side ads) is sped up too', async () => {
  const page = await openPage(PRIME_URL);
  await page.evaluate(() => {
    const v2 = document.createElement('video');
    v2.id = 'v2';
    v2.src = '/test.webm';
    v2.autoplay = true;
    v2.style.width = '320px';
    document.querySelector('.webPlayerUIContainer').appendChild(v2);
    document.getElementById('overlay').innerHTML =
      '<div class="atvwebplayersdk-ad-timer">Ad 0:30</div>';
  });
  await waitFor(
    async () =>
      (await vstate(page, 'v2')).rate === 16 &&
      (await vstate(page, 'v')).rate === 16,
    { msg: 'both 16x' }
  );
  assert.equal((await vstate(page, 'v2')).muted, true);
  await page.close();
});

test('prime: ad skip button gets clicked', async () => {
  const page = await openPage(PRIME_URL);
  await page.evaluate(() => {
    window.skipClicks = 0;
    const o = document.getElementById('overlay');
    o.innerHTML =
      '<div class="atvwebplayersdk-ad-timer">Ad 0:30</div><button class="atvwebplayersdk-ad-skip-button">Skip</button>';
    o.querySelector('button').onclick = () => {
      window.skipClicks++;
      o.innerHTML = '';
    };
  });
  await waitFor(() => page.evaluate(() => window.skipClicks === 1), {
    msg: 'skip clicked'
  });
  await waitFor(async () => (await vstate(page)).rate === 1, {
    msg: 'restored after skip'
  });
  await page.close();
});

test('prime: stale timer outside the fullscreen player is ignored; the one inside counts', async () => {
  const page = await openPage(PRIME_URL);
  await page.evaluate(() => {
    document
      .querySelector('.webPlayerUIContainer')
      .classList.add('dv-player-fullscreen');
    const stale = document.createElement('div');
    stale.innerHTML =
      '<span class="atvwebplayersdk-ad-timer-remaining-time">0:12</span>';
    document.body.appendChild(stale);
  });
  await sleep(900);
  assert.equal((await vstate(page)).rate, 1, 'stale timer must not trigger');
  await page.evaluate(() => {
    document.getElementById('overlay').innerHTML =
      '<span class="atvwebplayersdk-ad-timer-remaining-time">0:12</span>';
  });
  await waitFor(async () => (await vstate(page)).rate === 16, {
    msg: '16x from fullscreen timer'
  });
  await page.close();
});

test('prime: empty ad-timer shell (no numbers) is ignored', async () => {
  const page = await openPage(PRIME_URL);
  await page.evaluate(() => {
    document.getElementById('overlay').innerHTML =
      '<div class="atvwebplayersdk-ad-timer"><span class="atvwebplayersdk-ad-timer-text"></span></div>';
  });
  await sleep(900);
  assert.equal((await vstate(page)).rate, 1);
  await page.close();
});

test('prime: text fallback inside fullscreen player', async () => {
  const page = await openPage(PRIME_URL);
  await page.evaluate(() => {
    document
      .querySelector('.webPlayerUIContainer')
      .classList.add('dv-player-fullscreen');
    document.getElementById('overlay').innerHTML =
      '<div class="xyz"><span>Ad</span><span>0:45</span></div>';
  });
  await waitFor(async () => (await vstate(page)).rate === 16, {
    msg: '16x via text in fullscreen'
  });
  await page.close();
});

test('prime: Amazon promo ("self ad") skip button gets clicked', async () => {
  const page = await openPage(PRIME_URL);
  await page.evaluate(() => {
    window.skipClicks = 0;
    const o = document.getElementById('overlay');
    o.innerHTML =
      '<div class="atvwebplayersdk-adtimeindicator-text">Ad 0:08</div><div class="fu4rd6c f1cw2swo">Skip</div>';
    o.querySelector('.f1cw2swo').onclick = () => {
      window.skipClicks++;
      o.innerHTML = '';
    };
  });
  await waitFor(() => page.evaluate(() => window.skipClicks === 1), {
    msg: 'promo skip clicked'
  });
  await page.close();
});

// ---------------- settings ----------------

test('settings: disabling mid-ad restores immediately; disabled = no action', async () => {
  const page = await openPage(PRIME_URL);
  await page.evaluate(() => {
    document.getElementById('overlay').innerHTML =
      '<div class="atvwebplayersdk-ad-timer">Ad 0:30</div>';
  });
  await waitFor(async () => (await vstate(page)).rate === 16, { msg: '16x' });
  await setSettings({ enabled: false });
  await waitFor(
    async () => {
      const s = await vstate(page);
      return s.rate === 1 && !s.muted;
    },
    { msg: 'restored on disable' }
  );
  await sleep(600);
  assert.equal((await vstate(page)).rate, 1, 'stays untouched while disabled');
  await page.close();
});

test('settings: custom speed 8x and mute off', async () => {
  await setSettings({ speed: 8, mute: false });
  const page = await openPage(PRIME_URL);
  await page.evaluate(() => {
    document.getElementById('overlay').innerHTML =
      '<div class="atvwebplayersdk-ad-timer">Ad 0:30</div>';
  });
  await waitFor(async () => (await vstate(page)).rate === 8, { msg: '8x' });
  assert.equal((await vstate(page)).muted, false);
  await page.close();
});

// ---------------- YouTube ----------------

test('youtube: ad-showing → 16x + muted, clicks Skip, then restores', async () => {
  const page = await openPage(YT_URL);
  await page.evaluate(() => {
    window.skipClicks = 0;
    document.getElementById('movie_player').classList.add('ad-showing');
  });
  await waitFor(
    async () => {
      const s = await vstate(page);
      return s.rate === 16 && s.muted;
    },
    { msg: '16x muted' }
  );
  // skip button appears a few seconds into the ad
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.className = 'ytp-skip-ad-button';
    b.textContent = 'Skip';
    b.onclick = () => {
      window.skipClicks++;
      document.getElementById('movie_player').classList.remove('ad-showing');
      b.remove();
    };
    document.getElementById('admod').appendChild(b);
  });
  await waitFor(() => page.evaluate(() => window.skipClicks === 1), {
    msg: 'skip clicked'
  });
  await waitFor(
    async () => {
      const s = await vstate(page);
      return s.rate === 1 && !s.muted && s.state === 'content';
    },
    { msg: 'restored' }
  );
  const stats = await waitFor(getStats, { msg: 'stats' });
  assert.equal(stats.skipsClicked, 1);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('youtube: user who was already muted stays muted after the ad', async () => {
  const page = await openPage(YT_URL);
  await page.evaluate(() => {
    document.getElementById('v').muted = true;
  });
  await page.evaluate(() =>
    document.getElementById('movie_player').classList.add('ad-showing')
  );
  await waitFor(async () => (await vstate(page)).rate === 16, { msg: '16x' });
  await page.evaluate(() =>
    document.getElementById('movie_player').classList.remove('ad-showing')
  );
  await waitFor(async () => (await vstate(page)).state === 'content', {
    msg: 'ad end'
  });
  assert.equal((await vstate(page)).muted, true);
  await page.close();
});

test("youtube: if the player sets its own speed at ad end, we don't clobber it", async () => {
  const page = await openPage(YT_URL);
  await page.evaluate(() =>
    document.getElementById('movie_player').classList.add('ad-showing')
  );
  await waitFor(async () => (await vstate(page)).rate === 16, { msg: '16x' });
  await page.evaluate(() => {
    document.getElementById('movie_player').classList.remove('ad-showing');
    document.getElementById('v').playbackRate = 1.75; // YouTube re-applying the viewer's preferred speed
  });
  await waitFor(async () => (await vstate(page)).state === 'content', {
    msg: 'ad end'
  });
  await sleep(500);
  assert.equal((await vstate(page)).rate, 1.75);
  await page.close();
});

test('youtube: ad-interrupting class (mid-roll) also detected', async () => {
  const page = await openPage(YT_URL);
  await page.evaluate(() =>
    document.getElementById('movie_player').classList.add('ad-interrupting')
  );
  await waitFor(async () => (await vstate(page)).rate === 16, { msg: '16x' });
  await page.close();
});

test('youtube: skip button that is visibility:hidden (countdown state) is still clicked', async () => {
  const page = await openPage(YT_URL);
  await page.evaluate(() => {
    window.skipClicks = 0;
    document.getElementById('movie_player').classList.add('ad-showing');
    const b = document.createElement('button');
    b.className = 'ytp-skip-ad-button';
    b.textContent = 'Skip';
    b.style.visibility = 'hidden';
    b.onclick = () => {
      window.skipClicks++;
    };
    document.getElementById('admod').appendChild(b);
  });
  await waitFor(() => page.evaluate(() => window.skipClicks >= 1), {
    msg: 'hidden skip clicked'
  });
  await page.close();
});

test('youtube: ads inside an embedded YouTube iframe on another site are handled', async () => {
  await ctx.route('https://news.example.net/**', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<h1>article</h1><iframe width=700 height=400 src="https://www.youtube.com/embed/mocktest"></iframe>'
    })
  );
  const page = await ctx.newPage();
  await page.goto('https://news.example.net/story');
  const frame = await waitFor(
    () => page.frames().find((f) => f.url().includes('/embed/')),
    { msg: 'iframe' }
  );
  await waitFor(
    () => frame.evaluate(() => document.documentElement.dataset.adSpeeder),
    { msg: 'script in iframe' }
  );
  await frame.evaluate(() =>
    document.getElementById('movie_player').classList.add('ad-showing')
  );
  await waitFor(
    () =>
      frame.evaluate(() => document.getElementById('v').playbackRate === 16),
    { msg: '16x in iframe' }
  );
  await frame.evaluate(() =>
    document.getElementById('movie_player').classList.remove('ad-showing')
  );
  await waitFor(
    () => frame.evaluate(() => document.getElementById('v').playbackRate === 1),
    { msg: 'restored in iframe' }
  );
  await page.close();
});

// ---------------- restoring the viewer's speed ----------------

const setRateIn = (page, rate) =>
  page.evaluate((r) => {
    document.getElementById('v').playbackRate = r;
  }, rate);
const ytAd = (page, on) =>
  page.evaluate((on) => {
    document.getElementById('movie_player').classList.toggle('ad-showing', on);
  }, on);

test('speed: player resets to 1x as the ad starts → viewer speed 1.5x restored after', async () => {
  const page = await openPage(YT_URL);
  await setRateIn(page, 1.5);
  await sleep(1500); // viewer has been watching at 1.5x
  // YouTube-style: speed dropped to 1x at the same moment the ad starts
  await page.evaluate(() => {
    document.getElementById('v').playbackRate = 1;
    document.getElementById('movie_player').classList.add('ad-showing');
  });
  await waitFor(async () => (await vstate(page)).rate === 16, { msg: '16x' });
  await ytAd(page, false);
  await waitFor(async () => (await vstate(page)).state === 'content', {
    msg: 'ad end'
  });
  await sleep(300);
  assert.equal((await vstate(page)).rate, 1.5);
  await page.close();
});

test('speed: player resets to 1x again just after the ad → 2x re-applied', async () => {
  const page = await openPage(YT_URL);
  await setRateIn(page, 2);
  await sleep(1500);
  await ytAd(page, true);
  await waitFor(async () => (await vstate(page)).rate === 16, { msg: '16x' });
  await ytAd(page, false);
  await waitFor(async () => (await vstate(page)).rate === 2, {
    msg: 'restored 2x'
  });
  await sleep(300);
  await setRateIn(page, 1); // site resets after our restore
  await waitFor(async () => (await vstate(page)).rate === 2, {
    timeout: 1500,
    msg: 're-applied 2x'
  });
  await page.close();
});

test("speed: viewer's own change to 1x after the ad is respected", async () => {
  const page = await openPage(YT_URL);
  await setRateIn(page, 1.5);
  await sleep(1500);
  await ytAd(page, true);
  await waitFor(async () => (await vstate(page)).rate === 16, { msg: '16x' });
  await ytAd(page, false);
  await waitFor(async () => (await vstate(page)).rate === 1.5, {
    msg: 'restored'
  });
  await sleep(2500); // past the post-ad window
  await setRateIn(page, 1);
  await sleep(800);
  assert.equal((await vstate(page)).rate, 1);
  await page.close();
});

test('speed: viewer at 1.25x who changed speed just before the ad gets 1.25x back', async () => {
  const page = await openPage(YT_URL);
  await sleep(1500); // stable at 1x first
  await setRateIn(page, 1.25); // then changes speed...
  await ytAd(page, true); // ...and an ad starts right away
  await waitFor(async () => (await vstate(page)).rate === 16, { msg: '16x' });
  await ytAd(page, false);
  await waitFor(async () => (await vstate(page)).state === 'content', {
    msg: 'ad end'
  });
  await sleep(300);
  assert.equal((await vstate(page)).rate, 1.25);
  await page.close();
});

test('speed: Prime Video, 1.75x viewer with a reset to 1x at ad start → 1.75x after', async () => {
  const page = await openPage(PRIME_URL);
  await setRateIn(page, 1.75);
  await sleep(1500);
  await page.evaluate(() => {
    document.getElementById('v').playbackRate = 1;
    document.getElementById('overlay').innerHTML =
      '<div class="atvwebplayersdk-ad-timer">Ad 0:30</div>';
  });
  await waitFor(async () => (await vstate(page)).rate === 16, { msg: '16x' });
  await page.evaluate(() => {
    document.getElementById('overlay').innerHTML = '';
  });
  await waitFor(async () => (await vstate(page)).rate === 1.75, {
    msg: '1.75x restored'
  });
  await page.close();
});

// ---------------- YouTube auto-skip ----------------

// Builds a skip button inside the mock ad module. `markup` is HTML whose clickable
// element carries data-skip; clicks are only "accepted" (ending the ad) when the
// button is actually visible, like YouTube ignoring clicks during the countdown.
async function addSkip(page, markup, { endAdOnClick = true } = {}) {
  await page.evaluate(
    ({ markup, endAdOnClick }) => {
      window.skipClicks = window.skipClicks || 0;
      window.earlyClicks = window.earlyClicks || 0;
      const wrap = document.createElement('div');
      wrap.innerHTML = markup;
      document.getElementById('admod').appendChild(wrap);
      const b = wrap.querySelector('[data-skip]');
      b.addEventListener('click', () => {
        const cs = getComputedStyle(b);
        if (
          cs.visibility === 'hidden' ||
          !b.checkVisibility({ visibilityProperty: true })
        ) {
          window.earlyClicks++;
          return;
        }
        window.skipClicks++;
        window.lastSkipAt = performance.now();
        if (endAdOnClick) {
          document
            .getElementById('movie_player')
            .classList.remove('ad-showing');
          wrap.remove();
        }
      });
    },
    { markup, endAdOnClick }
  );
}
const startAd = (page) =>
  page.evaluate(() => {
    window.skipClicks = 0;
    window.earlyClicks = 0;
    document.getElementById('movie_player').classList.add('ad-showing');
  });

const SKIP_VARIANTS = [
  [
    '.ytp-skip-ad-button (2024+)',
    '<button data-skip class="ytp-skip-ad-button">Skip</button>'
  ],
  [
    '.ytp-ad-skip-button (classic)',
    '<button data-skip class="ytp-ad-skip-button ytp-button"><div class="ytp-ad-text">Skip Ads</div></button>'
  ],
  [
    '.ytp-ad-skip-button-modern',
    '<button data-skip class="ytp-ad-skip-button-modern ytp-button">Skip</button>'
  ],
  [
    '.ytp-ad-skip-button-slot > button (container)',
    '<span class="ytp-ad-skip-button-slot"><span class="ytp-ad-skip-button-container"><button data-skip class="xyz123">Skip</button></span></span>'
  ],
  [
    '.ytp-skip-ad > button (container)',
    '<div class="ytp-skip-ad"><button data-skip class="abc">Skip</button></div>'
  ],
  [
    'button#skip-button:N',
    '<button data-skip id="skip-button:6">Skip</button>'
  ],
  [
    'aria-label="Skip ad" (unknown class)',
    '<button data-skip class="q9z" aria-label="Skip ad"><svg width="10" height="10"></svg></button>'
  ],
  [
    'text "Skip" in ad area (unknown class)',
    '<div class="ytp-ad-player-overlay-layout"><button data-skip class="totally-new-class">Skip</button></div>'
  ]
];
for (const [name, markup] of SKIP_VARIANTS) {
  test(`youtube skip: markup variant ${name}`, async () => {
    const page = await openPage(YT_URL);
    await startAd(page);
    await waitFor(async () => (await vstate(page)).rate === 16, { msg: '16x' });
    await addSkip(page, markup);
    await waitFor(() => page.evaluate(() => window.skipClicks === 1), {
      timeout: 2000,
      msg: `skip clicked (${name})`
    });
    await waitFor(
      async () => {
        const s = await vstate(page);
        return s.rate === 1 && !s.muted;
      },
      { msg: 'restored' }
    );
    await page.close();
  });
}

test('youtube skip: button hidden during countdown → clicked as soon as it appears (<300ms)', async () => {
  const page = await openPage(YT_URL);
  await startAd(page);
  await addSkip(
    page,
    '<div class="ytp-skip-ad"><button data-skip class="ytp-skip-ad-button" style="visibility:hidden">Skip</button></div>'
  );
  await sleep(1500); // countdown; extension may poke it (ignored), ad must still be running
  assert.equal(await page.evaluate(() => window.skipClicks), 0);
  assert.equal((await vstate(page)).state, 'ad');
  const shownAt = await page.evaluate(() => {
    document.querySelector('[data-skip]').style.visibility = 'visible';
    return performance.now();
  });
  await waitFor(() => page.evaluate(() => window.skipClicks === 1), {
    timeout: 2000,
    msg: 'clicked after countdown'
  });
  const latency = (await page.evaluate(() => window.lastSkipAt)) - shownAt;
  console.log(`    skip latency after countdown: ${latency.toFixed(0)}ms`);
  assert.ok(latency < 300, `latency ${latency}ms`);
  await page.close();
});

test('youtube skip: countdown container display:none → shown later is clicked quickly', async () => {
  const page = await openPage(YT_URL);
  await startAd(page);
  await addSkip(
    page,
    '<span class="ytp-ad-skip-button-slot" style="display:none"><button data-skip class="ytp-ad-skip-button-modern">Skip</button></span>'
  );
  await sleep(1200);
  assert.equal(
    await page.evaluate(() => window.skipClicks + window.earlyClicks),
    0,
    'no clicks while display:none'
  );
  const shownAt = await page.evaluate(() => {
    document.querySelector('.ytp-ad-skip-button-slot').style.display = '';
    return performance.now();
  });
  await waitFor(() => page.evaluate(() => window.skipClicks === 1), {
    timeout: 2000,
    msg: 'clicked'
  });
  const latency = (await page.evaluate(() => window.lastSkipAt)) - shownAt;
  console.log(
    `    skip latency after display:none → shown: ${latency.toFixed(0)}ms`
  );
  assert.ok(latency < 300, `latency ${latency}ms`);
  await page.close();
});

test('youtube skip: back-to-back ads reusing the same button element are both skipped', async () => {
  const page = await openPage(YT_URL);
  await startAd(page);
  // Ad 1 of 2 → skip → YouTube hides the button, loads ad 2 (player stays ad-showing),
  // shows the same button again after its countdown → skip → content.
  await page.evaluate(() => {
    window.skipClicks = 0;
    const slot = document.createElement('span');
    slot.className = 'ytp-ad-skip-button-slot';
    slot.innerHTML = '<button class="ytp-ad-skip-button-modern">Skip</button>';
    document.getElementById('admod').appendChild(slot);
    const b = slot.querySelector('button');
    b.addEventListener('click', () => {
      if (slot.style.display === 'none') return;
      window.skipClicks++;
      window.lastSkipAt = performance.now();
      slot.style.display = 'none';
      // ad 2's skip button: same element shown again shortly after (inside the 1s retry window)
      if (window.skipClicks === 1)
        setTimeout(() => {
          slot.style.display = '';
          window.reshownAt = performance.now();
        }, 300);
      else
        document.getElementById('movie_player').classList.remove('ad-showing');
    });
  });
  await waitFor(() => page.evaluate(() => window.skipClicks === 2), {
    timeout: 4000,
    msg: 'both ads skipped'
  });
  const latency = await page.evaluate(
    () => window.lastSkipAt - window.reshownAt
  );
  console.log(`    ad 2 skip latency (reused button): ${latency.toFixed(0)}ms`);
  assert.ok(latency < 300, `ad 2 latency ${latency}ms`);
  await waitFor(
    async () => {
      const s = await vstate(page);
      return s.state === 'content' && s.rate === 1 && !s.muted;
    },
    { msg: 'restored' }
  );
  const stats = await waitFor(getStats, { msg: 'stats' });
  assert.equal(stats.skipsClicked, 2);
  assert.equal(stats.adsHandled, 1, 'one ad break');
  await page.close();
});

test('youtube skip: back-to-back ads with a fresh button each time are both skipped', async () => {
  const page = await openPage(YT_URL);
  await startAd(page);
  await addSkip(
    page,
    '<button data-skip class="ytp-skip-ad-button">Skip</button>',
    { endAdOnClick: false }
  );
  await waitFor(() => page.evaluate(() => window.skipClicks === 1), {
    msg: 'ad 1 skipped'
  });
  await page.evaluate(() =>
    document.querySelector('[data-skip]').parentElement.remove()
  );
  await sleep(400);
  assert.equal(
    (await vstate(page)).rate,
    16,
    'still fast-forwarding between ads'
  );
  await addSkip(
    page,
    '<button data-skip class="ytp-skip-ad-button">Skip</button>'
  );
  await waitFor(() => page.evaluate(() => window.skipClicks === 2), {
    msg: 'ad 2 skipped'
  });
  await waitFor(async () => (await vstate(page)).state === 'content', {
    msg: 'ad break over'
  });
  await page.close();
});

test('youtube skip: unskippable ad (no button) falls back to 16x + mute for its whole length', async () => {
  const page = await openPage(YT_URL);
  await startAd(page);
  for (let i = 0; i < 4; i++) {
    await sleep(400);
    const s = await vstate(page);
    assert.equal(s.rate, 16);
    assert.equal(s.muted, true);
    assert.equal(s.state, 'ad');
  }
  await page.evaluate(() =>
    document.getElementById('movie_player').classList.remove('ad-showing')
  );
  await waitFor(
    async () => {
      const s = await vstate(page);
      return s.rate === 1 && !s.muted;
    },
    { msg: 'restored' }
  );
  const stats = await waitFor(getStats, { msg: 'stats' });
  assert.equal(stats.skipsClicked, 0);
  await page.close();
});

test('youtube skip: auto-skip turned off → no clicks, but ad still sped up', async () => {
  await setSettings({ autoSkip: false });
  const page = await openPage(YT_URL);
  await startAd(page);
  await addSkip(
    page,
    '<button data-skip class="ytp-skip-ad-button">Skip</button>'
  );
  await sleep(1200);
  assert.equal(
    await page.evaluate(() => window.skipClicks + window.earlyClicks),
    0
  );
  assert.equal((await vstate(page)).rate, 16);
  await page.close();
});

test('youtube skip: skip-looking buttons are never clicked when no ad is playing', async () => {
  const page = await openPage(YT_URL);
  await page.evaluate(() => {
    window.skipClicks = 0;
    window.earlyClicks = 0;
  });
  await addSkip(
    page,
    '<button data-skip class="ytp-skip-ad-button">Skip</button>'
  );
  await addSkip(
    page,
    '<div class="ytp-ad-player-overlay-layout"><button data-skip>Skip</button></div>'
  );
  await sleep(1200);
  assert.equal(
    await page.evaluate(() => window.skipClicks + window.earlyClicks),
    0
  );
  await page.close();
});

// ---------------- popup ----------------

// ---------------- humanized ads ----------------

// Records every playbackRate/volume/muted value the main video goes through, with a timestamp.
const recordRates = (page) =>
  page.evaluate(() => {
    const v = document.getElementById('v');
    window.rateLog = [];
    window.recStart = performance.now();
    const rec = () =>
      window.rateLog.push({
        t: performance.now() - window.recStart,
        rate: v.playbackRate,
        volume: v.volume,
        muted: v.muted
      });
    v.addEventListener('ratechange', rec);
    v.addEventListener('volumechange', rec);
  });
const rateLog = (page) => page.evaluate(() => window.rateLog);
const setForceSound = (mode) =>
  sw.evaluate((m) => chrome.storage.local.set({ forceSound: m }), mode);
test('humanize: on for YouTube by default, off for Prime Video and SonyLIV', async () => {
  await sw.evaluate(() => new Promise((r) => chrome.storage.sync.clear(r)));
  await setForceSound('mute');
  const page = await openPage(YT_URL);
  await recordRates(page);
  await ytAd(page, true);
  await waitFor(async () => (await vstate(page)).state === 'ad', { msg: 'ad' });
  await sleep(150);
  const r = (await vstate(page)).rate;
  assert.ok(r < 14, `YouTube ramps up instead of jumping to 16x (rate ${r})`);
  await ytAd(page, false);
  await page.close();

  const prime = await openPage(PRIME_URL);
  await prime.evaluate(() => {
    document.getElementById('overlay').innerHTML =
      '<div class="atvwebplayersdk-ad-timer">Ad 0:30</div>';
  });
  await waitFor(async () => (await vstate(prime)).rate === 16, {
    msg: 'Prime still goes straight to 16x'
  });
  assert.equal((await vstate(prime)).muted, true);
  await prime.close();
});

test('humanize: speed climbs in human-paced steps to a 14-16x peak, then stays within 10-16x', async () => {
  await setSettings({ humanize: { ...HUMANIZE_OFF, youtube: true } });
  await setForceSound('mute');
  const page = await openPage(YT_URL);
  await recordRates(page);
  await ytAd(page, true);
  await sleep(9000);
  const log = (await rateLog(page)).filter(
    (e, i, a) => i === 0 || e.rate !== a[i - 1].rate
  );
  const rates = log.map((e) => e.rate);
  console.log('    rates:', rates.join(' → '));
  const peakIdx = rates.findIndex((r) => r >= 14);
  assert.ok(peakIdx >= 3, 'at least 3 intermediate steps before 14x');
  const ramp = log.slice(0, peakIdx + 1);
  for (let i = 1; i < ramp.length; i++) {
    assert.ok(ramp[i].rate > ramp[i - 1].rate, 'ramp only goes up');
    assert.ok(
      ramp[i].rate - ramp[i - 1].rate <= 3.5 + 1e-9,
      'steps of at most 3.5x'
    );
  }
  for (let i = 2; i < ramp.length; i++) {
    const gap = ramp[i].t - ramp[i - 1].t;
    assert.ok(
      gap >= 100,
      `steps are human-paced, not instant (gap ${gap.toFixed(0)}ms)`
    );
  }
  const peak = ramp.at(-1);
  assert.ok(peak.rate >= 14 && peak.rate <= 16, `peak ${peak.rate}`);
  assert.ok(peak.t < 3000, `reaches the peak fast (${peak.t.toFixed(0)}ms)`);
  const after = log.slice(peakIdx + 1).map((e) => e.rate);
  assert.ok(after.length >= 1, 'speed drifts after the peak');
  for (const r of after)
    assert.ok(r >= 10 && r <= 16, `drift within 10-16x (${r})`);
  assert.equal((await vstate(page)).muted, true);

  await ytAd(page, false);
  await waitFor(
    async () => {
      const s = await vstate(page);
      return s.state === 'content' && s.rate === 1 && !s.muted;
    },
    { msg: 'restored' }
  );
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('humanize: volume mode turns the sound down to 1-10% instead of muting, then restores it', async () => {
  await setSettings({ humanize: { ...HUMANIZE_OFF, youtube: true } });
  await setForceSound('volume');
  const page = await openPage(YT_URL);
  await page.evaluate(() => {
    document.getElementById('v').volume = 0.8;
  });
  await ytAd(page, true);
  const vol = await waitFor(
    () =>
      page.evaluate(() => {
        const v = document.getElementById('v');
        return v.volume < 0.8 ? v.volume : 0;
      }),
    { msg: 'volume turned down' }
  );
  assert.ok(vol >= 0.01 && vol <= 0.1, `volume ${vol}`);
  assert.equal((await vstate(page)).muted, false, 'not muted in volume mode');
  await ytAd(page, false);
  await waitFor(
    () => page.evaluate(() => document.getElementById('v').volume === 0.8),
    { msg: 'volume restored to 80%' }
  );
  await page.close();
});

test('humanize: sound choice and peak vary between ads', async () => {
  await setSettings({ humanize: { ...HUMANIZE_OFF, youtube: true } });
  const page = await openPage(YT_URL);
  await page.evaluate(() => {
    document.getElementById('v').volume = 0.8;
  });
  const seen = { mute: 0, volume: 0 };
  const peaks = new Set();
  for (let i = 0; i < 8; i++) {
    await recordRates(page);
    await ytAd(page, true);
    await sleep(2600);
    const s = await page.evaluate(() => {
      const v = document.getElementById('v');
      return { muted: v.muted, volume: v.volume };
    });
    seen[s.muted ? 'mute' : 'volume']++;
    const log = await rateLog(page);
    peaks.add(Math.max(...log.map((e) => e.rate)));
    await ytAd(page, false);
    await waitFor(
      async () => {
        const st = await vstate(page);
        return st.state === 'content' && st.rate === 1 && !st.muted;
      },
      { msg: `restored after ad ${i + 1}` }
    );
    assert.equal(
      await page.evaluate(() => document.getElementById('v').volume),
      0.8
    );
  }
  console.log('    sound per ad:', seen, '| peaks:', [...peaks].join(', '));
  assert.ok(peaks.size >= 2, 'different peaks');
  // 8 fair coin flips all landing the same way: 1 in 128.
  assert.ok(
    seen.mute > 0 && seen.volume > 0,
    'both muting and turning down happen'
  );
  await page.close();
});

test('humanize: a site that resets the speed mid-ramp gets the planned speed back', async () => {
  await setSettings({ humanize: { ...HUMANIZE_OFF, youtube: true } });
  await setForceSound('mute');
  const page = await openPage(YT_URL);
  await ytAd(page, true);
  await waitFor(async () => (await vstate(page)).rate >= 14, {
    msg: 'at peak'
  });
  await page.evaluate(() => {
    document.getElementById('v').playbackRate = 1;
  });
  await waitFor(async () => (await vstate(page)).rate >= 10, {
    msg: 'planned speed re-applied'
  });
  await ytAd(page, false);
  await page.close();
});

test('popup: shows settings + stats, and changes are saved', async () => {
  await sw.evaluate(
    () =>
      new Promise((r) =>
        chrome.storage.local.set(
          { stats: { adsHandled: 3, secondsSaved: 425, skipsClicked: 2 } },
          r
        )
      )
  );
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/popup.html`);
  await waitFor(
    () =>
      page.evaluate(() => document.getElementById('ads').textContent === '3'),
    { msg: 'stats rendered' }
  );
  assert.equal(await page.textContent('#saved'), '7m 5s');
  assert.equal(await page.inputValue('#speed'), '16');
  assert.equal(await page.isChecked('#enabled'), true);
  assert.equal(await page.isChecked('#hz-youtube'), false); // beforeEach turned it off
  await page.check('#hz-sonyliv');
  await page.selectOption('#speed', '4');
  await page.uncheck('#mute');
  const s = await sw.evaluate(
    () => new Promise((r) => chrome.storage.sync.get(null, r))
  );
  assert.equal(s.speed, 4);
  assert.equal(s.mute, false);
  assert.deepEqual(s.humanize, {
    youtube: false,
    prime: false,
    sonyliv: true,
    hotstar: false
  });
  await page.click('#reset');
  await waitFor(
    () =>
      page.evaluate(() => document.getElementById('ads').textContent === '0'),
    { msg: 'reset' }
  );
  await page.screenshot({
    path: new URL('./popup.png', import.meta.url).pathname
  });
  await page.close();
});

test('privacy: without debug mode the page DOM gets no marker, even during an ad', async () => {
  await sw.evaluate(() => chrome.storage.local.set({ debug: false }));
  const page = await ctx.newPage();
  await page.goto(YT_URL);
  await waitFor(
    () => page.evaluate(() => !document.getElementById('v').paused),
    { msg: 'playing' }
  );
  await page.evaluate(() =>
    document.getElementById('movie_player').classList.add('ad-showing')
  );
  await waitFor(
    () => page.evaluate(() => document.getElementById('v').playbackRate === 16),
    { msg: '16x' }
  );
  assert.equal(
    await page.evaluate(() =>
      document.documentElement.getAttribute('data-ad-speeder')
    ),
    null
  );
  await page.close();
});

test('stats: concurrent ad-ends from several tabs are all counted', async () => {
  const pages = await Promise.all([
    openPage(YT_URL),
    openPage(YT_URL),
    openPage(YT_URL)
  ]);
  for (const p of pages)
    await p.evaluate(() =>
      document.getElementById('movie_player').classList.add('ad-showing')
    );
  for (const p of pages)
    await waitFor(async () => (await vstate(p)).state === 'ad', { msg: 'ad' });
  await Promise.all(
    pages.map((p) =>
      p.evaluate(() =>
        document.getElementById('movie_player').classList.remove('ad-showing')
      )
    )
  );
  await waitFor(async () => (await getStats())?.adsHandled === 3, {
    msg: '3 ads counted'
  });
  for (const p of pages) await p.close();
});

// ---------------- SonyLIV ----------------

// SonyLIV's CSS hides `.ad-layer-hidden`; the mock page has no stylesheet, so add it.
const sonylivPage = async () => {
  const page = await openPage(SONYLIV_URL);
  await page.addStyleTag({ content: '.ad-layer-hidden{display:none}' });
  await page.evaluate(() => {
    window.introClicks = 0;
    document.getElementById('skipintro').onclick = () => window.introClicks++;
  });
  return page;
};

test('sonyliv: no ad → video untouched, hidden IMA container ignored', async () => {
  const page = await sonylivPage();
  await page.evaluate(() => {
    const v = document.createElement('video');
    document.getElementById('adw').appendChild(v); // IMA keeps its <video> here between ads
  });
  await sleep(800);
  const s = await vstate(page);
  assert.equal(s.state, 'content');
  assert.equal(s.rate, 1);
  assert.equal(s.muted, false);
  await page.close();
});

test('sonyliv: IMA client-side ad → ad video 16x + muted, then content speed restored', async () => {
  const page = await sonylivPage();
  await page.evaluate(() => {
    document.getElementById('v').playbackRate = 1.5;
  });
  await sleep(1200); // let 1.5x register as the viewer's speed
  await page.evaluate(() => {
    const main = document.getElementById('v');
    main.pause(); // the player pauses content during client-side ads
    const w = document.getElementById('adw');
    const ad = document.createElement('video');
    ad.id = 'ad';
    ad.src = '/test.webm';
    ad.autoplay = true;
    ad.loop = true;
    ad.style.cssText = 'width:640px;height:360px';
    w.appendChild(ad);
    w.insertAdjacentHTML(
      'beforeend',
      '<div class="ad-label-container"><div class="ad-label-text">AD</div><span class="ad-label-timer"><span class="ad-timer-mm">00:</span><span class="ad-timer-ss">15</span></span></div>'
    );
    w.classList.remove('ad-layer-hidden');
  });
  await waitFor(async () => (await vstate(page, 'ad')).rate === 16, {
    msg: 'ad video 16x'
  });
  assert.equal((await vstate(page, 'ad')).muted, true);
  assert.equal((await vstate(page)).state, 'ad');
  assert.equal(await badgeFor(page), 'AD');

  await page.evaluate(() => {
    document.getElementById('adw').classList.add('ad-layer-hidden');
    document.getElementById('v').play();
  });
  await waitFor(async () => (await vstate(page)).state === 'content', {
    msg: 'ad ended'
  });
  const s = await vstate(page);
  assert.equal(s.rate, 1.5);
  assert.equal(s.muted, false);
  assert.equal(await page.evaluate(() => window.introClicks), 0);
  await page.close();
});

test('sonyliv: stitched (DAI) ad → content video 16x + muted, then 1.5x and sound back', async () => {
  const page = await sonylivPage();
  await page.evaluate(() => {
    document.getElementById('v').playbackRate = 1.5;
  });
  await sleep(1200);
  await page.evaluate(() =>
    document.getElementById('player-wrapper').classList.add('dai-ad-playing')
  );
  await waitFor(async () => (await vstate(page)).rate === 16, { msg: '16x' });
  assert.equal((await vstate(page)).muted, true);

  await page.evaluate(() =>
    document.getElementById('player-wrapper').classList.remove('dai-ad-playing')
  );
  await waitFor(async () => (await vstate(page)).state === 'content', {
    msg: 'ad ended'
  });
  const s = await vstate(page);
  assert.equal(s.rate, 1.5);
  assert.equal(s.muted, false);
  const stats = await waitFor(getStats, { msg: 'stats' });
  assert.equal(stats.adsHandled, 1);
  await page.close();
});

test('sonyliv: "Ads 1 of 2" label alone is detected', async () => {
  const page = await sonylivPage();
  await page.evaluate(() =>
    document
      .getElementById('player-wrapper')
      .insertAdjacentHTML(
        'beforeend',
        '<div class="ad-info-container"><div class="ad-position"><span class="ad-position__text">Ads </span> <span class="ad-position__value">1 of 2</span></div></div>'
      )
  );
  await waitFor(async () => (await vstate(page)).rate === 16, { msg: '16x' });
  await page.close();
});

test('sonyliv: "Skip Intro" is never clicked, during or outside ads', async () => {
  const page = await sonylivPage();
  await sleep(600);
  await page.evaluate(() =>
    document.getElementById('player-wrapper').classList.add('dai-ad-playing')
  );
  await waitFor(async () => (await vstate(page)).rate === 16, { msg: '16x' });
  await sleep(1500);
  assert.equal(await page.evaluate(() => window.introClicks), 0);
  assert.deepEqual(page.errors, []);
  await page.close();
});

// ---------------- Hotstar ----------------

const hotstarPage = async (url = HOTSTAR_URL) => {
  const page = await openPage(url);
  await page.evaluate(() => {
    window.upsellClicks = 0;
  });
  return page;
};
// Start a client-side ad the way Hotstar does: pause content, show the ad container.
const hotstarAdStart = (page) =>
  page.evaluate(() => {
    document.getElementById('v').pause();
    const c = document.createElement('div');
    c.id = 'ad-video-container';
    c.style.cssText = 'position:absolute;inset:0';
    c.innerHTML =
      '<video id="ad" src="/test.webm" autoplay loop playsinline style="width:640px;height:360px"></video>' +
      '<div class="ad-overlay"><span>Ad 1 of 2</span><button id="upsell">Go Ads free</button></div>';
    c.querySelector('#upsell').onclick = () => window.upsellClicks++;
    document.getElementById('player-root').appendChild(c);
  });
const hotstarAdEnd = (page) =>
  page.evaluate(() => {
    document.getElementById('ad-video-container').remove();
    document.getElementById('v').play();
  });

test('hotstar: no ad → video untouched, hidden ad container ignored', async () => {
  const page = await hotstarPage();
  await page.evaluate(() => {
    const c = document.createElement('div');
    c.id = 'ad-video-container';
    c.style.display = 'none';
    c.innerHTML = '<video src="/test.webm"></video>';
    document.getElementById('player-root').appendChild(c);
  });
  await sleep(800);
  const s = await vstate(page);
  assert.equal(s.state, 'content');
  assert.equal(s.rate, 1);
  assert.equal(s.muted, false);
  await page.close();
});

test('hotstar: client-side ad → ad video 16x + muted, then content speed restored', async () => {
  const page = await hotstarPage();
  await page.evaluate(() => {
    document.getElementById('v').playbackRate = 1.5;
  });
  await sleep(1200); // let 1.5x register as the viewer's speed
  await hotstarAdStart(page);
  await waitFor(async () => (await vstate(page, 'ad')).rate === 16, {
    msg: 'ad video 16x'
  });
  assert.equal((await vstate(page, 'ad')).muted, true);
  assert.equal((await vstate(page)).state, 'ad');
  assert.equal(await badgeFor(page), 'AD');
  await sleep(1500);
  assert.equal(
    await page.evaluate(() => window.upsellClicks),
    0,
    '"Go Ads free" never clicked'
  );

  await hotstarAdEnd(page);
  await waitFor(async () => (await vstate(page)).state === 'content', {
    msg: 'ad ended'
  });
  const s = await vstate(page);
  assert.equal(s.rate, 1.5);
  assert.equal(s.muted, false);
  const stats = await waitFor(getStats, { msg: 'stats' });
  assert.equal(stats.adsHandled, 1);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('hotstar: ad container left with an ended ad video is not an ad', async () => {
  const page = await hotstarPage();
  await hotstarAdStart(page);
  await waitFor(async () => (await vstate(page)).state === 'ad', { msg: 'ad' });
  const info = await page.evaluate(async () => {
    const ad = document.getElementById('ad');
    ad.loop = false;
    if (!Number.isFinite(ad.duration)) ad.currentTime = 1e9; // forces duration to resolve
    await new Promise((r) => setTimeout(r, 300));
    ad.currentTime = ad.duration;
    await new Promise((r) =>
      ad.ended ? r() : ad.addEventListener('ended', r, { once: true })
    );
    return { d: ad.duration, ended: ad.ended };
  });
  assert.ok(info.ended, JSON.stringify(info));
  await waitFor(async () => (await vstate(page)).state === 'content', {
    msg: 'ad ended'
  });
  await page.close();
});

test('hotstar: jiohotstar.com is covered too, and humanize can be turned on for it', async () => {
  await sw.evaluate(() =>
    chrome.storage.sync.set({
      humanize: { youtube: false, prime: false, sonyliv: false, hotstar: true }
    })
  );
  const page = await hotstarPage(JIOHOTSTAR_URL);
  await hotstarAdStart(page);
  await waitFor(async () => (await vstate(page)).state === 'ad', { msg: 'ad' });
  await waitFor(async () => (await vstate(page, 'ad')).rate >= 14, {
    msg: 'ramped to 14x+',
    timeout: 8000
  });
  await hotstarAdEnd(page);
  await waitFor(async () => (await vstate(page)).state === 'content', {
    msg: 'ad ended'
  });
  assert.equal((await vstate(page)).rate, 1);
  await page.close();
});

test('amazon.in is not injected (Prime Video in India plays on primevideo.com)', async () => {
  const page = await ctx.newPage();
  await page.goto(AMAZON_IN_URL);
  await sleep(800);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.dataset.adSpeeder ?? null
    ),
    null
  );
  await page.close();
});

test('non-video sites are not injected (e.g. example.com)', async () => {
  await ctx.route('https://example.com/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<p>hi</p>' })
  );
  const page = await ctx.newPage();
  await page.goto('https://example.com/');
  await sleep(500);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.dataset.adSpeeder ?? null
    ),
    null
  );
  await page.close();
});
