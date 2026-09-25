const hostname = document.getElementById('hostname');
const power = document.getElementById('power');
const buttonLabel = document.getElementById('button-label');
const status = document.getElementById('status');
const hint = document.getElementById('hint');
const scope = document.getElementById('scope');
const modeSummary = document.getElementById('mode-summary');
const liveDot = document.getElementById('live-dot');
const error = document.getElementById('error');

let activeTab;
let siteState;

const showError = message => {
  error.textContent = message;
  error.hidden = false;
};

const render = state => {
  siteState = state;
  if (!state.available) {
    hostname.textContent = 'Unsupported page';
    scope.textContent = 'N/A';
    status.textContent = 'No site controls here';
    hint.textContent = 'Open a regular website to use this switch.';
    modeSummary.textContent = 'Browser pages cannot be controlled';
    power.disabled = true;
    return;
  }

  hostname.textContent = state.host;
  scope.textContent = state.allSites ? 'ALL SITES' : 'ALLOW LIST';
  modeSummary.textContent = state.allSites ?
    `${state.ruleCount} site ${state.ruleCount === 1 ? 'exception' : 'exceptions'}` :
    `${state.ruleCount} allowed ${state.ruleCount === 1 ? 'site' : 'sites'}`;
  liveDot.className = `live-dot ${state.enabled ? 'on' : 'off'}`;
  power.disabled = !state.globallyEnabled;
  power.setAttribute('aria-pressed', String(state.enabled));
  buttonLabel.textContent = state.enabled ?
    `Turn off protection for ${state.host}` :
    `Turn on protection for ${state.host}`;

  if (!state.globallyEnabled) {
    status.textContent = 'Extension paused';
    hint.textContent = 'Protection is disabled globally.';
  }
  else if (state.enabled) {
    status.textContent = 'Active on this site';
    hint.textContent = 'Click the power button to pause this site.';
  }
  else {
    status.textContent = 'Paused on this site';
    hint.textContent = 'Click the power button to resume this site.';
  }
};

const getTab = async () => {
  [activeTab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
  if (!activeTab?.url) {
    render({available: false});
    return;
  }
  const state = await chrome.runtime.sendMessage({method: 'site-state', url: activeTab.url});
  render(state || {available: false});
};

power.addEventListener('click', async () => {
  if (!activeTab || !siteState?.available) return;
  power.disabled = true;
  status.textContent = 'Applying site rule…';
  hint.textContent = 'The page will reload with the new setting.';
  error.hidden = true;

  const result = await chrome.runtime.sendMessage({
    method: 'toggle-site',
    tabId: activeTab.id,
    url: activeTab.url
  });
  if (!result?.ok) {
    power.disabled = false;
    showError(result?.message || 'Could not update this site.');
    render(siteState);
    return;
  }

  render({...siteState, enabled: result.enabled, ruleCount: result.ruleCount});
  status.textContent = result.enabled ? 'Active on this site' : 'Paused on this site';
  hint.textContent = 'Reloading with the new setting…';
  power.disabled = true;
});

document.getElementById('settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

getTab().catch(() => render({available: false}));
