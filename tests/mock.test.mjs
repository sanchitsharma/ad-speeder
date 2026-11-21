// End-to-end tests of the real extension in Chromium against mock Prime Video /
// YouTube pages. Pages are served at the real hostnames (via request routing) so
// the manifest's content-script matching is exercised too.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, VIDEO, waitFor, sleep, enableDebug } from './helpers.mjs';

const PRIME_URL = 'https://www.primevideo.com/detail/mock-test';
const AMAZON_IN_URL = 'https://www.amazon.in/gp/video/detail/mock-test';
const YT_URL = 'https://www.youtube.com/watch?v=mocktest';

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

test('prime: works on amazon.in/gp/video too', async () => {
  const page = await openPage(AMAZON_IN_URL);
  await page.evaluate(() => {
    document.getElementById('overlay').innerHTML =
      '<div class="atvwebplayersdk-adtimeindicator-text">Ad 0:20</div>';
  });
  await waitFor(async () => (await vstate(page)).rate === 16, {
    msg: '16x on amazon.in'
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
  await page.selectOption('#speed', '4');
  await page.uncheck('#mute');
  const s = await sw.evaluate(
    () => new Promise((r) => chrome.storage.sync.get(null, r))
  );
  assert.equal(s.speed, 4);
  assert.equal(s.mute, false);
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
