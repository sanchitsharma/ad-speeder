// Ad Speeder service worker: shows an "AD" badge while an ad is being
// fast-forwarded and keeps simple local stats. Holds no state in globals, so it
// is safe for Chrome to stop and restart it at any time.

const DEFAULT_SETTINGS = {
  enabled: true,
  speed: 16,
  mute: true,
  autoSkip: true
};
const DEFAULT_STATS = { adsHandled: 0, secondsSaved: 0, skipsClicked: 0 };

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
  }
});

// Serialise stats updates so two tabs finishing an ad at the same moment
// don't overwrite each other's increment.
let statsQueue = Promise.resolve();
function addStats({ ads = 0, seconds = 0, skips = 0 }) {
  statsQueue = statsQueue
    .then(async () => {
      const { stats } = await chrome.storage.local.get({
        stats: DEFAULT_STATS
      });
      await chrome.storage.local.set({
        stats: {
          adsHandled: stats.adsHandled + ads,
          secondsSaved: stats.secondsSaved + seconds,
          skipsClicked: stats.skipsClicked + skips
        }
      });
    })
    .catch((e) => console.error('stats update failed', e));
  return statsQueue;
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'ad-state') return;
  const tabId = sender.tab?.id;
  if (tabId !== undefined) {
    // The tab may already be closed; that's fine.
    chrome.action
      .setBadgeText({ tabId, text: msg.inAd ? 'AD' : '' })
      .catch(() => {});
    chrome.action
      .setBadgeBackgroundColor({ tabId, color: '#d93025' })
      .catch(() => {});
  }
  if (!msg.inAd && typeof msg.adSeconds === 'number') {
    // Wall-clock seconds spent in the ad at Nx would have been N times as long at 1x.
    addStats({
      ads: 1,
      seconds: msg.adSeconds * Math.max(0, (msg.speed || 1) - 1),
      skips: msg.skips || 0
    });
  }
});
