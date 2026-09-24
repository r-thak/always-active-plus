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
  let replayingMousePath = false;
  const replayMousePath = endEvent => {
    const start = mouseExitPoint;
    const end = {x: endEvent.clientX, y: endEvent.clientY};
    mouseExitPoint = undefined;
    if (!start || !Number.isFinite(start.x) || !Number.isFinite(start.y) ||
        !Number.isFinite(end.x) || !Number.isFinite(end.y) ||
        typeof document.elementFromPoint !== 'function' || typeof MouseEvent !== 'function') {
      return;
    }

    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.ceil(distance / 8));
    const ancestors = element => {
      const result = [];
      for (let node = element; node && node !== document; node = node.parentNode) {
        if (node.dispatchEvent) result.push(node);
      }
      return result;
    };
    const fire = (target, type, x, y, relatedTarget) => {
      if (!target || !target.dispatchEvent) return;
      target.dispatchEvent(new MouseEvent(type, {
        bubbles: type === 'mousemove' || type === 'mouseover' || type === 'mouseout',
        cancelable: true,
        clientX: x,
        clientY: y,
        relatedTarget: relatedTarget || null,
        view: window
      }));
    };

    replayingMousePath = true;
    try {
      let previousTarget;
      let previousPath = [];
      for (let i = 0; i <= steps; i += 1) {
        const x = start.x + (end.x - start.x) * i / steps;
        const y = start.y + (end.y - start.y) * i / steps;
        const target = document.elementFromPoint(x, y);
        if (!target) continue;
        const path = ancestors(target);
        let common = 0;
        while (common < previousPath.length && common < path.length &&
            previousPath[previousPath.length - 1 - common] === path[path.length - 1 - common]) {
          common += 1;
        }
        if (previousTarget && previousTarget !== target) {
          fire(previousTarget, 'mouseout', x, y, target);
          for (let j = 0; j < previousPath.length - common; j += 1) {
            fire(previousPath[j], 'mouseleave', x, y, target);
          }
          fire(target, 'mouseover', x, y, previousTarget);
          for (let j = path.length - common - 1; j >= 0; j -= 1) {
            fire(path[j], 'mouseenter', x, y, previousTarget);
          }
        }
        fire(target, 'mousemove', x, y, null);
        previousTarget = target;
        previousPath = path;
      }
    }
    finally {
      replayingMousePath = false;
    }
  };

  const onleave = e => {
    if (port.dataset.enabled === 'true' && port.dataset.mouseleave !== 'false') {
      if (isPageExit(e)) {
        reentry[e.type.startsWith('pointer') ? 'pointer' : 'mouse'] = true;
        if (e.type === 'mouseleave' || e.type === 'mouseout') {
          mouseExitPoint = {x: e.clientX, y: e.clientY};
        }
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
        reentry[e.type.startsWith('pointer') ? 'pointer' : 'mouse'] = true;
        if (e.type === 'mouseout') {
          mouseExitPoint = {x: e.clientX, y: e.clientY};
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
      if (family === 'mouse' && !replayingMousePath) {
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

  window.addEventListener('mousemove', () => {
    if (!replayingMousePath) mouseExitPoint = undefined;
    reentry.mouse = false;
  }, true);
  window.addEventListener('pointermove', () => {
    reentry.pointer = false;
  }, true);

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
