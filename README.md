# Ad Speeder

A Chrome extension that gets you through video ads faster on YouTube and Prime Video.

## Overview

While an ad is playing, Ad Speeder:

- plays it at 16× speed (Chrome's maximum) and mutes it,
- clicks **Skip** / **Skip ad** the moment the button appears (YouTube, and Amazon's own promo ads on Prime Video),
- then restores your previous speed and volume when the ad ends.

Unskippable ads simply fly by at 16×. The toolbar icon shows a red **AD** badge while an ad is being fast-forwarded. The popup lets you turn it on/off, choose the ad speed (2/4/8/16×), toggle muting and auto-skip, and see how much time you've saved.

It runs only on `youtube.com` (including YouTube videos embedded on other sites) and `primevideo.com`. It collects no data and makes no network requests. See the [privacy policy](PRIVACY.md).

## Implementation Notes

- **Manifest V3**, one permission (`storage`). Site access comes only from the content-script `matches` in [`manifest.json`](extension/manifest.json); there are no `host_permissions`, no `scripting`, and no remote code.
- **YouTube detection:** the player element gets the `ad-showing` / `ad-interrupting` class during ads. Skip buttons are matched across YouTube's markup variants (`.ytp-skip-ad-button`, `.ytp-ad-skip-button`, `.ytp-ad-skip-button-modern`, the slot/container wrappers, `button#skip-button:N`, `aria-label="Skip ad"`, plus a "Skip" text fallback inside the ad overlay). A skip button is clicked within a frame of becoming visible, including after the countdown and for each ad in a back-to-back pod.
- **Prime Video detection:** a visible `atvwebplayersdk-ad-timer*` / `adtimeindicator` element that shows a number, preferring the one inside `.dv-player-fullscreen`, with an "Ad 0:25" / "Ad 1 of 2" text fallback.
- **Restoring playback:** it only undoes what it changed. If the site or the viewer changes the speed during or after the ad, that change is kept.
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

Not affiliated with, endorsed by, or sponsored by Google, YouTube or Amazon.
