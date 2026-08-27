const toast = document.getElementById('toast');

const notify = (message, timeout = 1000) => {
  toast.textContent = message;
  clearTimeout(notify.id);
  notify.id = setTimeout(() => toast.textContent = '', timeout);
};

const updateHostMode = allSites => {
  document.getElementById('host-mode-description').textContent = allSites ?
    'The extension is active everywhere except on the hostnames listed below.' :
    'The extension is inactive by default and only active on the hostnames listed below.';
  document.getElementById('hosts').placeholder = allSites ?
    'Excluded hostnames, separated by commas. Example:\n\nexample.com, *.example.com, www.example.com' :
    'Included hostnames, separated by commas. Example:\n\nexample.com, *.example.com, www.example.com';
};

document.getElementById('allSites').addEventListener('change', e => updateHostMode(e.target.checked));

chrome.storage.local.get({
  'allSites': false,
  'visibilityState': true,
  'hidden': true,
  'blur': true,
  'focus': true,
  'redirect': true,
  'visibility': true,
  'pointercapture': true,
  'mouseleave': true,
  'mouseout': true,
  'keyboard': true,
  'blockedKeys': ['AltGraph'],
  'log': false,
  'policies': null,
  'hosts': []
}, prefs => {
  const legacyAllSites = !prefs.allSites && prefs.hosts.includes('*');
  const allSites = prefs.allSites || legacyAllSites;
  document.getElementById('allSites').checked = allSites;
  document.getElementById('visibilityState').checked = prefs.visibilityState;
  document.getElementById('hidden').checked = prefs.hidden;
  document.getElementById('focus').checked = prefs.focus;
  document.getElementById('redirect').checked = prefs.redirect;
  document.getElementById('visibility').checked = prefs.visibility;
  document.getElementById('pointercapture').checked = prefs.pointercapture;
  document.getElementById('blur').checked = prefs.blur;
  document.getElementById('mouseleave').checked = prefs.mouseleave;
  document.getElementById('mouseout').checked = prefs.mouseout;
  document.getElementById('keyboard').checked = prefs.keyboard;
  document.getElementById('blockedKeys').value = (Array.isArray(prefs.blockedKeys) ? prefs.blockedKeys : []).join(', ');
  document.getElementById('log').checked = prefs.log;
  document.getElementById('policies').value = prefs.policies ? JSON.stringify(prefs.policies, null, '  ') : '';
  document.getElementById('hosts').value = legacyAllSites ? '' :
    prefs.hosts.filter(host => host !== '*').join(', ');
  updateHostMode(allSites);

  if (typeof navigation === 'undefined') {
    document.getElementById('redirect').checked = false;
    document.getElementById('redirect-container').classList.add('disabled');
  }
});


document.getElementById('save').addEventListener('click', async () => {
  const prefs = {
    'allSites': document.getElementById('allSites').checked,
    'visibilityState': document.getElementById('visibilityState').checked,
    'hidden': document.getElementById('hidden').checked,
    'blur': document.getElementById('blur').checked,
    'mouseleave': document.getElementById('mouseleave').checked,
    'mouseout': document.getElementById('mouseout').checked,
    'keyboard': document.getElementById('keyboard').checked,
    'blockedKeys': [...new Set(document.getElementById('blockedKeys').value
      .split(/[\n,]+/)
      .map(key => key.trim())
      .filter(Boolean))],
    'visibility': document.getElementById('visibility').checked,
    'pointercapture': document.getElementById('pointercapture').checked,
    'focus': document.getElementById('focus').checked,
    'redirect': document.getElementById('redirect').checked,
    'log': document.getElementById('log').checked
  };

  let policies = null;
  if (document.getElementById('policies').value) {
    try {
      policies = JSON.parse(document.getElementById('policies').value);
      document.getElementById('policies').value = JSON.stringify(policies, null, '  ');
    }
    catch (e) {
      console.error(e);
      return notify('Policies Error: ' + e.message);
    }
  }
  prefs.policies = policies;

  const hosts = [];
  for (const h of document.getElementById('hosts').value.split(/\s*,\s*/)) {
    if (!h) {
      continue;
    }
    const msg = await chrome.runtime.sendMessage({
      method: 'validate',
      hosts: [h]
    });
    if (!msg) {
      hosts.push(h);
    }
    else {
      console.info('Host is not valid', h, msg);
      notify(h + ': ' + msg);
    }
  }
  // test all
  const msg = await chrome.runtime.sendMessage({
    method: 'validate',
    hosts
  });
  if (msg) {
    notify(msg);
  }
  else {
    prefs.hosts = hosts;
    document.getElementById('hosts').value = hosts.join(', ');
    await chrome.storage.local.set(prefs);
    notify('Options saved');
  }
});

// reset
document.getElementById('reset').addEventListener('click', e => {
  if (e.detail === 1) {
    notify('Double-click to reset!');
  }
  else {
    localStorage.clear();
    chrome.storage.local.clear(() => {
      chrome.runtime.reload();
      window.close();
    });
  }
});

// support
document.getElementById('support').addEventListener('click', () => chrome.tabs.create({
  url: chrome.runtime.getManifest().homepage_url
}));

// report
document.getElementById('report').addEventListener('click', () => chrome.tabs.create({
  url: chrome.runtime.getManifest().homepage_url + '/issues/new'
}));

// test
document.getElementById('test').addEventListener('click', () => chrome.tabs.create({
  url: 'https://webbrowsertools.com/test-always-active/'
}));

// links
const links = window.links = (d = document) => {
  for (const a of [...d.querySelectorAll('[data-href]')]) {
    if (a.hasAttribute('href') === false) {
      a.href = chrome.runtime.getManifest().homepage_url + '#' + a.dataset.href;
    }
  }
};
document.addEventListener('DOMContentLoaded', () => links());
