const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const hook = () => ({
  listeners: [],
  addListener(listener) {
    this.listeners.push(listener);
  }
});

const flush = () => new Promise(resolve => setImmediate(resolve));
const normalize = value => JSON.parse(JSON.stringify(value));

const loadWorker = initialPrefs => {
  const prefs = {...initialPrefs};
  const registrations = [];
  const storageWrites = [];
  const onStartup = hook();
  const onInstalled = hook();
  const onChanged = hook();
  const onMessage = hook();
  const reloadedTabs = [];

  const chrome = {
    action: {
      setBadgeText() {},
      setIcon() {},
      setTitle() {}
    },
    management: {},
    runtime: {
      getManifest: () => ({}),
      onInstalled,
      onMessage,
      onStartup,
      setUninstallURL() {}
    },
    scripting: {
      async executeScript() {
        return [{frameId: 0, result: 'example.com'}];
      },
      async registerContentScripts(scripts) {
        registrations.push(scripts);
      },
      async unregisterContentScripts() {}
    },
    storage: {
      local: {
        get(defaults, callback) {
          callback({...defaults, ...prefs});
        },
        async set(values) {
          const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {
            oldValue: prefs[key],
            newValue: value
          }]));
          Object.assign(prefs, values);
          storageWrites.push(values);
          for (const listener of onChanged.listeners) listener(changes, 'local');
        }
      },
      onChanged
    },
    tabs: {
      query: async () => [{id: 1}],
      reload(tabId) {
        reloadedTabs.push(tabId);
      }
    },
    windows: {}
  };

  const context = vm.createContext({
    URL,
    chrome,
    console,
    navigator: {webdriver: true},
    setTimeout: callback => callback()
  });
  const source = fs.readFileSync(
    path.join(__dirname, '../v3/worker.js'),
    'utf8'
  );
  vm.runInContext(source, context);

  return {
    hooks: {onChanged, onMessage, onStartup},
    prefs,
    registrations,
    storageWrites,
    reloadedTabs,
    message(request) {
      return new Promise(resolve => onMessage.listeners[0](request, {}, resolve));
    }
  };
};

test('all-sites mode registers every URL with hostname exceptions', async () => {
  const worker = loadWorker({
    allSites: true,
    enabled: true,
    hosts: ['example.com', '*.internal.test']
  });

  worker.hooks.onStartup.listeners[0]();
  await flush();

  const [main, isolated] = worker.registrations.at(-1);
  assert.deepEqual(normalize(main.matches), ['*://*/*']);
  assert.deepEqual(normalize(main.excludeMatches), [
    '*://example.com/*',
    '*://*.internal.test/*'
  ]);
  assert.deepEqual(normalize(isolated.excludeMatches), normalize(main.excludeMatches));
});

test('new installations register every URL by default', async () => {
  const worker = loadWorker({});

  worker.hooks.onStartup.listeners[0]();
  await flush();

  const [main, isolated] = worker.registrations.at(-1);
  assert.deepEqual(normalize(main.matches), ['*://*/*']);
  assert.deepEqual(normalize(isolated.matches), ['*://*/*']);
});

test('legacy wildcard storage enables all sites without reinterpreting old entries', async () => {
  const worker = loadWorker({
    allSites: false,
    enabled: true,
    hosts: ['*', 'example.com']
  });

  worker.hooks.onStartup.listeners[0]();
  await flush();

  const [main] = worker.registrations.at(-1);
  assert.deepEqual(normalize(main.matches), ['*://*/*']);
  assert.equal(main.excludeMatches, undefined);
});

test('changing the all-sites preference refreshes registrations', async () => {
  const worker = loadWorker({allSites: true, enabled: true, hosts: []});

  worker.hooks.onChanged.listeners[0]({allSites: {newValue: true}});
  await flush();

  assert.equal(worker.registrations.length, 1);
  assert.deepEqual(normalize(worker.registrations[0][0].matches), ['*://*/*']);
});

test('popup toggle adds and removes exceptions in all-sites mode', async () => {
  const worker = loadWorker({allSites: true, hosts: []});
  const request = {method: 'toggle-site', tabId: 1, url: 'https://example.com/'};

  assert.deepEqual(normalize(await worker.message(request)), {
    ok: true,
    enabled: false,
    host: 'example.com',
    allSites: true,
    ruleCount: 1
  });
  assert.deepEqual(normalize(worker.storageWrites.at(-1)), {
    allSites: true,
    hosts: ['example.com']
  });
  assert.deepEqual(worker.reloadedTabs, [1]);

  assert.equal((await worker.message(request)).enabled, true);
  assert.deepEqual(normalize(worker.storageWrites.at(-1)), {
    allSites: true,
    hosts: []
  });
});

test('popup reads current site state from the active mode and host rules', async () => {
  const worker = loadWorker({
    allSites: false,
    enabled: true,
    hosts: ['*.example.com']
  });

  assert.deepEqual(normalize(await worker.message({
    method: 'site-state',
    url: 'https://docs.example.com/article'
  })), {
    available: true,
    enabled: true,
    globallyEnabled: true,
    host: 'docs.example.com',
    allSites: false,
    ruleCount: 1
  });
});

test('popup toggle migrates legacy wildcard storage before adding an exception', async () => {
  const worker = loadWorker({
    allSites: false,
    hosts: ['*', 'old-redundant-entry.test']
  });

  await worker.message({method: 'toggle-site', tabId: 1, url: 'https://example.com/'});

  assert.deepEqual(normalize(worker.storageWrites.at(-1)), {
    allSites: true,
    hosts: ['example.com']
  });
});
