# Chrome Web Store submission kit: Ad Speeder

Everything to paste into the developer dashboard (<https://chrome.google.com/webstore/devconsole>), tab by tab.
Upload file: `ad-speeder.zip` (built by `npm run package`).

---

## Tab: Store listing

**Name** (from the manifest; can't be edited here): `Ad Speeder`

**Summary** (from the manifest description, 132 characters max):
> Fast-forwards and mutes video ads on Prime Video and YouTube, clicks Skip when it appears, then restores normal playback.

**Description:**

```
Ad Speeder gets you through video ads faster on YouTube and Prime Video, automatically.

WHAT IT DOES
• Plays ads at 16× speed (or 2×, 4×, 8×, your choice) and mutes them
• Clicks "Skip" / "Skip ad" the moment it appears, including right after the countdown and for back-to-back ads
• Unskippable ads fly by in a couple of seconds
• Restores your normal playback speed and sound as soon as the ad ends
• A red "AD" badge on the toolbar icon shows when an ad is being sped up
• Tracks how many ads it handled and how much time you've saved

WHERE IT WORKS
• youtube.com, including YouTube videos embedded on other websites
• primevideo.com (Prime Video)

PRIVACY
Ad Speeder collects no data. No tracking, no analytics, no accounts, no network requests. It only looks at the video player on the sites above, inside your browser, to tell when an ad is playing. Settings and counters are stored with Chrome's own storage.

OPEN SOURCE
Source code: https://github.com/sanchitsharma/ad-speeder
Found an ad it missed? Open an issue on GitHub.

Ad Speeder is an independent project and is not affiliated with, endorsed by, or sponsored by Google, YouTube or Amazon.
```

**Category:** `Entertainment` (under Lifestyle)

**Language:** `English`

**Graphic assets** (all in `store/build/`):

| Field | File |
|---|---|
| Store icon 128×128 | `extension/icons/icon128.png` |
| Screenshots 1280×800 (upload in this order) | `screenshot-1-hero.png`, `screenshot-2-popup.png`, `screenshot-3-how-it-works.png` |
| Small promo tile 440×280 | `promo-small-440x280.png` |
| Marquee promo tile 1400×560 | leave empty (only needed to be featured) |

**Official URL:** leave as "None" (that's for verified site owners).
**Homepage URL:** `https://sanchitsharma.github.io/ad-speeder/`
**Support URL:** `https://github.com/sanchitsharma/ad-speeder/issues`
**Mature content:** No

---

## Tab: Privacy

**Single purpose description:**

```
Ad Speeder has one purpose: getting the user through video ads faster on YouTube and Prime Video. While an ad is playing it speeds up and mutes the ad and clicks the ad's Skip button, then restores normal playback when the ad ends.
```

**Permission justification for `storage`:**

```
Stores the user's settings (on/off, ad speed, mute ads, auto-click Skip) in chrome.storage.sync, and local counters (ads fast-forwarded, time saved, skips clicked) in chrome.storage.local, which are shown in the popup. No personal data is stored.
```

**Host permission justification** (for the content-script sites):

```
The content script runs only on youtube.com (and youtube-nocookie.com / YouTube embeds) and primevideo.com, because those are the video players whose ads it fast-forwards. On those pages it reads the video player's state to detect when an ad is playing, changes the video's playback speed and mute state, and clicks the ad's Skip button. It does not read or transmit any other page content.
```

**Are you using remote code?** `No, I am not using remote code.`

**Data usage.** Tick **none** of the data types (the extension collects none of: personally identifiable information, health, financial, authentication, personal communications, location, web history, user activity, website content).

Then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** `https://sanchitsharma.github.io/ad-speeder/privacy.html`

---

## Tab: Distribution

- **Payments:** Free
- **Visibility:** Public
- **Distribution:** All regions

---

## Tab: Test instructions (optional, helps review)

```
No login or setup is needed for YouTube.
1. Install the extension and open any popular YouTube video that shows a pre-roll ad (e.g. a music video).
2. When the ad starts, it plays at 16× and muted, the toolbar icon shows a red "AD" badge, and the Skip button is clicked as soon as it appears.
3. After the ad, playback returns to normal speed and volume.
4. Click the toolbar icon to change the ad speed, turn muting/auto-skip off, or see the stats.
Prime Video works the same way but requires a Prime account; the code path is covered by the automated tests in the GitHub repository.
```

---

## After submitting

- Review usually takes a few days. You'll get an email either way.
- Once it has been uploaded once, the item ID (32 lowercase letters in the dashboard URL) is needed to set up `npm run publish` for future updates.
