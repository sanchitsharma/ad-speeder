// Captures the real extension popup (2x) for use in store screenshots.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const EXT = path.resolve('extension');
const ctx = await chromium.launchPersistentContext(
  fs.mkdtempSync(path.join(os.tmpdir(), 'as-pop-')),
  {
    channel: 'chromium',
    headless: true,
    deviceScaleFactor: 2,
    viewport: { width: 240, height: 230 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  }
);
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
await sw.evaluate(() =>
  chrome.storage.local.set({
    stats: { adsHandled: 148, secondsSaved: 7480, skipsClicked: 61 }
  })
);
const page = await ctx.newPage();
await page.setViewportSize({ width: 264, height: 230 });
await page.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
await page.waitForFunction(
  () => document.getElementById('ads').textContent === '148'
);
const h = await page.evaluate(() => document.body.scrollHeight);
await page.setViewportSize({ width: 264, height: h });
await page.screenshot({ path: 'store/build/popup@2x.png' });
console.log('popup captured', h);
await ctx.close();
