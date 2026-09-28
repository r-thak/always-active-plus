const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('mouse sliders save their values without Save Options', () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '',
        listeners: new Map(),
        addEventListener(type, listener) { this.listeners.set(type, listener); }
      });
    }
    return elements.get(id);
  };
  const writes = [];
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    chrome: {storage: {local: {
      get() {},
      set(value) { writes.push(value); }
    }}},
    document: {
      getElementById: element,
      addEventListener() {}
    },
    window: {},
    setTimeout(callback) {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../v3/data/options/index.js'), 'utf8'), context);
  const slider = element('mouseInterpolation');
  slider.value = '0.82';
  slider.listeners.get('input')();
  assert.equal(element('mouseInterpolationValue').value, '0.82');
  assert.equal(writes.length, 0);
  for (const callback of timers.values()) callback();
  assert.equal(writes[0].mouseInterpolation, 0.82);
  slider.value = '0.91';
  slider.listeners.get('input')();
  slider.listeners.get('change')();
  assert.equal(writes.at(-1).mouseInterpolation, 0.91);
});
