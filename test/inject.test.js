const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class EventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    event.target ||= this;
    for (const listener of this.listeners.get(event.type) || []) {
      listener.call(this, event);
    }
  }
}

class Element extends EventTarget {
  constructor() {
    super();
    this.dataset = {};
  }

  append(element) {
    this.child = element;
  }
}

class Document extends EventTarget {
  constructor() {
    super();
    this.documentElement = new Element();
    this.body = new Element();
    this.hidden = false;
  }

  createElement() {
    return new Element();
  }

  getElementById() {
    return null;
  }

  hasFocus() {
    return true;
  }
}

Object.defineProperty(Document.prototype, 'visibilityState', {
  configurable: true,
  get() {
    return this.hidden ? 'hidden' : 'visible';
  }
});

const createEvent = (type, props = {}) => ({
  type,
  target: {},
  relatedTarget: undefined,
  preventDefault() {
    this.defaultPrevented = true;
  },
  stopPropagation() {
    this.propagationStopped = true;
  },
  stopImmediatePropagation() {
    this.immediatePropagationStopped = true;
  },
  ...props
});

const loadInjection = () => {
  const document = new Document();
  const window = new EventTarget();
  window.top = window;
  window.requestAnimationFrame = callback => callback(0);
  window.cancelAnimationFrame = () => {};

  const context = vm.createContext({
    Document,
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    console,
    Date,
    document,
    navigation: undefined,
    performance: {now: () => 0},
    setTimeout,
    clearTimeout,
    window
  });
  const source = fs.readFileSync(
    path.join(__dirname, '../v3/data/inject/main.js'),
    'utf8'
  );
  vm.runInContext(source, context);

  const port = document.documentElement.child;
  Object.assign(port.dataset, {
    blockedKeys: 'altgraph',
    enabled: 'true',
    keyboard: 'true',
    mouseleave: 'true',
    mouseout: 'true'
  });

  return {document, port, window};
};

test('blocks a mouse exit from an inner element when relatedTarget is null', () => {
  const {window} = loadInjection();
  const event = createEvent('mouseout', {relatedTarget: null});

  window.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.immediatePropagationStopped, true);
});

test('does not block ordinary movement between page elements', () => {
  const {window} = loadInjection();
  const event = createEvent('mouseout', {relatedTarget: {}});

  window.dispatchEvent(event);

  assert.equal(event.defaultPrevented, undefined);
});

test('hides the matching re-entry after a blocked overlay exit', () => {
  const {window} = loadInjection();
  window.dispatchEvent(createEvent('mouseout', {relatedTarget: null}));
  const reentry = createEvent('mouseover', {relatedTarget: null});

  window.dispatchEvent(reentry);

  assert.equal(reentry.defaultPrevented, true);
  window.dispatchEvent(createEvent('mousemove'));

  const laterEntry = createEvent('mouseover', {relatedTarget: null});
  window.dispatchEvent(laterEntry);
  assert.equal(laterEntry.defaultPrevented, undefined);
});

test('blocks the pointer-event equivalents of an overlay exit', () => {
  const {window} = loadInjection();
  const exit = createEvent('pointerout', {relatedTarget: null});
  window.dispatchEvent(exit);
  const reentry = createEvent('pointerover', {relatedTarget: null});
  window.dispatchEvent(reentry);

  assert.equal(exit.defaultPrevented, true);
  assert.equal(reentry.defaultPrevented, true);
});

test('blocks configured keyboard keys and AltGraph modifier events', () => {
  const {window} = loadInjection();
  const altGraph = createEvent('keydown', {
    key: 'AltGraph',
    code: 'AltRight',
    keyCode: 225,
    getModifierState: () => true
  });
  const modifiedKey = createEvent('keypress', {
    key: '@',
    code: 'Digit2',
    keyCode: 64,
    getModifierState: modifier => modifier === 'AltGraph'
  });
  const ordinaryKey = createEvent('keydown', {
    key: 'a',
    code: 'KeyA',
    keyCode: 65,
    getModifierState: () => false
  });

  window.dispatchEvent(altGraph);
  window.dispatchEvent(modifiedKey);
  window.dispatchEvent(ordinaryKey);

  assert.equal(altGraph.defaultPrevented, true);
  assert.equal(modifiedKey.defaultPrevented, true);
  assert.equal(ordinaryKey.defaultPrevented, undefined);
});

test('respects the keyboard policy switch', () => {
  const {port, window} = loadInjection();
  port.dataset.keyboard = 'false';
  const event = createEvent('keyup', {
    key: 'AltGraph',
    code: 'AltRight',
    keyCode: 225,
    getModifierState: () => true
  });

  window.dispatchEvent(event);

  assert.equal(event.defaultPrevented, undefined);
});

test('matches configured code and keyCode values case-insensitively', () => {
  const {port, window} = loadInjection();
  port.dataset.blockedKeys = 'f12\n27';
  const byCode = createEvent('keydown', {
    key: 'F12',
    code: 'F12',
    keyCode: 123,
    getModifierState: () => false
  });
  const byKeyCode = createEvent('keyup', {
    key: 'Escape',
    code: 'Escape',
    keyCode: 27,
    getModifierState: () => false
  });

  window.dispatchEvent(byCode);
  window.dispatchEvent(byKeyCode);

  assert.equal(byCode.defaultPrevented, true);
  assert.equal(byKeyCode.defaultPrevented, true);
});
