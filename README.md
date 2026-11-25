# Ad Speeder

A Chrome extension that gets you through video ads faster on YouTube, Prime Video, SonyLIV and Hotstar.

## Overview

While an ad is playing, Ad Speeder:

- plays it at 16× speed (Chrome's maximum) and mutes it,
- clicks **Skip** / **Skip ad** the moment the button appears (YouTube, and Amazon's own promo ads on Prime Video),
- then restores your previous speed and volume when the ad ends.

**Act human** (per site, on for YouTube by default): instead of jumping straight to 16× and muting, each ad gets its own random plan. The speed climbs from where it was in quick, irregular steps (about 120–300 ms apart) to a random 14–16× peak, then drifts between 10× and 16× every few seconds. The sound is either muted or turned down to a random 1–10% volume. The ranges scale with the chosen ad speed. It makes the extension's behaviour less uniform; it doesn't make it undetectable.

Unskippable ads simply fly by at 16×. The toolbar icon shows a red **AD** badge while an ad is being fast-forwarded. The popup lets you turn it on/off, choose the ad speed (2/4/8/16×), toggle muting, auto-skip and Act human per site, and see how much time you've saved.

It runs only on `youtube.com` (including YouTube videos embedded on other sites), `primevideo.com`, `www.sonyliv.com` and `www.hotstar.com` / `www.jiohotstar.com`. It collects no data and makes no network requests. See the [privacy policy](PRIVACY.md).

## Implementation Notes

- **Manifest V3**, one permission (`storage`). Site access comes only from the content-script `matches` in [`manifest.json`](extension/manifest.json); there are no `host_permissions`, no `scripting`, and no remote code.
- **YouTube detection:** the player element gets the `ad-showing` / `ad-interrupting` class during ads. Skip buttons are matched across YouTube's markup variants (`.ytp-skip-ad-button`, `.ytp-ad-skip-button`, `.ytp-ad-skip-button-modern`, the slot/container wrappers, `button#skip-button:N`, `aria-label="Skip ad"`, plus a "Skip" text fallback inside the ad overlay). A skip button is clicked within a frame of becoming visible, including after the countdown and for each ad in a back-to-back pod.
- **Prime Video detection:** a visible `atvwebplayersdk-ad-timer*` / `adtimeindicator` element that shows a number, preferring the one inside `.dv-player-fullscreen`, with an "Ad 0:25" / "Ad 1 of 2" text fallback.
- **SonyLIV detection:** the IMA ad container `.ad-wrapper` loses its `ad-layer-hidden` class while a client-side ad plays (its own ad `<video>` is sped up), the player wrapper gets `dai-ad-playing` during stitched ads, and the player's "AD 0:15" / "Ads 1 of 2" label (`.ad-label-container`, `.ad-info-container`) is a fallback. SonyLIV turns off IMA's ad UI and has no Skip-ad button, so ads are sped up and muted, not skipped; its "Skip Intro" button is never touched.
- **Hotstar detection:** client-side ads play in their own `<video>` inside `#ad-video-container`, over the paused content; while that container and its ad video are visible and not ended, the ad video is sped up and muted. The ad overlay's only button is the "Go Ads free" upsell, which is never clicked. Live streams (e.g. cricket) stitch ads into the stream with nothing in the page to mark them, so those are left alone.
- **Restoring playback:** after the ad, the video goes back to the speed you were watching at (e.g. 1.5×), not 1×. Your speed is remembered once it has held for a second outside an ad, so YouTube resetting to 1× as an ad begins doesn't overwrite it; if the player resets to 1× again within 2 seconds after the ad, your speed is re-applied. Any other speed the site or you pick after the ad is left alone.
- **Service worker** ([`background.js`](extension/background.js)) only sets the badge and updates local stats; it keeps no state in globals, so Chrome can stop and restart it at any time.
- **No page fingerprint:** nothing is written into the page's DOM. (A `debug` flag in `chrome.storage.local`, used by the tests, exposes `<html data-ad-speeder>`.)
- Lint/format follow the [chrome-extensions-samples](https://github.com/GoogleChrome/chrome-extensions-samples) config (ESLint recommended + Prettier).

## Running this extension

1. Clone this repository.
2. Load the [`extension/`](extension/) directory in Chrome as an [unpacked extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).
3. Pin the ⏩ icon, then play a YouTube video or Prime Video title that has ads.

### Tests

```sh
npm install
npx playwright install chromium
npm test                       # end-to-end tests: real extension in Chromium on mock YouTube/Prime pages
npm run lint                   # ESLint + Prettier check
npm run test:live-youtube      # real youtube.com, waits for real ads (needs a home/residential IP)
npm run test:live-youtube-dom  # real youtube.com player, simulated ad state + skip scenarios
npm run test:live-prime        # real primevideo.com smoke test (no login needed)
npm run test:live-sonyliv      # real sonyliv.com: injection + player still uses the ad class names
npm run test:live-hotstar      # real hotstar.com + jiohotstar.com: content script injects cleanly
npm run package                # builds ad-speeder.zip for the Chrome Web Store
```

### Publishing updates

The listing text, privacy answers and store images are in [`store/`](store/) ([`store/listing.md`](store/listing.md); regenerate images with `npm run assets`).

To ship a new version:

1. Bump `version` in [`extension/manifest.json`](extension/manifest.json).
2. Run `npm run publish`. It lints, runs the tests, builds `ad-speeder.zip`, then uploads and submits it for review through the Chrome Web Store API.

This needs a `.env` with the API credentials (see [`.env.example`](.env.example) and [this key guide](https://github.com/fregante/chrome-webstore-upload-keys)).

### Known limits

- YouTube and Prime Video change their page markup from time to time. If ads stop being detected, the selectors live at the top of [`content.js`](extension/content.js).
- Some Prime ads are stitched into the main stream; at 16× they can briefly buffer. Pick 8× in the popup if that happens.
- The extension's skip clicks are synthetic (`isTrusted: false`). If YouTube starts ignoring them, ads still play at 16× and muted.

Not affiliated with, endorsed by, or sponsored by Google, YouTube, Amazon or Sony.
