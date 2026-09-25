const log = (...args) => chrome.storage.local.get({
  log: false
}, prefs => prefs.log && console.log(...args));

const notify = async (tabId, title, symbol = 'E') => {
  tabId = tabId || (await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  }))[0].id;

  chrome.action.setBadgeText({
    tabId,
    text: symbol
  });
  chrome.action.setTitle({
    tabId,
    title
  });
};

const validate = async hosts => {
  if (hosts.length === 0) {
    return '';
  }

  let message = '';
  try {
    await chrome.scripting.registerContentScripts([{
      'matches': hosts.map(h => '*://' + h + '/*'),
      'allFrames': true,
      'matchOriginAsFallback': true,
      'runAt': 'document_start',
      'id': 'test',
      'js': ['data/inject/test.js']
    }]);
  }
  catch (e) {
    message = e.message;
  }
  try {
    await chrome.scripting.unregisterContentScripts({
      ids: ['test']
    });
  }
  catch (e) {}

  return message;
};

/* enable or disable */
const activate = () => {
  if (activate.busy) {
    return;
  }
  activate.busy = true;

  chrome.storage.local.get({
    enabled: true,
    allSites: true,
    hosts: []
  }, async prefs => {
    try {
      await chrome.scripting.unregisterContentScripts();

      const legacyAllSites = !prefs.allSites && prefs.hosts.includes('*');
      const allSites = prefs.allSites || legacyAllSites;
      const hosts = legacyAllSites ? [] : prefs.hosts.filter(host => host !== '*');

      if (prefs.enabled && (allSites || hosts.length)) {
        const props = {
          'allFrames': true,
          'matchOriginAsFallback': true,
          'runAt': 'document_start'
        };
        if (allSites) {
          props['matches'] = ['*://*/*'];
          if (hosts.length) {
            props['excludeMatches'] = hosts.map(h => '*://' + h + '/*');
          }
        }
        else {
          props['matches'] = hosts.map(h => '*://' + h + '/*');
        }

        await chrome.scripting.registerContentScripts([{
          ...props,
          'id': 'main',
          'js': ['data/inject/main.js'],
          'world': 'MAIN'
        }, {
          ...props,
          'id': 'isolated',
          'js': ['data/inject/isolated.js'],
          'world': 'ISOLATED'
        }]);
      }
    }
    catch (e) {
      notify(undefined, 'Blocker Registration Failed: ' + e.message);
      console.error('Blocker Registration Failed', e);
    }
    for (const c of activate.actions) {
      c();
    }
    activate.actions.length = 0;
    activate.busy = false;
  });
};
chrome.runtime.onStartup.addListener(activate);
chrome.runtime.onInstalled.addListener(activate);
chrome.storage.onChanged.addListener(ps => {
  if (ps.enabled || ps.allSites || ps.hosts) {
    activate();
  }
});
activate.actions = [];

/* current-site control */
const readSitePrefs = () => new Promise(resolve => chrome.storage.local.get({
  enabled: true,
  allSites: true,
  hosts: []
}, resolve));

const normalizeSitePrefs = prefs => {
  const legacyAllSites = !prefs.allSites && prefs.hosts.includes('*');
  return {
    enabled: prefs.enabled,
    allSites: prefs.allSites || legacyAllSites,
    hosts: legacyAllSites ? [] : prefs.hosts.filter(host => host !== '*')
  };
};

const hostMatches = (host, rule) => {
  if (rule.startsWith('*.')) {
    const suffix = rule.slice(2);
    return host === suffix || host.endsWith('.' + suffix);
  }
  return host === rule;
};

const getSiteState = async url => {
  let host;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return {available: false};
    host = parsed.hostname;
  }
  catch (error) {
    return {available: false};
  }

  const prefs = normalizeSitePrefs(await readSitePrefs());
  const listed = prefs.hosts.some(rule => hostMatches(host, rule));
  const active = prefs.enabled && (prefs.allSites ? !listed : listed);
  return {
    available: true,
    enabled: active,
    globallyEnabled: prefs.enabled,
    host,
    allSites: prefs.allSites,
    ruleCount: prefs.hosts.length
  };
};

const toggleSite = async (tabId, url) => {
  const current = await getSiteState(url);
  if (!current.available) return {ok: false, message: 'This page cannot be controlled.'};
  if (!current.globallyEnabled) {
    return {ok: false, message: 'The extension is paused globally.'};
  }

  const prefs = normalizeSitePrefs(await readSitePrefs());
  const shouldAddHost = current.enabled === current.allSites;
  const hosts = shouldAddHost ? [...prefs.hosts, current.host] :
    prefs.hosts.filter(rule => !hostMatches(current.host, rule));

  const error = await validate(hosts);
  if (error) return {ok: false, message: error};

  return new Promise(resolve => {
    activate.actions.push(() => {
      chrome.tabs.reload(tabId);
      resolve({
        ok: true,
        enabled: !current.enabled,
        host: current.host,
        allSites: current.allSites,
        ruleCount: hosts.length
      });
    });
    chrome.storage.local.set({allSites: prefs.allSites, hosts});
  });
};

/* messaging */
chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.method === 'site-state') {
    getSiteState(request.url).then(response).catch(() => response({available: false}));
    return true;
  }
  else if (request.method === 'toggle-site') {
    toggleSite(request.tabId, request.url)
      .then(response)
      .catch(error => response({ok: false, message: error.message}));
    return true;
  }
  else if (request.method === 'check') {
    log('check event from', sender.tab);
  }
  else if (request.method === 'change') {
    log('page visibility state is changed', sender.tab);
  }
  else if (request.method === 'set-icon') {
    chrome.action.setIcon({
      tabId: sender.tab.id,
      path: {
        '16': '/data/icons/16.png',
        '32': '/data/icons/32.png',
        '48': '/data/icons/48.png'
      }
    });
  }
  else if (request.method === 'validate') {
    validate(request.hosts).then(message => response(message));
    return true;
  }
});

/* operation mode (for old users) */
const mode = ({reason}) => {
  // do not offer mode selection to the new users
  if (reason !== 'update') {
    chrome.storage.local.set({
      'mode-displayed': true
    });
    return;
  }

  chrome.storage.local.get({
    'mode-displayed': false,
    'hosts': []
  }, async prefs => {
    if (prefs['mode-displayed']) {
      return;
    }
    chrome.storage.local.set({
      'mode-displayed': true
    });
    // user already know how to deal with the change
    if (prefs.hosts.length) {
      return;
    }

    const width = 600;
    const height = 300;
    const win = await chrome.windows.getCurrent();

    chrome.windows.create({
      url: '/data/guide/index.html',
      width,
      height,
      left: win.left + Math.round((win.width - width) / 2),
      top: win.top + Math.round((win.height - height) / 2),
      type: 'popup'
    });
  });
};
chrome.runtime.onInstalled.addListener(mode);
