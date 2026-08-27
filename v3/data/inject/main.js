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
  Object.defineProperty(document, 'visibilityState', {
    get() {
      if (port.dataset.enabled === 'false') {
        return port.dataset.hidden === 'true' ? 'hidden' : 'visible';
      }
      return 'visible';
    }
  });
  Object.defineProperty(document, 'webkitVisibilityState', {
    get() {
      if (port.dataset.enabled === 'false') {
        return port.dataset.hidden === 'true' ? 'hidden' : 'visible';
      }
      return 'visible';
    }
  });

  const vstate = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
  const once = {
    focus: true,
    // if document is hidden allow one time event
    visibilitychange: vstate.get.call(document) === 'hidden',
    webkitvisibilitychange: vstate.get.call(document) === 'hidden'
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
        const state = vstate.get.call(document);
        if (state === 'hidden') {
          if (port.dataset.enabled === 'true' && port.dataset.redirect !== 'false') {
            addEventListener('beforeunload', redirect);
          }
        }
      }
      catch (e) {}
    });
  }

  document.addEventListener('visibilitychange', e => {
    port.dispatchEvent(new Event('state'));
    if (port.dataset.enabled === 'true' && port.dataset.visibility !== 'false') {
      if (once.visibilitychange) {
        once.visibilitychange = false;
        return;
      }
      return block(e);
    }
  }, true);
  document.addEventListener('webkitvisibilitychange', e => {
    if (port.dataset.enabled === 'true' && port.dataset.visibility !== 'false') {
      if (once.webkitvisibilitychange) {
        once.webkitvisibilitychange = false;
        return;
      }
      return block(e);
    }
  }, true);
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
  Object.defineProperty(document, 'hidden', {
    get() {
      if (port.dataset.enabled === 'false') {
        return port.dataset.hidden === 'true';
      }
      return false;
    }
  });
  Object.defineProperty(document, 'webkitHidden', {
    get() {
      if (port.dataset.enabled === 'false') {
        return port.dataset.hidden === 'true';
      }
      return false;
    }
  });

  /* focus */
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
      if (e.target === document || e.target === window) {
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
      if (e.target === document || e.target === window) {
        return block(e);
      }
    }
  };
  document.addEventListener('blur', onblur, true);
  window.addEventListener('blur', onblur, true);

  /* mouse and pointer boundary events */
  const reentry = {
    mouse: false,
    pointer: false
  };

  const onleave = e => {
    if (port.dataset.enabled === 'true' && port.dataset.mouseleave !== 'false') {
      if (isPageExit(e)) {
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
        reentry[e.type.startsWith('pointer') ? 'pointer' : 'mouse'] = true;
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
      if (port.dataset.enabled === 'true' && port.dataset.hidden === 'true') {
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
      if (port.dataset.enabled === 'true' && port.dataset.hidden === 'true') {
        clearTimeout(args[0]);
      }
      return Reflect.apply(target, self, args);
    }
  });
}
