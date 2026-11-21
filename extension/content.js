// Ad Speeder content script.
// Detects when an ad is playing (Prime Video / YouTube), fast-forwards and mutes
// the video while the ad runs, then restores the viewer's previous speed/volume.
(() => {
  'use strict';
  if (window.__adSpeederLoaded) return;
  window.__adSpeederLoaded = true;

  const SITE = /(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)
    ? 'youtube'
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

  // ---------- generic ----------
  const detectAd = SITE === 'youtube' ? ytIsAd : primeIsAd;
  const videos = () => {
    const root = SITE === 'youtube' ? ytPlayer() || document : document;
    return [...root.querySelectorAll('video')];
  };
  const skipSelectors =
    SITE === 'youtube' ? YT_SKIP_SELECTORS : PRIME_SKIP_SELECTORS;

  function speedUp(v) {
    let s = saved.get(v);
    if (!s) {
      s = {
        rate: v.playbackRate,
        muted: v.muted,
        setRate: null,
        didMute: false
      };
      // If we somehow captured our own speed (e.g. stale state), fall back to 1x.
      if (s.rate >= MAX_RATE) s.rate = 1;
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
    for (const [v, s] of saved) {
      if (!v.isConnected) continue;
      // Only undo what we did: if the site/user changed the rate since, leave it alone.
      if (s.setRate !== null && v.playbackRate === s.setRate) {
        try {
          v.playbackRate = s.rate;
        } catch {
          /* ignore */
        }
      }
      if (s.didMute && v.muted) v.muted = s.muted;
    }
    saved.clear();
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
    } else if (debug && !document.documentElement.dataset.adSpeeder) {
      mark('content');
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
  // Sites sometimes reset playbackRate during an ad; re-apply immediately.
  document.addEventListener(
    'ratechange',
    () => {
      if (inAd) schedule();
    },
    true
  );
  LOG('loaded on', SITE);
})();
