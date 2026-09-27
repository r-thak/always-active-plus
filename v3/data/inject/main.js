/* global navigation */
{
  /* port is used to communicate between chrome and page scripts */
  let port;
  try {
    port = document.getElementById('lwys-ctv-port');
    port.remove();
  }
  catch (e) {
    port = document.createElement('span');
    port.id = 'lwys-ctv-port';
    document.documentElement.append(port);
  }

  const block = e => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  const isPageExit = e => e.relatedTarget === null;

  /* visibility */
  const descriptors = Object.fromEntries([
    'hidden',
    'visibilityState',
    'webkitHidden',
    'webkitVisibilityState'
  ].map(name => [name, Object.getOwnPropertyDescriptor(Document.prototype, name)]));
  const values = Object.fromEntries(Object.keys(descriptors).map(name => [name, document[name]]));
  const original = name => {
    const getter = descriptors[name]?.get;
    return getter ? getter.call(document) : values[name];
  };
  const overrideDocumentGetter = (name, getter) => {
    const descriptor = descriptors[name];
    if (descriptor?.configurable) {
      Object.defineProperty(Document.prototype, name, {...descriptor, get: getter});
    }
    else {
      Object.defineProperty(document, name, {configurable: true, get: getter});
    }
  };

  const visibilityState = () => original('visibilityState') ||
    (original('hidden') ? 'hidden' : 'visible');
  const webkitVisibilityState = () => original('webkitVisibilityState') || visibilityState();
  overrideDocumentGetter('visibilityState', () => {
    if (port.dataset.enabled === 'false') {
      return visibilityState();
    }
    return 'visible';
  });
  overrideDocumentGetter('webkitVisibilityState', () => {
    if (port.dataset.enabled === 'false') {
      return webkitVisibilityState();
    }
    return 'visible';
  });

  const once = {
    focus: true,
    // if document is hidden allow one time event
    visibilitychange: visibilityState() === 'hidden',
    webkitvisibilitychange: webkitVisibilityState() === 'hidden'
  };

  /* prevent redirect when hidden */
  if (window.top === window && typeof navigation !== 'undefined') {
    // Save the original property descriptor
    const redirect = e => {
      if (redirect.href) {
        console.info('[Always Active]', 'an attempt to redirect is being blocked', redirect.href);
        e.preventDefault();
        e.returnValue = 'no';
      }
    };
    navigation.addEventListener('navigate', navigateEvent => {
      if (navigateEvent.navigationType === 'reload') {
        redirect.href = navigateEvent.destination.url;
      }
    });
    document.addEventListener('visibilitychange', e => {
      delete redirect.href;
      removeEventListener('beforeunload', redirect);
      try {
        const state = visibilityState();
        if (state === 'hidden') {
          if (port.dataset.enabled === 'true' && port.dataset.redirect !== 'false') {
            addEventListener('beforeunload', redirect);
          }
        }
      }
      catch (e) {}
    });
  }

  const onvisibilitychange = e => {
    port.dispatchEvent(new Event('state'));
    if (port.dataset.enabled === 'true' && port.dataset.visibility !== 'false') {
      if (once.visibilitychange) {
        once.visibilitychange = false;
        return;
      }
      return block(e);
    }
  };
  const onwebkitvisibilitychange = e => {
    if (port.dataset.enabled === 'true' && port.dataset.visibility !== 'false') {
      if (once.webkitvisibilitychange) {
        once.webkitvisibilitychange = false;
        return;
      }
      return block(e);
    }
  };
  // visibilitychange targets document, but window capture listeners run first.
  // Register in both places so page listeners cannot observe that transition.
  document.addEventListener('visibilitychange', onvisibilitychange, true);
  window.addEventListener('visibilitychange', onvisibilitychange, true);
  document.addEventListener('webkitvisibilitychange', onwebkitvisibilitychange, true);
  window.addEventListener('webkitvisibilitychange', onwebkitvisibilitychange, true);
  window.addEventListener('pagehide', e => {
    if (port.dataset.enabled === 'true' && port.dataset.visibility !== 'false') {
      block(e);
    }
  }, true);

  /* pointercapture */
  window.addEventListener('lostpointercapture', e => {
    if (port.dataset.enabled === 'true' && port.dataset.pointercapture !== 'false') {
      block(e);
    }
  }, true);

  /* hidden */
  overrideDocumentGetter('hidden', () => port.dataset.enabled === 'false' ?
    Boolean(original('hidden')) : false);
  overrideDocumentGetter('webkitHidden', () => port.dataset.enabled === 'false' ?
    Boolean(original('webkitHidden') ?? original('hidden')) : false);

  /* focus */
  let focusReentry = false;
  Document.prototype.hasFocus = new Proxy(Document.prototype.hasFocus, {
    apply(target, self, args) {
      if (port.dataset.enabled === 'true' && port.dataset.focus !== 'false') {
        return true;
      }
      return Reflect.apply(target, self, args);
    }
  });

  const onfocus = e => {
    if (port.dataset.enabled === 'true' && port.dataset.focus !== 'false') {
      if (e.target === document || e.target === window ||
          (focusReentry && isPageExit(e))) {
        if (once.focus) {
          once.focus = false;
          return;
        }
        return block(e);
      }
    }
  };
  document.addEventListener('focus', onfocus, true);
  window.addEventListener('focus', onfocus, true);

  /* blur */
  const onblur = e => {
    if (port.dataset.enabled === 'true' && port.dataset.blur !== 'false') {
      if (e.target === document || e.target === window || isPageExit(e)) {
        if (isPageExit(e)) {
          focusReentry = true;
        }
        return block(e);
      }
    }
  };
  document.addEventListener('blur', onblur, true);
  window.addEventListener('blur', onblur, true);

  /* focus boundary events */
  const onfocusout = e => {
    if (port.dataset.enabled === 'true' && port.dataset.blur !== 'false' && isPageExit(e)) {
      focusReentry = true;
      return block(e);
    }
  };
  const onfocusin = e => {
    if (port.dataset.enabled === 'true' && port.dataset.focus !== 'false' &&
        focusReentry && isPageExit(e)) {
      return block(e);
    }
  };
  window.addEventListener('focusout', onfocusout, true);
  window.addEventListener('focusin', onfocusin, true);
  const resetFocusReentry = () => {
    focusReentry = false;
  };
  window.addEventListener('pointerdown', resetFocusReentry, true);
  window.addEventListener('touchstart', resetFocusReentry, true);
  window.addEventListener('keydown', resetFocusReentry, true);

  /* mouse and pointer boundary events */
  const reentry = {
    mouse: false,
    pointer: false
  };

  let mouseExitPoint;
  let mouseExitTarget;
  let mousePath;
  let syntheticMouseMove = false;
  const mouseSetting = name => Math.max(0, Math.min(100, Number(port.dataset[name]) || 0));
  const stopMousePath = () => {
    if (mousePath?.timer) clearTimeout(mousePath.timer);
    mousePath = undefined;
  };
  const ancestors = element => {
    const result = [];
    for (let node = element; node && node !== document; node = node.parentNode) {
      if (node.dispatchEvent) result.push(node);
    }
    return result;
  };
  const fire = (target, type, x, y, relatedTarget) => {
    if (!target?.dispatchEvent) return;
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: type === 'mouseout' || type === 'mouseover' || type === 'mousemove',
      cancelable: true,
      clientX: x,
      clientY: y,
      relatedTarget: relatedTarget || null,
      view: window
    }));
  };
  const moveMousePath = (path, end, emitMove) => {
    const start = path.position;
    // Visit every pixel of a frame's segment so narrow elements are not skipped.
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y)));
    for (let i = 0; i <= steps; i += 1) {
      const x = start.x + (end.x - start.x) * i / steps;
      const y = start.y + (end.y - start.y) * i / steps;
      const target = document.elementFromPoint(x, y);
      if (!target) continue;
      const nextPath = ancestors(target);
      let common = 0;
      while (common < path.ancestors.length && common < nextPath.length &&
          path.ancestors[path.ancestors.length - 1 - common] === nextPath[nextPath.length - 1 - common]) {
        common += 1;
      }
      if (path.target && path.target !== target) {
        fire(path.target, 'mouseout', x, y, target);
        for (let j = 0; j < path.ancestors.length - common; j += 1) {
          fire(path.ancestors[j], 'mouseleave', x, y, target);
        }
        fire(target, 'mouseover', x, y, path.target);
        for (let j = nextPath.length - common - 1; j >= 0; j -= 1) {
          fire(nextPath[j], 'mouseenter', x, y, path.target);
        }
      }
      path.target = target;
      path.ancestors = nextPath;
    }
    path.position = end;
    if (emitMove && path.target) {
      syntheticMouseMove = true;
      try {
        fire(path.target, 'mousemove', end.x, end.y, null);
      }
      finally {
        syntheticMouseMove = false;
      }
    }
  };
  const tickMousePath = () => {
    const path = mousePath;
    if (!path) return;
    if (port.dataset.enabled !== 'true' || port.dataset.mouseleave === 'false' ||
        port.dataset.mouseout === 'false' || mouseSetting('mouseInterpolation') === 0) {
      stopMousePath();
      return;
    }
    const now = Date.now();
    if (now - path.started >= 1500 || now - path.lastTick >= 100) {
      moveMousePath(path, path.destination, true);
      stopMousePath();
      reentry.mouse = false;
      return;
    }
    path.lastTick = now;
    const dx = path.destination.x - path.position.x;
    const dy = path.destination.y - path.position.y;
    const remaining = Math.hypot(dx, dy);
    if (remaining <= 0.75 && Math.hypot(path.velocity.x, path.velocity.y) <= 0.75) {
      moveMousePath(path, path.destination, true);
      stopMousePath();
      reentry.mouse = false;
      return;
    }

    // Follow the latest position like a drawing-app stabilizer. The low-pass
    // position filter handles distance; retained velocity rounds off turns.
    const interpolation = mouseSetting('mouseInterpolation') / 100;
    const alpha = 1 - Math.exp(-16 / (12 + interpolation * 140));
    const ease = value => value * value * (3 - 2 * value);
    const startFactor = 1 - mouseSetting('mouseStartSmoothness') / 125 *
      (1 - ease(Math.min(1, (now - path.started) / 120)));
    const stopFactor = 1 - mouseSetting('mouseStopSmoothness') / 125 *
      (1 - ease(Math.min(1, remaining / 80)));
    const blend = 0.65 - interpolation * 0.2;
    path.velocity.x = path.velocity.x * (1 - blend) + dx * alpha * startFactor * stopFactor * blend;
    path.velocity.y = path.velocity.y * (1 - blend) + dy * alpha * startFactor * stopFactor * blend;
    const end = {
      x: path.position.x + path.velocity.x,
      y: path.position.y + path.velocity.y
    };
    moveMousePath(path, end, true);
    if (mousePath === path) {
      path.timer = setTimeout(tickMousePath, 16);
    }
  };
  const replayMousePath = endEvent => {
    const start = mouseExitPoint;
    const end = {x: endEvent.clientX, y: endEvent.clientY};
    const exitTarget = mouseExitTarget;
    mouseExitPoint = undefined;
    mouseExitTarget = undefined;
    if (!start || !Number.isFinite(start.x) || !Number.isFinite(start.y) ||
        !Number.isFinite(end.x) || !Number.isFinite(end.y) ||
        typeof document.elementFromPoint !== 'function' || typeof MouseEvent !== 'function') {
      return;
    }

    stopMousePath();
    const path = {
      position: start,
      destination: end,
      target: exitTarget,
      ancestors: exitTarget ? ancestors(exitTarget) : [],
      velocity: {x: 0, y: 0},
      started: Date.now(),
      lastTick: Date.now()
    };
    if (mouseSetting('mouseInterpolation') === 0) {
      moveMousePath(path, end, false);
    }
    else {
      mousePath = path;
      path.timer = setTimeout(tickMousePath, 16);
    }
  };

  const onleave = e => {
    if (port.dataset.enabled === 'true' && port.dataset.mouseleave !== 'false') {
      if (isPageExit(e)) {
        stopMousePath();
        reentry[e.type.startsWith('pointer') ? 'pointer' : 'mouse'] = true;
      }
      if (isPageExit(e) || e.target === document || e.target === window) {
        return block(e);
      }
    }
  };
  window.addEventListener('mouseleave', onleave, true);
  window.addEventListener('pointerleave', onleave, true);

  const onout = e => {
    if (port.dataset.enabled === 'true' && port.dataset.mouseout !== 'false') {
      if (isPageExit(e)) {
        stopMousePath();
        reentry[e.type.startsWith('pointer') ? 'pointer' : 'mouse'] = true;
        if (e.type === 'mouseout') {
          mouseExitPoint = {x: e.clientX, y: e.clientY};
          mouseExitTarget = e.target;
        }
      }
      if (isPageExit(e) || e.target === document.documentElement || e.target === document.body) {
        return block(e);
      }
    }
  };
  window.addEventListener('mouseout', onout, true);
  window.addEventListener('pointerout', onout, true);

  const onenter = e => {
    const family = e.type.startsWith('pointer') ? 'pointer' : 'mouse';
    if (
      port.dataset.enabled === 'true' &&
      port.dataset.mouseleave !== 'false' &&
      reentry[family] &&
      isPageExit(e)
    ) {
      if (family === 'mouse') {
        replayMousePath(e);
      }
      return block(e);
    }
  };
  window.addEventListener('mouseenter', onenter, true);
  window.addEventListener('pointerenter', onenter, true);

  const onover = e => {
    const family = e.type.startsWith('pointer') ? 'pointer' : 'mouse';
    if (
      port.dataset.enabled === 'true' &&
      port.dataset.mouseout !== 'false' &&
      reentry[family] &&
      isPageExit(e)
    ) {
      return block(e);
    }
  };
  window.addEventListener('mouseover', onover, true);
  window.addEventListener('pointerover', onover, true);

  window.addEventListener('mousemove', e => {
    if (syntheticMouseMove) return;
    if (mousePath) {
      if (Date.now() - mousePath.lastTick >= 100 ||
          Date.now() - mousePath.started >= 1500) {
        stopMousePath();
        reentry.mouse = false;
        return;
      }
      if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
        mousePath.destination = {x: e.clientX, y: e.clientY};
      }
      return block(e);
    }
    mouseExitPoint = undefined;
    reentry.mouse = false;
  }, true);
  window.addEventListener('pointermove', e => {
    if (mousePath && (e.pointerType === 'mouse' || !e.pointerType)) {
      if (Date.now() - mousePath.lastTick < 100 &&
          Date.now() - mousePath.started < 1500) return block(e);
      stopMousePath();
      reentry.mouse = false;
    }
    reentry.pointer = false;
  }, true);
  const snapMousePath = e => {
    if (!mousePath || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    const path = mousePath;
    stopMousePath();
    moveMousePath(path, {x: e.clientX, y: e.clientY}, true);
    reentry.mouse = false;
  };
  window.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || !e.pointerType) snapMousePath(e);
  }, true);
  window.addEventListener('mousedown', snapMousePath, true);

  /* keyboard */
  const shouldBlockKey = e => {
    const keys = new Set((port.dataset.blockedKeys || '').split('\n').filter(Boolean));
    if (keys.has(String(e.key).toLowerCase()) ||
        keys.has(String(e.code).toLowerCase()) ||
        keys.has(String(e.keyCode))) {
      return true;
    }
    try {
      return keys.has('altgraph') && e.getModifierState('AltGraph');
    }
    catch (error) {
      return false;
    }
  };

  const onkey = e => {
    if (
      port.dataset.enabled === 'true' &&
      port.dataset.keyboard !== 'false' &&
      shouldBlockKey(e)
    ) {
      return block(e);
    }
  };
  window.addEventListener('keydown', onkey, true);
  window.addEventListener('keypress', onkey, true);
  window.addEventListener('keyup', onkey, true);

  /* requestAnimationFrame */
  let lastTime = 0;
  window.requestAnimationFrame = new Proxy(window.requestAnimationFrame, {
    apply(target, self, args) {
      if (port.dataset.enabled === 'true' && original('hidden')) {
        const currTime = Date.now();
        const timeToCall = Math.max(0, 16 - (currTime - lastTime));
        const id = setTimeout(function() {
          args[0](performance.now());
        }, timeToCall);
        lastTime = currTime + timeToCall;
        return id;
      }
      else {
        return Reflect.apply(target, self, args);
      }
    }
  });
  window.cancelAnimationFrame = new Proxy(window.cancelAnimationFrame, {
    apply(target, self, args) {
      if (port.dataset.enabled === 'true' && original('hidden')) {
        clearTimeout(args[0]);
      }
      return Reflect.apply(target, self, args);
    }
  });
}
