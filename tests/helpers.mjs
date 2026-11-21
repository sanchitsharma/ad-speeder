import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXT = path.resolve(here, '../extension');
export const VIDEO = fs.readFileSync(path.join(here, 'test.webm'));

export async function launch({ headless = true, debug = true } = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adspeeder-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless,
    viewport: { width: 1280, height: 720 },
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--autoplay-policy=no-user-gesture-required'
    ]
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  if (debug) await enableDebug(sw);
  return { ctx, sw, extId };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(
  fn,
  { timeout = 5000, interval = 50, msg = 'condition' } = {}
) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(
    `Timed out waiting for ${msg} (last=${JSON.stringify(last)})`
  );
}

// Debug mode makes the content script expose <html data-ad-speeder="ad|content">,
// which the tests use to observe state. Off by default in real use.
export const enableDebug = (sw) =>
  sw.evaluate(() => chrome.storage.local.set({ debug: true }));
