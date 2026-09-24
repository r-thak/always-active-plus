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
  const onClicked = hook();
  const onMessage = hook();

  const chrome = {
    action: {
      onClicked,
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
          Object.assign(prefs, values);
          storageWrites.push(values);
        }
      },
      onChanged
    },
    tabs: {
      query: async () => [{id: 1}],
      reload() {}
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
    hooks: {onChanged, onClicked, onStartup},
    prefs,
    registrations,
    storageWrites
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

test('action clicks add and remove exceptions in all-sites mode', async () => {
  const worker = loadWorker({allSites: true, hosts: []});
  const click = worker.hooks.onClicked.listeners[0];

  click({id: 1, url: 'https://example.com/'});
  await flush();
  await flush();
  assert.deepEqual(normalize(worker.storageWrites.at(-1)), {
    allSites: true,
    hosts: ['example.com']
  });

  click({id: 1, url: 'https://example.com/'});
  await flush();
  await flush();
  assert.deepEqual(normalize(worker.storageWrites.at(-1)), {
    allSites: true,
    hosts: []
  });
});

test('first action click migrates legacy wildcard storage before adding an exception', async () => {
  const worker = loadWorker({
    allSites: false,
    hosts: ['*', 'old-redundant-entry.test']
  });

  worker.hooks.onClicked.listeners[0]({id: 1, url: 'https://example.com/'});
  await flush();
  await flush();

  assert.deepEqual(normalize(worker.storageWrites.at(-1)), {
    allSites: true,
    hosts: ['example.com']
  });
});
