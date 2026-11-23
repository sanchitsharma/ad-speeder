// Ad Speeder content script.
// Detects when an ad is playing (Prime Video / YouTube / SonyLIV), fast-forwards and mutes
// the video while the ad runs, then restores the viewer's previous speed/volume.
(() => {
  'use strict';
  if (window.__adSpeederLoaded) return;
  window.__adSpeederLoaded = true;

  const SITE = /(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)
    ? 'youtube'
    : /(^|\.)sonyliv\.com$/.test(location.hostname)
      ? 'sonyliv'
      : 'prime';
  const DEFAULTS = { enabled: true, speed: 16, mute: true, autoSkip: true };
  const MAX_RATE = 16; // Chrome throws above 16x
  const LOG = (...a) => console.debug('[AdSpeeder]', ...a);

  let settings = { ...DEFAULTS };
  // Debug mode (chrome.storage.local {debug: true}, used by the test suite) exposes
  // the state as <html data-ad-speeder="ad|content">. Off by default so pages
  // can't use it to detect the extension.
  let debug = false;
  const mark = (state) => {
    if (debug) document.documentElement.dataset.adSpeeder = state;
  };
  let inAd = false;
  let adStartedAt = 0;
  let skipsThisAd = 0;
  // video element -> { rate, muted, setRate, didMute } captured when the ad started
  const saved = new Map();

  // The viewer's own playback speed outside ads. A rate only counts once it has
  // held for STABLE_MS outside an ad, so a site's brief reset to 1x as an ad
  // begins (YouTube does this) isn't mistaken for the viewer's choice.
  const STABLE_MS = 1000;
  // After an ad, keep re-applying the viewer's speed for this long if the site
  // resets it to 1x (or leaves our ad speed) again.
  const POST_AD_GUARD_MS = 2000;
  let viewerRate = null;
  let candidate = { rate: null, since: 0 };
  let guard = null; // { until, rate, videos: Set<HTMLVideoElement> }

  // ---------- helpers ----------
  const isVisible = (el) => {
    if (!el || !el.isConnected) return false;
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true }))
      return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // ---------- Prime Video ----------
  const PRIME_AD_SELECTORS = [
    '.atvwebplayersdk-ad-timer',
    '.atvwebplayersdk-ad-timer-text',
    '.atvwebplayersdk-ad-timer-remaining-time',
    '.atvwebplayersdk-adtimeindicator-text',
    '[class*="adtimeindicator"]',
    '[class*="ad-timer"]',
    '[class*="AdTimer"]',
    '[data-testid*="ad-timer"]'
  ];
  const PRIME_PLAYER_ROOTS = [
    '#dv-web-player',
    '.webPlayerSDKContainer',
    '.webPlayerUIContainer',
    '.atvwebplayersdk-overlays-container'
  ];
  const PRIME_SKIP_SELECTORS = [
    '.atvwebplayersdk-ad-skip-button',
    '[class*="adSkip"]',
    '[class*="ad-skip"]',
    '[data-testid*="ad-skip"]',
    '.fu4rd6c.f1cw2swo' // "Skip" on Amazon's own promo ads (obfuscated class, may change)
  ];
  // "Ad 0:25", "Ad 1 of 2", "Ad 1 of 2 · 0:25", "Ads · 1:05"
  const AD_TEXT_RE =
    /^ads?(\s*\(?\d+\s*(of|\/)\s*\d+\)?)?(\s*[·•|:\-–]?\s*\d{1,2}:\d{2})?$/i;
  const AD_TEXT_STRONG = /(\d+\s*(of|\/)\s*\d+)|(\d{1,2}:\d{2})/;

  function primeAdTextVisible(scope = document) {
    const roots =
      scope === document
        ? scope.querySelectorAll(PRIME_PLAYER_ROOTS.join(','))
        : [scope];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const t = n.data.trim();
        if (!t || t.length > 30) continue;
        // Check the text node plus up to 2 ancestors' combined text
        // ("Ad" and "1 of 2 · 0:25" often live in sibling spans).
        let el = n.parentElement;
        const candidates = [[t, el]];
        for (
          let i = 0;
          i < 2 && el && el !== root;
          i++, el = el.parentElement
        ) {
          candidates.push([el.textContent.replace(/\s+/g, ' ').trim(), el]);
        }
        for (const [c, owner] of candidates) {
          if (
            c &&
            c.length <= 30 &&
            AD_TEXT_RE.test(c) &&
            AD_TEXT_STRONG.test(c) &&
            isVisible(owner)
          )
            return true;
        }
      }
    }
    return false;
  }

  // Prime can keep several ad-timer nodes in the DOM; when the fullscreen player
  // exists, only trust the ones inside it, and require the timer to show a number.
  function primeIsAd() {
    if (!document.querySelector('video')) return false;
    const root = document.querySelector('.dv-player-fullscreen') || document;
    for (const el of root.querySelectorAll(PRIME_AD_SELECTORS.join(','))) {
      if (/\d/.test(el.textContent) && isVisible(el)) return true;
    }
    return primeAdTextVisible(root);
  }

  // ---------- YouTube ----------
  // YouTube has shipped several skip-button markups; match all of them. Selectors may
  // hit a container rather than the button itself; resolveButton() handles that.
  const YT_SKIP_SELECTORS = [
    '.ytp-skip-ad-button', // 2024+ player
    '.ytp-ad-skip-button', // classic
    '.ytp-ad-skip-button-modern', // 2023 "modern" variant
    '.ytp-ad-skip-button-slot', // container around the button
    '.ytp-ad-skip-button-container', // older container
    '.ytp-skip-ad', // container in the 2024+ player
    '.videoAdUiSkipButton', // legacy / embeds
    'button[id^="skip-button"]',
    'button[class*="skip-ad-button"]',
    'button[class*="ad-skip-button"]',
    'button[aria-label^="Skip ad" i]',
    'button[aria-label^="Skip ads" i]',
    '.ytp-ad-overlay-close-button' // banner overlay ads
  ];
  // Text fallback for unknown markup: "Skip", "Skip ad", "Skip ads" (also "Skip Ad ▶").
  const YT_SKIP_TEXT_RE = /^skip( ads?)?\b/i;
  const YT_AD_AREAS =
    '.video-ads, .ytp-ad-module, .ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, [class*="ytp-ad-"]';
  const ytPlayer = () =>
    document.querySelector('#movie_player') ||
    document.querySelector('.html5-video-player');

  function ytIsAd() {
    const p = ytPlayer();
    return (
      !!p &&
      (p.classList.contains('ad-showing') ||
        p.classList.contains('ad-interrupting'))
    );
  }

  // ---------- SonyLIV ----------
  // SonyLIV's player (player.sonyliv.com sp-player-web) plays ads two ways:
  // - client-side IMA ads: the ad <video> lives in `.ad-wrapper`, which carries
  //   `ad-layer-hidden` except while an ad is showing;
  // - stitched (DAI) ads: the player wrapper gets the `dai-ad-playing` class.
  // Both show the player's own "AD 0:15" / "Ads 1 of 2" label. IMA's UI (and its
  // Skip button) is turned off by the player, so there is no skip button to click;
  // the player's `.skip-button` is "Skip Intro" / "Skip Recap" and must not be clicked.
  const SONYLIV_AD_LABELS = '.ad-label-container, .ad-info-container';
  function sonylivIsAd() {
    if (document.querySelector('.dai-ad-playing')) return true;
    for (const w of document.querySelectorAll(
      '.ad-wrapper:not(.ad-layer-hidden):not(.ad-wrapper-tv)'
    )) {
      if (isVisible(w) && w.querySelector('video')) return true;
    }
    for (const el of document.querySelectorAll(SONYLIV_AD_LABELS)) {
      if (isVisible(el)) return true;
    }
    return false;
  }

  // ---------- generic ----------
  const detectAd =
    SITE === 'youtube' ? ytIsAd : SITE === 'sonyliv' ? sonylivIsAd : primeIsAd;
  const videos = () => {
    const root = SITE === 'youtube' ? ytPlayer() || document : document;
    return [...root.querySelectorAll('video')];
  };
  const skipSelectors =
    SITE === 'youtube'
      ? YT_SKIP_SELECTORS
      : SITE === 'prime'
        ? PRIME_SKIP_SELECTORS
        : [];

  // The speed to return to after the ad, decided when the ad starts.
  function speedToRestore(current) {
    // Our own ad speed left over (stale state): use the viewer's speed, else 1x.
    if (current >= MAX_RATE) return viewerRate ?? 1;
    // 1x right as the ad starts is usually the site resetting the speed for the
    // ad, not the viewer: go back to the speed they were actually watching at.
    if (current === 1 && viewerRate !== null) return viewerRate;
    return current;
  }

  function mainVideo() {
    let best = null;
    let bestArea = 0;
    for (const v of videos()) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) {
        best = v;
        bestArea = area;
      }
    }
    return best;
  }

  // Record a speed observation. When the speed changes, the previous speed is
  // locked in as the viewer's speed if it had held for STABLE_MS: done at the
  // moment of change, so a site's reset to 1x can never pre-empt it.
  function noteRate(rate, now = performance.now()) {
    if (rate === candidate.rate) {
      if (now - candidate.since >= STABLE_MS && rate < MAX_RATE)
        viewerRate = rate;
      return;
    }
    if (
      candidate.rate !== null &&
      candidate.rate < MAX_RATE &&
      now - candidate.since >= STABLE_MS
    )
      viewerRate = candidate.rate;
    candidate = { rate, since: now };
  }

  function trackViewerRate() {
    const v = mainVideo();
    if (v) noteRate(v.playbackRate);
  }

  const setRate = (v, rate) => {
    if (v.playbackRate === rate) return;
    try {
      v.playbackRate = rate;
    } catch {
      /* ignore */
    }
  };

  // During the post-ad window, undo a site's reset to 1x (or to our ad speed);
  // any other speed is someone's deliberate choice, so stop guarding.
  function enforceGuard(v) {
    if (!guard || inAd || !guard.videos.has(v)) return;
    if (performance.now() > guard.until) {
      guard = null;
      return;
    }
    const rate = v.playbackRate;
    if (rate === guard.rate) return;
    if (rate === 1 || rate >= MAX_RATE) setRate(v, guard.rate);
    else guard = null;
  }

  function speedUp(v) {
    let s = saved.get(v);
    if (!s) {
      s = {
        rate: speedToRestore(v.playbackRate),
        muted: v.muted,
        setRate: null,
        didMute: false
      };
      saved.set(v, s);
    }
    const target = Math.max(
      1,
      Math.min(Number(settings.speed) || 16, MAX_RATE)
    );
    if (v.playbackRate !== target) {
      try {
        v.playbackRate = target;
      } catch {
        /* ignore */
      }
    }
    s.setRate = target;
    if (settings.mute && !v.muted) {
      v.muted = true;
      s.didMute = true;
    }
    if (!settings.mute && s.didMute && v.muted) {
      v.muted = false;
      s.didMute = false;
    }
  }

  function restoreAll() {
    const restored = new Set();
    let guardRate = null;
    for (const [v, s] of saved) {
      if (!v.isConnected) continue;
      const cur = v.playbackRate;
      // Put the viewer's speed back if the video is still at our ad speed, or if
      // the site reset it to 1x. Any other speed was chosen by the site/viewer
      // after the ad, so leave it alone.
      if (
        (s.setRate !== null && cur === s.setRate) ||
        (cur === 1 && s.rate !== 1)
      ) {
        setRate(v, s.rate);
      }
      if (s.didMute && v.muted) v.muted = s.muted;
      restored.add(v);
      guardRate = s.rate;
    }
    saved.clear();
    if (restored.size && guardRate !== null) {
      guard = {
        until: performance.now() + POST_AD_GUARD_MS,
        rate: guardRate,
        videos: restored
      };
    }
  }

  // ---------- skip buttons ----------
  const hasLayout = (el) => {
    if (!el || !el.isConnected || getComputedStyle(el).display === 'none')
      return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const resolveButton = (el) =>
    el.matches('button, [role="button"]')
      ? el
      : el.querySelector('button, [role="button"]') || el;

  function skipCandidates() {
    const root = SITE === 'youtube' ? ytPlayer() || document : document;
    const found = new Set();
    if (!skipSelectors.length) return found;
    for (const el of root.querySelectorAll(skipSelectors.join(',')))
      found.add(resolveButton(el));
    if (SITE === 'youtube') {
      for (const area of root.querySelectorAll(YT_AD_AREAS)) {
        for (const b of area.querySelectorAll('button, [role="button"]')) {
          const label = (
            b.getAttribute('aria-label') ||
            b.textContent ||
            ''
          ).trim();
          if (YT_SKIP_TEXT_RE.test(label)) found.add(b);
        }
      }
    }
    return found;
  }

  function press(el) {
    const o = { bubbles: true, cancelable: true, composed: true, view: window };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', o));
      el.dispatchEvent(new MouseEvent('mousedown', o));
      el.dispatchEvent(new PointerEvent('pointerup', o));
      el.dispatchEvent(new MouseEvent('mouseup', o));
    } catch {
      /* ignore */
    }
    el.click();
  }

  // Per-button state: was it visible last time we looked, and when did we last click it.
  // - becomes visible (countdown over, or the next ad in a back-to-back pod reuses the
  //   same element)  -> click immediately, no throttle
  // - present but hidden (YouTube's countdown state; early clicks are ignored by the
  //   player) or visible but not reacting -> retry at most once per second
  const skipState = new WeakMap();
  function trySkip() {
    const now = performance.now();
    for (const btn of skipCandidates()) {
      const visible = isVisible(btn);
      // Prime only gets clicked when fully visible; YouTube also when merely laid out.
      if (!visible && (SITE !== 'youtube' || !hasLayout(btn))) {
        const st = skipState.get(btn);
        if (st) st.visible = false;
        continue;
      }
      const st = skipState.get(btn) || { visible: false, last: -Infinity };
      const becameVisible = visible && !st.visible;
      st.visible = visible;
      skipState.set(btn, st);
      if (!becameVisible && now - st.last < 1000) continue;
      st.last = now;
      LOG(
        'clicking skip',
        visible ? '(visible)' : '(countdown)',
        btn.className || btn.id
      );
      press(btn);
      if (becameVisible) skipsThisAd++; // count once per appearance, not per retry
    }
  }

  // Fast path: check for a skip button on the next frame after any DOM change,
  // rather than waiting for the 100 ms debounce / 400 ms interval.
  let skipFrame = 0;
  const scheduleSkip = () => {
    if (skipFrame || !inAd || !settings.enabled || !settings.autoSkip) return;
    skipFrame = requestAnimationFrame(() => {
      skipFrame = 0;
      if (inAd) trySkip();
    });
  };

  function report(adOn, extra = {}) {
    mark(adOn ? 'ad' : 'content');
    try {
      chrome.runtime
        .sendMessage({ type: 'ad-state', inAd: adOn, site: SITE, ...extra })
        .catch(() => {}); // no reply expected; ignore "port closed" / SW restarting
    } catch {
      // Extension was reloaded/updated: this old content script is orphaned.
    }
  }

  function tick() {
    const ad = settings.enabled && detectAd();
    if (ad) {
      if (!inAd) {
        inAd = true;
        adStartedAt = performance.now();
        skipsThisAd = 0;
        LOG('ad started');
        report(true);
      }
      videos().forEach(speedUp);
      if (settings.autoSkip) trySkip();
    } else if (inAd) {
      inAd = false;
      restoreAll();
      const secs = (performance.now() - adStartedAt) / 1000;
      LOG('ad ended after', secs.toFixed(1), 's');
      report(false, {
        adSeconds: secs,
        speed: Math.min(settings.speed, MAX_RATE),
        skips: skipsThisAd
      });
    } else {
      if (guard) videos().forEach(enforceGuard);
      else if (settings.enabled) trackViewerRate();
      if (debug && !document.documentElement.dataset.adSpeeder) mark('content');
    }
  }

  // ---------- wiring ----------
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      tick();
    }, 100);
  };

  Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    chrome.storage.local.get({ debug: false })
  ]).then(([synced, local]) => {
    settings = { ...DEFAULTS, ...synced };
    debug = !!local.debug;
    tick();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.debug) debug = !!changes.debug.newValue;
    if (area !== 'sync') return;
    for (const [k, { newValue }] of Object.entries(changes))
      settings[k] = newValue ?? DEFAULTS[k];
    tick();
  });

  new MutationObserver(() => {
    scheduleSkip();
    schedule();
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden']
  });
  setInterval(tick, 400);
  // Sites sometimes reset playbackRate during or right after an ad; react
  // immediately rather than on the next tick.
  document.addEventListener(
    'ratechange',
    (e) => {
      if (inAd) schedule();
      else if (guard && e.target instanceof HTMLVideoElement)
        enforceGuard(e.target);
      else if (settings.enabled && e.target === mainVideo())
        noteRate(e.target.playbackRate);
    },
    true
  );
  LOG('loaded on', SITE);
})();
