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
      if (event.immediatePropagationStopped) {
        break;
      }
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
    this._hidden = false;
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
    return this._hidden ? 'hidden' : 'visible';
  }
});

Object.defineProperty(Document.prototype, 'hidden', {
  configurable: true,
  get() {
    return this._hidden;
  }
});

const nativeDocumentDescriptors = {
  hasFocus: Object.getOwnPropertyDescriptor(Document.prototype, 'hasFocus'),
  hidden: Object.getOwnPropertyDescriptor(Document.prototype, 'hidden'),
  visibilityState: Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
};

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

const loadInjection = ({fakeTimers = false} = {}) => {
  // Each browser document has its own realm. Restore the test double so an
  // earlier injection cannot become this injection's apparent native getter.
  for (const [name, descriptor] of Object.entries(nativeDocumentDescriptors)) {
    Object.defineProperty(Document.prototype, name, descriptor);
  }
  const document = new Document();
  const window = new EventTarget();
  window.top = window;
  window.requestAnimationFrame = callback => callback(0);
  window.cancelAnimationFrame = () => {};
  const timers = new Map();
  let nextTimer = 0;
  const schedule = fakeTimers ? callback => {
    const id = ++nextTimer;
    timers.set(id, callback);
    return id;
  } : setTimeout;
  const cancel = fakeTimers ? id => timers.delete(id) : clearTimeout;
  const tick = () => {
    const [id, callback] = timers.entries().next().value || [];
    if (!callback) return false;
    timers.delete(id);
    callback();
    return true;
  };

  const context = vm.createContext({
    Document,
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    MouseEvent: class {
      constructor(type, properties) {
        this.type = type;
        Object.assign(this, properties);
      }
    },
    console,
    Date,
    document,
    navigation: undefined,
    performance: {now: () => 0},
    setTimeout: schedule,
    clearTimeout: cancel,
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

  return {document, port, window, tick, timers};
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

test('spoofs visibility getters even when a page reads Document.prototype directly', () => {
  const {document, port} = loadInjection();
  document._hidden = true;

  const visibilityGetter = Object.getOwnPropertyDescriptor(
    Document.prototype,
    'visibilityState'
  ).get;
  const hiddenGetter = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden').get;

  assert.equal(document.visibilityState, 'visible');
  assert.equal(document.hidden, false);
  assert.equal(visibilityGetter.call(document), 'visible');
  assert.equal(hiddenGetter.call(document), false);

  port.dataset.enabled = 'false';
  assert.equal(document.visibilityState, 'hidden');
  assert.equal(document.hidden, true);
});

test('blocks visibility events captured from window before page listeners can observe them', () => {
  const {window} = loadInjection();
  const event = createEvent('visibilitychange', {target: {}});
  let observed = false;
  window.addEventListener('visibilitychange', () => {
    observed = true;
  });

  window.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.immediatePropagationStopped, true);
  assert.equal(observed, false);
});

test('blocks focus boundary events when focus leaves or re-enters the browser window', () => {
  const {window} = loadInjection();
  const exit = createEvent('focusout', {relatedTarget: null});
  const reentry = createEvent('focusin', {relatedTarget: null});

  window.dispatchEvent(exit);
  window.dispatchEvent(reentry);

  assert.equal(exit.defaultPrevented, true);
  assert.equal(reentry.defaultPrevented, true);
  window.dispatchEvent(createEvent('pointerdown'));

  const ordinaryFocus = createEvent('focusin', {relatedTarget: null});
  window.dispatchEvent(ordinaryFocus);
  assert.equal(ordinaryFocus.defaultPrevented, undefined);
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

test('does not synthesize mouseenter events when re-entering after an overlay exit', () => {
  const {document, window} = loadInjection();
  const target = new Element();
  target.parentNode = document;
  document.elementFromPoint = () => target;

  let mouseenterCount = 0;
  target.addEventListener('mouseenter', () => {
    mouseenterCount += 1;
  });

  window.dispatchEvent(createEvent('mouseout', {
    clientX: 0,
    clientY: 0,
    target,
    relatedTarget: null
  }));
  const reentry = createEvent('mouseenter', {
    clientX: 16,
    clientY: 0,
    relatedTarget: null
  });
  window.dispatchEvent(reentry);

  assert.equal(reentry.defaultPrevented, true);
  assert.equal(mouseenterCount, 0);
});

test('replays mouseleave and mouseenter transitions along the exit-to-entry path', () => {
  const {document, window} = loadInjection();
  const a = new Element();
  const b = new Element();
  const c = new Element();
  const d = new Element();
  const e = new Element();
  a.parentNode = document;
  b.parentNode = a;
  c.parentNode = b;
  e.parentNode = a;
  d.parentNode = e;
  document.elementFromPoint = x => x < 8 ? c : d;

  const transitions = [];
  b.addEventListener('mouseleave', () => transitions.push('leave B'));
  c.addEventListener('mouseleave', () => transitions.push('leave C'));
  e.addEventListener('mouseenter', () => transitions.push('enter E'));
  d.addEventListener('mouseenter', () => transitions.push('enter D'));

  window.dispatchEvent(createEvent('mouseout', {
    clientX: 0,
    clientY: 0,
    target: c,
    relatedTarget: null
  }));
  window.dispatchEvent(createEvent('mouseenter', {
    clientX: 16,
    clientY: 0,
    relatedTarget: null
  }));

  assert.deepEqual(transitions, ['leave C', 'leave B', 'enter E', 'enter D']);
});

test('interpolates moves toward the latest cursor position and bends around a turn', () => {
  const {document, port, window, tick, timers} = loadInjection({fakeTimers: true});
  port.dataset.mouseInterpolation = '20';
  const target = new Element();
  target.parentNode = document;
  document.elementFromPoint = () => target;
  const moves = [];
  target.addEventListener('mousemove', e => moves.push([e.clientX, e.clientY]));

  window.dispatchEvent(createEvent('mouseout', {
    clientX: 0, clientY: 0, target, relatedTarget: null
  }));
  window.dispatchEvent(createEvent('mouseenter', {
    clientX: 100, clientY: 0, relatedTarget: null
  }));
  assert.equal(moves.length, 0);
  tick();
  const turn = createEvent('mousemove', {clientX: 100, clientY: 100});
  window.dispatchEvent(turn);
  assert.equal(turn.immediatePropagationStopped, true);
  tick();
  assert.ok(moves[1][0] > moves[0][0]);
  assert.ok(moves[1][1] > 0);
  assert.ok(moves[1][1] < moves[1][0]);
  for (let i = 0; i < 500 && timers.size; i += 1) tick();
  assert.ok(Math.abs(moves.at(-1)[0] - 100) <= 1);
  assert.ok(Math.abs(moves.at(-1)[1] - 100) <= 1);
  assert.equal(timers.size, 0);
});

test('click snaps to its position and cancels pending interpolation', () => {
  const {document, port, window, tick, timers} = loadInjection({fakeTimers: true});
  port.dataset.mouseInterpolation = '50';
  const target = new Element();
  target.parentNode = document;
  document.elementFromPoint = () => target;
  const moves = [];
  target.addEventListener('mousemove', e => moves.push([e.clientX, e.clientY]));
  window.dispatchEvent(createEvent('mouseout', {
    clientX: 0, clientY: 0, target, relatedTarget: null
  }));
  window.dispatchEvent(createEvent('mouseenter', {
    clientX: 80, clientY: 0, relatedTarget: null
  }));
  tick();
  window.dispatchEvent(createEvent('pointerdown', {
    pointerType: 'mouse', clientX: 20, clientY: 30
  }));
  assert.deepEqual(moves.at(-1), [20, 30]);
  assert.equal(timers.size, 0);
  const count = moves.length;
  assert.equal(tick(), false);
  assert.equal(moves.length, count);
  const ordinaryMove = createEvent('mousemove', {clientX: 21, clientY: 31});
  window.dispatchEvent(ordinaryMove);
  assert.equal(ordinaryMove.immediatePropagationStopped, undefined);
});

test('interpolation visits narrow targets and smoothness reduces initial speed', () => {
  const run = smoothness => {
    const {document, port, window, tick} = loadInjection({fakeTimers: true});
    port.dataset.mouseInterpolation = '10';
    port.dataset.mouseStartSmoothness = String(smoothness);
    const first = new Element();
    const narrow = new Element();
    const last = new Element();
    for (const element of [first, narrow, last]) element.parentNode = document;
    document.elementFromPoint = x => x < 2 ? first : x < 3 ? narrow : last;
    const entered = [];
    const moves = [];
    narrow.addEventListener('mouseenter', () => entered.push('narrow'));
    last.addEventListener('mouseenter', () => entered.push('last'));
    for (const element of [first, narrow, last]) {
      element.addEventListener('mousemove', e => moves.push(e.clientX));
    }
    window.dispatchEvent(createEvent('mouseout', {
      clientX: 0, clientY: 0, target: first, relatedTarget: null
    }));
    window.dispatchEvent(createEvent('mouseenter', {
      clientX: 40, clientY: 0, relatedTarget: null
    }));
    tick();
    return {entered, firstMove: moves[0]};
  };
  const normal = run(0);
  const smooth = run(80);
  assert.deepEqual(normal.entered, ['narrow', 'last']);
  assert.ok(smooth.firstMove < normal.firstMove);
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
