const DEFAULT_SETTINGS = {
  enabled: true,
  speed: 16,
  mute: true,
  autoSkip: true,
  humanize: { youtube: true, prime: false, sonyliv: false }
};
const SITES = ['youtube', 'prime', 'sonyliv'];
const DEFAULT_STATS = { adsHandled: 0, secondsSaved: 0, skipsClicked: 0 };
const $ = (id) => document.getElementById(id);

function formatDuration(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function renderStats(stats) {
  $('ads').textContent = stats.adsHandled;
  $('saved').textContent = formatDuration(stats.secondsSaved);
  $('skips').textContent = stats.skipsClicked;
}

async function init() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  $('enabled').checked = settings.enabled;
  $('mute').checked = settings.mute;
  $('autoSkip').checked = settings.autoSkip;
  $('speed').value = String(settings.speed);
  for (const site of SITES)
    $(`hz-${site}`).checked = !!settings.humanize?.[site];

  const { stats } = await chrome.storage.local.get({ stats: DEFAULT_STATS });
  renderStats(stats);
}

for (const id of ['enabled', 'mute', 'autoSkip']) {
  $(id).addEventListener('change', (e) =>
    chrome.storage.sync.set({ [id]: e.target.checked })
  );
}
for (const site of SITES) {
  $(`hz-${site}`).addEventListener('change', () =>
    chrome.storage.sync.set({
      humanize: Object.fromEntries(SITES.map((x) => [x, $(`hz-${x}`).checked]))
    })
  );
}
$('speed').addEventListener('change', (e) =>
  chrome.storage.sync.set({ speed: Number(e.target.value) })
);
$('reset').addEventListener('click', async () => {
  await chrome.storage.local.set({ stats: DEFAULT_STATS });
  renderStats(DEFAULT_STATS);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.stats) renderStats(changes.stats.newValue);
});

init();
