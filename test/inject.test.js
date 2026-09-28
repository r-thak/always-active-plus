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
    this.dataset = new Proxy({}, {
      set(target, key, value) {
        target[key] = String(value);
        return true;
      }
    });
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

  getElementById(id) {
    return this.documentElement.child?.id === id ? this.documentElement.child : null;
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

const loadInjection = ({fakeTimers = false, loadIsolated = false} = {}) => {
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
  let now = 0;
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
    now += 16;
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
    PointerEvent: class {
      constructor(type, properties) {
        this.type = type;
        Object.assign(this, properties);
      }
    },
    console,
    Date: fakeTimers ? class {
      static now() { return now; }
    } : Date,
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

  const storagePrefs = {};
  let storageChanged;
  if (loadIsolated) {
    context.location = {hostname: 'test.invalid'};
    context.parent = {location: {hostname: 'test.invalid'}};
    context.chrome = {
      storage: {
        local: {get: (defaults, callback) => callback({...defaults, ...storagePrefs})},
        onChanged: {addListener(callback) { storageChanged = callback; }}
      },
      runtime: {sendMessage() {}}
    };
    vm.runInContext(fs.readFileSync(
      path.join(__dirname, '../v3/data/inject/isolated.js'), 'utf8'
    ), context);
  }

  return {
    document, port, window, tick, timers,
    advance: milliseconds => now += milliseconds,
    setPreference(name, value) {
      storagePrefs[name] = value;
      storageChanged?.();
    }
  };
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

const focusedCanvas = ({interpolation = 0.13, start = 0.01, stop = 0.01} = {}) => {
  const harness = loadInjection({fakeTimers: true});
  const {document, port, window} = harness;
  port.dataset.mouseInterpolation = String(interpolation);
  port.dataset.mouseStartSmoothness = String(start);
  port.dataset.mouseStopSmoothness = String(stop);
  const canvas = new Element();
  canvas.tagName = 'CANVAS';
  canvas.parentNode = document;
  document.elementFromPoint = () => canvas;
  const pointerMoves = [];
  const mouseMoves = [];
  canvas.addEventListener('pointermove', e => pointerMoves.push([e.clientX, e.clientY]));
  canvas.addEventListener('mousemove', e => mouseMoves.push([e.clientX, e.clientY]));
  const move = (x, y) => {
    window.dispatchEvent(createEvent('pointermove', {
      target: canvas, pointerType: 'mouse', clientX: x, clientY: y
    }));
    window.dispatchEvent(createEvent('mousemove', {
      target: canvas, clientX: x, clientY: y
    }));
  };
  const blur = () => window.dispatchEvent(createEvent('blur', {target: window}));
  const enter = (x, y) => {
    const event = createEvent('pointerover', {
      target: canvas, pointerType: 'mouse', relatedTarget: null, clientX: x, clientY: y
    });
    window.dispatchEvent(event);
    return event;
  };
  return {...harness, canvas, pointerMoves, mouseMoves, move, blur, enter};
};

test('focus loss starts gradual pointer and mouse movement at the last real point', () => {
  const {window, canvas, move, blur, enter, tick, timers, pointerMoves, mouseMoves} = focusedCanvas();
  move(40, 50);
  blur();
  const returnEvent = enter(240, 100);
  assert.equal(returnEvent.immediatePropagationStopped, true);
  tick();
  assert.ok(pointerMoves.length > 0);
  assert.ok(Math.hypot(pointerMoves[0][0] - 40, pointerMoves[0][1] - 50) < 3);
  assert.deepEqual(pointerMoves, mouseMoves);
  for (let i = 0; i < 500 && timers.size; i += 1) tick();
  assert.ok(Math.hypot(pointerMoves.at(-1)[0] - 240, pointerMoves.at(-1)[1] - 100) < 2);
  const normal = createEvent('pointermove', {
    target: canvas, pointerType: 'mouse', clientX: 241, clientY: 101
  });
  window.dispatchEvent(normal);
  assert.equal(normal.immediatePropagationStopped, undefined);
});

test('a click cancels interpolation and reaches the clicked position', () => {
  const {window, canvas, move, blur, enter, tick, timers, pointerMoves} = focusedCanvas();
  move(0, 0);
  blur();
  enter(220, 0);
  tick();
  window.dispatchEvent(createEvent('pointerdown', {
    target: canvas, pointerType: 'mouse', clientX: 70, clientY: 40
  }));
  assert.deepEqual(pointerMoves.at(-1), [70, 40]);
  assert.equal(timers.size, 0);
});

test('suppressed moves follow a curved path through recorded positions', () => {
  const {window, canvas, move, blur, enter, tick, timers, pointerMoves} = focusedCanvas();
  move(0, 0);
  blur();
  enter(100, 0);
  tick();
  const turn = createEvent('pointermove', {
    target: canvas, pointerType: 'mouse', clientX: 100, clientY: 100
  });
  window.dispatchEvent(turn);
  assert.equal(turn.immediatePropagationStopped, true);
  for (let i = 0; i < 500 && timers.size; i += 1) tick();
  assert.ok(pointerMoves.some(([x, y]) => x > 70 && x < 105 && y > 5 && y < 95));
  assert.ok(Math.hypot(pointerMoves.at(-1)[0] - 100, pointerMoves.at(-1)[1] - 100) < 2);
});

test('re-entry curves stay inside the recorded bounds when input reverses repeatedly', () => {
  const {window, canvas, move, blur, enter, tick, timers, pointerMoves} = focusedCanvas();
  move(0, 0);
  move(100, 0);
  blur();
  enter(100, 100);
  tick();
  for (const [x, y] of [[110, 60], [110, 120], [110, 60], [110, 120]]) {
    window.dispatchEvent(createEvent('pointermove', {
      target: canvas, pointerType: 'mouse', clientX: x, clientY: y
    }));
  }
  for (let i = 0; i < 1500 && timers.size; i += 1) tick();
  assert.ok(pointerMoves.length > 20);
  assert.ok(pointerMoves.every(([x, y]) => x >= 99 && x <= 111 && y >= -1 && y <= 121),
    'The interpolated curve overshot the points captured over the overlay');
  assert.ok(Math.hypot(pointerMoves.at(-1)[0] - 110, pointerMoves.at(-1)[1] - 120) < 2);
});

test('a second focus return stays behind the unfinished first path', () => {
  const {window, canvas, move, blur, enter, tick, timers, pointerMoves} = focusedCanvas({interpolation: 0.8});
  move(0, 0);
  blur();
  enter(220, 0);
  for (let i = 0; i < 6; i += 1) tick();
  assert.ok(pointerMoves.at(-1)[0] < 220);
  blur();
  const second = enter(0, 0);
  assert.equal(second.immediatePropagationStopped, true);
  const native = createEvent('pointermove', {
    target: canvas, pointerType: 'mouse', clientX: 0, clientY: 0
  });
  window.dispatchEvent(native);
  assert.equal(native.immediatePropagationStopped, true);
  for (let i = 0; i < 1500 && timers.size; i += 1) tick();
  const farthest = Math.max(...pointerMoves.map(([x]) => x));
  assert.ok(farthest > 210, 'The first destination was skipped');
  assert.ok(Math.abs(pointerMoves.at(-1)[0]) < 2, 'The second destination was skipped');
  assert.ok(pointerMoves.every((point, i) => i === 0 ||
    Math.hypot(point[0] - pointerMoves[i - 1][0], point[1] - pointerMoves[i - 1][1]) < 20),
  'The generated cursor snapped between entries');
  assert.equal(timers.size, 0);
});

test('interpolation setting changes speed across its configured range', () => {
  const advance = interpolation => {
    const {move, blur, enter, tick, pointerMoves} = focusedCanvas({interpolation, start: 0, stop: 0});
    move(0, 0);
    blur();
    enter(1000, 0);
    for (let i = 0; i < 20; i += 1) tick();
    return pointerMoves.at(-1)[0];
  };
  assert.ok(advance(0.1) > advance(0.8) * 2);
});

test('saved slider values reach the injected page without a reload', () => {
  const {port, setPreference} = loadInjection({loadIsolated: true});
  assert.equal(port.dataset.mouseInterpolation, '0.13');
  setPreference('mouseInterpolation', 0.82);
  setPreference('mouseStartSmoothness', 1.22);
  setPreference('mouseStopSmoothness', 0.88);
  assert.equal(port.dataset.mouseInterpolation, '0.82');
  assert.equal(port.dataset.mouseStartSmoothness, '1.22');
  assert.equal(port.dataset.mouseStopSmoothness, '0.88');
});

test('start smoothness changes initial acceleration', () => {
  const advance = start => {
    const {move, blur, enter, tick, pointerMoves} = focusedCanvas({interpolation: 0.2, start, stop: 0});
    move(0, 0);
    blur();
    enter(1000, 0);
    for (let i = 0; i < 5; i += 1) tick();
    return pointerMoves.at(-1)[0];
  };
  assert.ok(advance(0) > advance(2) * 5);
});

test('stop smoothness changes braking near the end', () => {
  const advance = stop => {
    const {move, blur, enter, tick, pointerMoves} = focusedCanvas({interpolation: 0.2, start: 0, stop});
    move(0, 0);
    blur();
    enter(120, 0);
    for (let i = 0; i < 12; i += 1) tick();
    return pointerMoves.at(-1)[0];
  };
  assert.ok(advance(0) > advance(2) + 15);
});

test('a delayed timer still advances by a bounded step', () => {
  const {move, blur, enter, tick, advance, pointerMoves} = focusedCanvas({interpolation: 2});
  move(0, 0);
  blur();
  enter(500, 0);
  advance(120);
  tick();
  assert.ok(pointerMoves[0][0] > 0 && pointerMoves[0][0] < 20);
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
