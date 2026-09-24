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

/* action */
chrome.action.onClicked.addListener(tab => chrome.storage.local.get({
  allSites: true,
  hosts: []
}, async prefs => {
  if (tab.url?.startsWith('http')) {
    const legacyAllSites = !prefs.allSites && prefs.hosts.includes('*');
    const allSites = prefs.allSites || legacyAllSites;
    const hosts = legacyAllSites ? [] : prefs.hosts.filter(host => host !== '*');

    const a = await chrome.scripting.executeScript({
      target: {
        tabId: tab.id,
        allFrames: true
      },
      func: () => location.hostname,
      injectImmediately: true
    }).catch(e => [{
      result: new URL(tab.url).hostname,
      frameId: 0
    }]);

    const hostnames = (a || []).map(o => o.result).filter((s, i, l) => s && l.indexOf(s) === i);
    const top = a.find(o => o.frameId === 0).result;

    if (top) {
      const n = hosts.indexOf(top);
      let message = '';
      let badge = '✓';
      if (allSites) {
        // Listed hostnames are exceptions while all-sites mode is enabled.
        if (n >= 0) {
          message = 'Enabled the extension on the following hostnames by removing their exceptions:\n\n' + hostnames.join(', ') + '\n';
          for (const hostname of hostnames) {
            const index = hosts.indexOf(hostname);
            if (index >= 0) {
              hosts.splice(index, 1);
            }
          }
        }
        else {
          message = 'Disabled the extension on the following hostnames by adding exceptions:\n\n' + hostnames.join(', ') + '\n';
          badge = '×';
          for (const hostname of hostnames) {
            if (hosts.includes(hostname) === false) {
              hosts.push(hostname);
            }
          }
        }
      }
      else {
        // Listed hostnames are inclusions in the default opt-in mode.
        if (n >= 0) {
          message = 'Removed the following hostnames:\n\n' + hostnames.join(', ') + '\n';
          for (const hostname of hostnames) {
            const index = hosts.indexOf(hostname);
            if (index >= 0) {
              hosts.splice(index, 1);
            }
          }
        }
        else {
          message = 'Added the following hostnames:\n' + hostnames.join(', ') + '\n';
          for (const hostname of hostnames) {
            if (hosts.includes(hostname) === false) {
              hosts.push(hostname);
            }
          }
        }
      }
      validate(hosts).then(error => {
        if (error) {
          notify(tab.id, error);
        }
        else {
          activate.actions.push(() => {
            chrome.tabs.reload(tab.id);
            setTimeout(() => notify(tab.id, message, badge), 5000);
          });
          chrome.storage.local.set({allSites, hosts});
        }
      });
    }
    else {
      notify(tab.id, 'Cannot find the hostname of this tab');
    }
  }
  else {
    notify(tab.id, 'Tab does not have a valid hostname');
  }
}));

/* messaging */
chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.method === 'check') {
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
