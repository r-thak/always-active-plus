/* global navigation */
{
  /* port is used to communicate between chrome and page scripts */
  let port = document.getElementById('lwys-ctv-port');
  if (!port) {
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
  let focusGap;
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
    const visiblePoint = lastMousePoint &&
      lastMousePoint.x >= 0 && lastMousePoint.y >= 0 &&
      lastMousePoint.x < window.innerWidth && lastMousePoint.y < window.innerHeight;
    if ((e.target === document || e.target === window) &&
        port.dataset.enabled === 'true' && lastMousePoint &&
        Number(port.dataset.mouseInterpolation) > 0) {
      focusGap = {
        point: visiblePoint ? lastMousePoint : lastPagePoint || lastMousePoint,
        target: visiblePoint ? lastMouseTarget : lastPageTarget || lastMouseTarget
      };
    }
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
  let priorMousePoint;
  let lastMousePoint;
  let lastMouseTarget;
  let lastPagePoint;
  let lastPageTarget;
  let lastRealMoveTime;
  let mousePath;
  let syntheticMouseMove = false;
  let syntheticPointerMove = false;
  const mouseSetting = name => Math.max(0, Math.min(2, Number(port.dataset[name]) || 0));
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
  const fire = (target, type, x, y, relatedTarget, buttons = 0) => {
    if (!target?.dispatchEvent) return;
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: type === 'mouseout' || type === 'mouseover' || type === 'mousemove',
      cancelable: true,
      clientX: x,
      clientY: y,
      buttons,
      relatedTarget: relatedTarget || null,
      view: window
    }));
  };
  const coveredCanvasExit = e => {
    if (e.target?.tagName !== 'CANVAS' || !e.relatedTarget ||
        typeof e.target.getBoundingClientRect !== 'function') return false;
    const rect = e.target.getBoundingClientRect();
    return e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top && e.clientY <= rect.bottom;
  };
  const rememberPointer = (path, e) => {
    if (Number.isFinite(e.buttons)) path.buttons = e.buttons;
    if (Number.isFinite(e.pointerId)) path.pointerId = e.pointerId;
    if (typeof e.pointerType === 'string' && e.pointerType) path.pointerType = e.pointerType;
    if (typeof e.isPrimary === 'boolean') path.isPrimary = e.isPrimary;
    if (Number.isFinite(e.pressure)) path.pressure = e.pressure;
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
    priorMousePoint = start;
    lastMousePoint = end;
    lastMouseTarget = path.target;
    if (end.x >= 0 && end.y >= 0 && end.x < window.innerWidth && end.y < window.innerHeight) {
      lastPagePoint = end;
      lastPageTarget = path.target;
    }
    const moveTarget = path.logicalTarget || path.target;
    if (focusGap) {
      focusGap.point = end;
      focusGap.target = moveTarget;
    }
    if (emitMove && moveTarget) {
      syntheticMouseMove = true;
      syntheticPointerMove = true;
      try {
        if (typeof PointerEvent === 'function') {
          const properties = {
            bubbles: true,
            cancelable: true,
            clientX: end.x,
            clientY: end.y,
            buttons: path.buttons,
            pressure: path.pressure,
            pointerId: path.pointerId,
            pointerType: path.pointerType,
            isPrimary: path.isPrimary,
            view: window
          };
          moveTarget.dispatchEvent(new PointerEvent('pointerrawupdate', properties));
          moveTarget.dispatchEvent(new PointerEvent('pointermove', properties));
        }
        fire(moveTarget, 'mousemove', end.x, end.y, null, path.buttons);
      }
      finally {
        syntheticMouseMove = false;
        syntheticPointerMove = false;
      }
    }
  };
  const distanceBetween = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const curveTangent = (before, at, after, beforeLength, afterLength, scale) => {
    const component = axis => {
      const incoming = at[axis] - before[axis];
      const outgoing = after[axis] - at[axis];
      if (incoming * outgoing <= 0) return 0;
      const smooth = Math.abs(outgoing) * scale / (beforeLength + afterLength);
      const monotoneLimit = 3 * Math.min(Math.abs(incoming), Math.abs(outgoing));
      return Math.sign(outgoing) * Math.min(smooth, monotoneLimit);
    };
    return {x: component('x'), y: component('y')};
  };
  const buildMouseCurve = path => {
    const samples = [{distance: 0, point: path.points[0]}];
    let distance = 0;
    for (let i = 0; i < path.points.length - 1; i += 1) {
      const start = path.points[i];
      const end = path.points[i + 1];
      const segmentLength = distanceBetween(start, end);
      const previous = path.points[i - 1];
      const next = path.points[i + 2];
      const previousLength = previous ? distanceBetween(previous, start) : 0;
      const nextLength = next ? distanceBetween(end, next) : 0;
      const priorSpeed = Math.hypot(path.velocity.x, path.velocity.y);
      const alignment = priorSpeed > 1 && segmentLength > 0 ? Math.max(0,
        (path.velocity.x * (end.x - start.x) + path.velocity.y * (end.y - start.y)) /
          (priorSpeed * segmentLength)) : 0;
      const startTangent = i === 0 && alignment > 0 ? {
        x: (end.x - start.x) * alignment,
        y: (end.y - start.y) * alignment
      } : previous ? curveTangent(previous, start, end,
          previousLength, segmentLength, segmentLength) :
        {x: end.x - start.x, y: end.y - start.y};
      const endTangent = next ? curveTangent(start, end, next,
        segmentLength, nextLength, segmentLength) :
        {x: end.x - start.x, y: end.y - start.y};
      const steps = Math.max(8, Math.ceil(segmentLength / 8));
      let previousPoint = samples[samples.length - 1].point;
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        const point = {
          x: (2 * t3 - 3 * t2 + 1) * start.x + (t3 - 2 * t2 + t) * startTangent.x +
            (-2 * t3 + 3 * t2) * end.x + (t3 - t2) * endTangent.x,
          y: (2 * t3 - 3 * t2 + 1) * start.y + (t3 - 2 * t2 + t) * startTangent.y +
            (-2 * t3 + 3 * t2) * end.y + (t3 - t2) * endTangent.y
        };
        distance += distanceBetween(previousPoint, point);
        samples.push({distance, point, segment: i});
        previousPoint = point;
      }
    }
    path.curve = samples;
    path.length = distance;
    path.progress = 0;
  };
  const appendMousePoint = (path, point) => {
    const last = path.points[path.points.length - 1];
    if (distanceBetween(last, point) < 0.5) return;
    if (path.curve) {
      const remaining = path.curve.find(sample => sample.distance > path.progress)?.segment ??
        path.points.length - 1;
      path.points = [path.position, ...path.points.slice(remaining + 1)];
    }
    path.points.push(point);
    buildMouseCurve(path);
  };
  const pointAlongMousePath = (path, distance) => {
    const samples = path.curve;
    for (let i = 1; i < samples.length; i += 1) {
      if (distance <= samples[i].distance) {
        const start = samples[i - 1];
        const end = samples[i];
        const fraction = (distance - start.distance) / (end.distance - start.distance || 1);
        return {
          x: start.point.x + (end.point.x - start.point.x) * fraction,
          y: start.point.y + (end.point.y - start.point.y) * fraction
        };
      }
    }
    return path.points[path.points.length - 1];
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
    // Cap elapsed time so a throttled timer cannot produce a long jump.
    const dt = Math.min(0.032, Math.max(0.008, (now - path.lastTick) / 1000));
    path.lastTick = now;
    const destination = path.points[path.points.length - 1];
    const gap = distanceBetween(path.position, destination);
    const remaining = path.length - path.progress;
    if (path.progress >= path.length) {
      if (gap > 0) moveMousePath(path, destination, true);
      stopMousePath();
      reentry.mouse = false;
      return;
    }

    // Move along a curve through the recorded positions at a bounded speed.
    // Rebuilding the curve on each real move starts at the generated position,
    // so new input changes the direction without teleporting the cursor.
    const interpolation = mouseSetting('mouseInterpolation');
    const startSmoothness = mouseSetting('mouseStartSmoothness');
    const stopSmoothness = mouseSetting('mouseStopSmoothness');
    const acceleration = 4000 * Math.pow(0.06, startSmoothness);
    const braking = 4000 * Math.pow(0.06, stopSmoothness);
    const cruise = 1200 * Math.pow(0.08, interpolation);
    const targetSpeed = Math.min(cruise, Math.sqrt(2 * braking * remaining));
    path.speed += Math.max(-braking * dt,
      Math.min(acceleration * dt, targetSpeed - path.speed));
    const oldPosition = path.position;
    path.progress = Math.min(path.length, path.progress + path.speed * dt);
    const end = pointAlongMousePath(path, path.progress);
    path.velocity = {
      x: (end.x - oldPosition.x) / dt,
      y: (end.y - oldPosition.y) / dt
    };
    moveMousePath(path, end, true);
    if (mousePath === path) {
      path.timer = setTimeout(tickMousePath, 16);
    }
  };
  const replayMousePath = endEvent => {
    const end = {x: endEvent.clientX, y: endEvent.clientY};
    const start = mouseExitPoint;
    const exitTarget = mouseExitTarget;
    mouseExitPoint = undefined;
    mouseExitTarget = undefined;
    focusGap = undefined;
    reentry.mouse = false;
    reentry.pointer = false;
    if (!start || !Number.isFinite(start.x) || !Number.isFinite(start.y) ||
        !Number.isFinite(end.x) || !Number.isFinite(end.y) ||
        typeof document.elementFromPoint !== 'function' || typeof MouseEvent !== 'function') {
      return;
    }
    stopMousePath();
    const path = {
      position: start,
      points: [start],
      length: 0,
      progress: 0,
      target: exitTarget,
      logicalTarget: exitTarget?.tagName === 'CANVAS' ? exitTarget : undefined,
      ancestors: exitTarget ? ancestors(exitTarget) : [],
      velocity: priorMousePoint && lastMousePoint ? {
        x: lastMousePoint.x - priorMousePoint.x,
        y: lastMousePoint.y - priorMousePoint.y
      } : {x: 0, y: 0},
      buttons: Number.isFinite(endEvent.buttons) ? endEvent.buttons : 0,
      pressure: Number.isFinite(endEvent.pressure) ? endEvent.pressure : 0,
      pointerId: Number.isFinite(endEvent.pointerId) ? endEvent.pointerId : 1,
      pointerType: endEvent.pointerType || 'mouse',
      isPrimary: endEvent.isPrimary !== false,
      speed: 0,
      lastTick: Date.now()
    };
    appendMousePoint(path, end);
    if (mouseSetting('mouseInterpolation') === 0) {
      moveMousePath(path, end, false);
    }
    else {
      mousePath = path;
      path.timer = setTimeout(tickMousePath, 16);
    }
  };
  const startPendingMousePath = e => {
    if (port.dataset.enabled !== 'true' ||
        mouseSetting('mouseInterpolation') === 0 ||
        !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return false;
    if (mousePath) {
      if (!mouseExitPoint && !focusGap) return false;
      appendMousePoint(mousePath, {x: e.clientX, y: e.clientY});
      rememberPointer(mousePath, e);
      mouseExitPoint = undefined;
      mouseExitTarget = undefined;
      focusGap = undefined;
      reentry.mouse = false;
      reentry.pointer = false;
      return true;
    }
    if (!mouseExitPoint && focusGap) {
      mouseExitPoint = focusGap.point;
      mouseExitTarget = focusGap.target;
    }
    if (!mouseExitPoint && lastMousePoint && lastRealMoveTime !== undefined &&
        Date.now() - lastRealMoveTime >= 32 &&
        distanceBetween(lastMousePoint, {x: e.clientX, y: e.clientY}) >= 24) {
      mouseExitPoint = lastMousePoint;
      mouseExitTarget = lastMouseTarget;
    }
    if (!mouseExitPoint) return false;
    replayMousePath(e);
    return Boolean(mousePath);
  };

  const onleave = e => {
    if (port.dataset.enabled === 'true' && port.dataset.mouseleave !== 'false') {
      if (coveredCanvasExit(e)) return block(e);
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
      if (coveredCanvasExit(e)) return block(e);
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
    if (startPendingMousePath(e)) return block(e);
    if (
      port.dataset.enabled === 'true' &&
      port.dataset.mouseleave !== 'false' &&
      reentry[family] &&
      isPageExit(e)
    ) {
      startPendingMousePath(e);
      return block(e);
    }
  };
  window.addEventListener('mouseenter', onenter, true);
  window.addEventListener('pointerenter', onenter, true);

  const onover = e => {
    const family = e.type.startsWith('pointer') ? 'pointer' : 'mouse';
    if (startPendingMousePath(e)) return block(e);
    if (
      port.dataset.enabled === 'true' &&
      port.dataset.mouseout !== 'false' &&
      reentry[family] &&
      isPageExit(e)
    ) {
      startPendingMousePath(e);
      return block(e);
    }
  };
  window.addEventListener('mouseover', onover, true);
  window.addEventListener('pointerover', onover, true);

  const rememberRealPoint = e => {
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    const point = {x: e.clientX, y: e.clientY};
    if (!lastMousePoint || distanceBetween(lastMousePoint, point) >= 0.5) {
      priorMousePoint = lastMousePoint;
      lastMousePoint = point;
    }
    lastMouseTarget = e.target;
    if (point.x >= 0 && point.y >= 0 && point.x < window.innerWidth && point.y < window.innerHeight) {
      lastPagePoint = point;
      lastPageTarget = e.target;
    }
  };

  window.addEventListener('mousemove', e => {
    if (syntheticMouseMove) return;
    if (startPendingMousePath(e)) return block(e);
    lastRealMoveTime = Date.now();
    if (mousePath) {
      rememberPointer(mousePath, e);
      if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
        appendMousePoint(mousePath, {x: e.clientX, y: e.clientY});
      }
      if (Date.now() - mousePath.lastTick > 100) {
        clearTimeout(mousePath.timer);
        mousePath.timer = setTimeout(tickMousePath, 0);
      }
      return block(e);
    }
    rememberRealPoint(e);
    mouseExitPoint = undefined;
    reentry.mouse = false;
  }, true);
  const onPointerMove = e => {
    if (syntheticPointerMove) return;
    if (startPendingMousePath(e)) return block(e);
    lastRealMoveTime = Date.now();
    if (mousePath) {
      rememberPointer(mousePath, e);
      if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
        appendMousePoint(mousePath, {x: e.clientX, y: e.clientY});
      }
      if (Date.now() - mousePath.lastTick > 100) {
        clearTimeout(mousePath.timer);
        mousePath.timer = setTimeout(tickMousePath, 0);
      }
      return block(e);
    }
    rememberRealPoint(e);
    reentry.pointer = false;
  };
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerrawupdate', onPointerMove, true);
  const snapMousePath = e => {
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    focusGap = undefined;
    if (!mousePath) {
      mouseExitPoint = undefined;
      mouseExitTarget = undefined;
      priorMousePoint = lastMousePoint;
      lastMousePoint = {x: e.clientX, y: e.clientY};
      lastMouseTarget = e.target;
      reentry.mouse = false;
      reentry.pointer = false;
      return;
    }
    const path = mousePath;
    rememberPointer(path, e);
    stopMousePath();
    path.logicalTarget = undefined;
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
