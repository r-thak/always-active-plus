#!/usr/bin/env node

// Run the actual injected script against Chrome's DOM and native mouse input.
// CHROME_BIN can point to another Chromium-based browser.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = readFileSync(join(root, 'v3/data/inject/main.js'), 'utf8');
const isolatedSource = readFileSync(join(root, 'v3/data/inject/isolated.js'), 'utf8');
const chromeBin = process.env.CHROME_BIN ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = mkdtempSync(join(tmpdir(), 'always-active-browser-'));
const unpacked = process.env.TEST_UNPACKED === '1';
const liveSite = process.env.TEST_SITE === '1';
const canvasOnly = process.env.TEST_CANVAS_ONLY === '1';
const overlayInsideCanvas = process.env.TEST_OVERLAY === '1';
const osOverlayGap = process.env.TEST_OS_OVERLAY === '1';
const secondEntry = process.env.TEST_SECOND_ENTRY === '1';
const settingsMode = process.env.TEST_SETTINGS === '1';
const html = `
  <style>body{margin:0}div{position:absolute;top:0;height:400px;width:250px}</style>
  <div id="left" style="left:0;background:red"></div>
  <div id="right" style="left:250px;background:blue"></div>
`;
const server = unpacked ? createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(html);
}).listen(0, '127.0.0.1') : null;
if (server) await new Promise(resolve => server.once('listening', resolve));
const chrome = spawn(chromeBin, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
  '--no-default-browser-check',
  ...(unpacked ? [
    '--enable-unsafe-extension-debugging', '--remote-debugging-pipe'
  ] : ['--disable-extensions', '--remote-debugging-port=0']),
  `--user-data-dir=${profile}`, 'about:blank'
], {stdio: unpacked ? ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] : 'ignore'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;

try {
  let id = 0;
  const pending = new Map();
  const onMessage = data => {
    const response = JSON.parse(data);
    if (!pending.has(response.id)) return;
    pending.get(response.id)(response);
    pending.delete(response.id);
  };
  let pageSession;
  if (unpacked) {
    let buffer = '';
    chrome.stdio[4].on('data', data => {
      buffer += data.toString();
      let boundary;
      while ((boundary = buffer.indexOf('\0')) >= 0) {
        onMessage(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 1);
      }
    });
  }
  else {
    let port;
    for (let i = 0; i < 100; i += 1) {
      try {
        port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
        break;
      }
      catch (error) {
        if (chrome.exitCode !== null) throw Error('Chrome exited before opening DevTools');
        await sleep(50);
      }
    }
    assert.ok(port, 'Chrome did not open DevTools');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = pages.find(p => p.type === 'page');
    assert.ok(page, 'Chrome did not open a page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, {once: true});
      ws.addEventListener('error', reject, {once: true});
    });
    ws.addEventListener('message', ({data}) => onMessage(data));
  }
  const send = (method, params = {}, browser = false) => new Promise((resolve, reject) => {
    const next = ++id;
    pending.set(next, response => response.error ? reject(Error(response.error.message)) : resolve(response.result));
    const message = JSON.stringify({id: next, method, params,
      ...(!browser && pageSession ? {sessionId: pageSession} : {})});
    if (unpacked) chrome.stdio[3].write(message + '\0');
    else ws.send(message);
  });
  if (unpacked) {
    await send('Extensions.loadUnpacked', {path: join(root, 'v3')}, true);
    const {targetId} = await send('Target.createTarget', {url: 'about:blank'}, true);
    ({sessionId: pageSession} = await send('Target.attachToTarget', {
      targetId, flatten: true
    }, true));
  }
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression, returnByValue: true});
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const move = (x, y, buttons = 0) => send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y, buttons
  });
  const pageUrl = liveSite ? 'https://www.dpionmouse.com/es/mouse-movement-counter/' :
    unpacked ? `http://127.0.0.1:${server.address().port}/` :
    'data:text/html,' + encodeURIComponent(html);
  const setup = async () => {
    await send('Page.navigate', {url: pageUrl});
    for (let i = 0; i < 100; i += 1) {
      if (await evaluate('document.readyState') === 'complete') break;
      await sleep(20);
    }
    if (unpacked) {
      let active = false;
      for (let attempt = 0; attempt < 5 && !active; attempt += 1) {
        for (let i = 0; i < 10; i += 1) {
          active = Boolean(await evaluate("document.getElementById('lwys-ctv-port')?.dataset.mouseInterpolation"));
          if (active) break;
          await sleep(100);
        }
        if (!active) await send('Page.reload');
      }
      assert.ok(active, 'Unpacked extension did not inject its page script');
    }
    else {
      await evaluate(source);
      await evaluate(`(() => {
        window.chrome ||= {};
        chrome.storage = {
          local: {get: (defaults, callback) => callback(defaults)},
          onChanged: {addListener() {}}
        };
        chrome.runtime = {sendMessage() {}};
      })()`);
      await evaluate(isolatedSource);
    }
    await evaluate(`(() => {
      window.testMoves = [];
      window.testPointerMoves = [];
      window.testPointerRawMoves = [];
      window.testBoundaries = [];
      document.addEventListener('mousemove', e => testMoves.push({
        x: e.clientX, y: e.clientY, trusted: e.isTrusted, target: e.target.id
      }), true);
      document.addEventListener('pointermove', e => testPointerMoves.push({
        x: e.clientX, y: e.clientY, buttons: e.buttons, trusted: e.isTrusted
      }), true);
      document.addEventListener('pointerrawupdate', e => testPointerRawMoves.push({
        x: e.clientX, y: e.clientY, buttons: e.buttons, trusted: e.isTrusted
      }), true);
      for (const type of ['mouseenter', 'mouseleave']) {
        document.addEventListener(type, e => testBoundaries.push({
          type, target: e.target.id, trusted: e.isTrusted
        }), true);
      }
    })()`);
    const settings = await evaluate(`({
      connected: document.getElementById('lwys-ctv-port').isConnected,
      enabled: document.getElementById('lwys-ctv-port').dataset.enabled,
      interpolation: document.getElementById('lwys-ctv-port').dataset.mouseInterpolation
    })`);
    assert.deepEqual(settings, {connected: true, enabled: 'true', interpolation: '0.13'});
  };
  const moves = () => evaluate('window.testMoves');

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 500, height: 400, deviceScaleFactor: 1, mobile: false
  });
  if (unpacked) await sleep(1000);
  await setup();
  if (settingsMode) {
    const distanceAfter = async (settings, destination, wait) => {
      await setup();
      await evaluate(`(() => {
        const data = document.getElementById('lwys-ctv-port').dataset;
        Object.assign(data, ${JSON.stringify(settings)});
      })()`);
      await move(100, 100);
      await move(150, 100);
      await evaluate("window.dispatchEvent(new Event('blur'))");
      await move(destination, 100);
      await sleep(wait);
      const generated = (await moves()).filter(point => !point.trusted);
      assert.ok(generated.length > 0, 'The setting produced no interpolated movement');
      return generated.at(-1).x;
    };
    const fast = await distanceAfter({mouseInterpolation: '0.1',
      mouseStartSmoothness: '0', mouseStopSmoothness: '0'}, 450, 250);
    const slow = await distanceAfter({mouseInterpolation: '0.9',
      mouseStartSmoothness: '0', mouseStopSmoothness: '0'}, 450, 250);
    assert.ok(fast > slow + 70, `Interpolation slider had too little effect: ${fast} vs ${slow}`);
    const quickStart = await distanceAfter({mouseInterpolation: '0.2',
      mouseStartSmoothness: '0', mouseStopSmoothness: '0'}, 450, 120);
    const slowStart = await distanceAfter({mouseInterpolation: '0.2',
      mouseStartSmoothness: '2', mouseStopSmoothness: '0'}, 450, 120);
    assert.ok(quickStart > slowStart + 10,
      `Start smoothness had too little effect: ${quickStart} vs ${slowStart}`);
    const quickStop = await distanceAfter({mouseInterpolation: '0.2',
      mouseStartSmoothness: '0', mouseStopSmoothness: '0'}, 230, 300);
    const slowStop = await distanceAfter({mouseInterpolation: '0.2',
      mouseStartSmoothness: '0', mouseStopSmoothness: '2'}, 230, 300);
    assert.ok(quickStop > slowStop + 10,
      `Stop smoothness had too little effect: ${quickStop} vs ${slowStop}`);
    console.log('PASS: interpolation, start smoothness, and stop smoothness change real Chrome motion');
  }
  else if (liveSite) {
    await evaluate("document.getElementById('movement-canvas').scrollIntoView({block:'center',behavior:'instant'})");
    await sleep(500);
    const rect = await evaluate(`(() => {
      const r = document.getElementById('movement-canvas').getBoundingClientRect();
      return {left: r.left, top: r.top, right: r.right, bottom: r.bottom};
    })()`);
    const ax = Math.round(rect.left + 50);
    const bx = Math.round(Math.min(rect.right - 50, rect.left + 300));
    const y = Math.round((rect.top + rect.bottom) / 2);
    assert.ok(rect.top >= 0 && rect.bottom <= 400, 'Site canvas is outside the viewport');
    await evaluate(`(() => {
      window.canvasMoves = [];
      window.canvasLeaves = [];
      const canvas = document.getElementById('movement-canvas');
      canvas.addEventListener('pointermove', e => canvasMoves.push({
        x: e.clientX, y: e.clientY, trusted: e.isTrusted
      }));
      canvas.addEventListener('pointerleave', e => canvasLeaves.push(e.isTrusted));
    })()`);
    await move(ax, y);
    await move(ax + 20, y);
    const initialTrusted = await evaluate('window.canvasMoves.filter(point => point.trusted).length');
    if (secondEntry) {
      await evaluate("window.dispatchEvent(new Event('blur'))");
      await move(bx, y);
      await sleep(100);
      await evaluate("window.dispatchEvent(new Event('blur'))");
      await move(ax, y);
    }
    else if (osOverlayGap) {
      // Keep both coordinates within the canvas across a quiet overlay gap.
      await sleep(40);
    }
    else if (overlayInsideCanvas) {
      await evaluate(`(() => {
        const overlay = document.createElement('div');
        overlay.id = 'interpolation-test-overlay';
        Object.assign(overlay.style, {
          position: 'fixed',
          left: '${Math.round(rect.left + 120)}px',
          top: '${Math.round(rect.top + 20)}px',
          width: '110px',
          height: '${Math.round(rect.bottom - rect.top - 40)}px',
          zIndex: '99999'
        });
        document.body.append(overlay);
      })()`);
      await move(Math.round(rect.left + 160), y);
    }
    else {
      await move(ax + 20, Math.round(rect.top + 10));
      await move(ax + 20, Math.round(rect.top - 10));
      if (!canvasOnly) {
        await move(ax + 20, -20);
        await evaluate("window.dispatchEvent(new Event('blur'))");
      }
    }
    await sleep(50);
    if (osOverlayGap) {
      await move(bx, y);
      for (const offset of [-40, 40, -40, 40]) await move(bx + 20, y + offset);
    }
    else if (!secondEntry) await move(bx, y);
    await sleep(2500);
    const {canvasMoves, canvasLeaves, count} = await evaluate(`({
      canvasMoves, canvasLeaves,
      count: Number(document.getElementById('counter-events')?.textContent.replaceAll(',', ''))
    })`);
    const beforeExit = canvasMoves.filter(e => e.trusted);
    const generated = canvasMoves.filter(e => !e.trusted);
    const first = generated[0];
    const last = generated.at(-1);
    if (canvasOnly || overlayInsideCanvas) {
      assert.equal(generated.length, 0, 'A DOM transition started interpolation');
      assert.ok(beforeExit.some(point => point.x === bx && point.y === y),
        'Ordinary native movement was suppressed');
      if (canvasOnly) assert.ok(canvasLeaves.length > 0);
      if (overlayInsideCanvas) assert.equal(canvasLeaves.length, 0);
      console.log(`PASS: ${overlayInsideCanvas ? 'DOM overlay' : 'canvas exit'} does not interpolate`);
    }
    else if (secondEntry) {
      assert.equal(canvasLeaves.length, 0);
      assert.equal(beforeExit.length, initialTrusted, 'A native return move reached the canvas');
      assert.ok(generated.length > 30, 'The queued entries produced too few generated moves');
      assert.ok(Math.max(...generated.map(point => point.x)) >= bx - 5,
        'The second entry skipped the first destination');
      assert.ok(Math.hypot(last.x - ax, last.y - y) < 2,
        'The queued path did not reach the second destination');
      assert.ok(generated.every((point, i) => i === 0 ||
        Math.hypot(point.x - generated[i - 1].x, point.y - generated[i - 1].y) < 20),
      'The generated cursor snapped between entries');
      console.log('PASS: two focus returns interpolate in order without snapping');
    }
    else {
      if (overlayInsideCanvas || osOverlayGap) {
        assert.equal(canvasLeaves.length, 0,
          'The site reset its drawing point when an overlay covered the canvas');
      }
      else {
        assert.ok(canvasLeaves.length > 0, 'The site did not reset tracking on pointerleave');
      }
      assert.ok(generated.length > 20,
        `The site did not receive enough generated pointer moves: ${JSON.stringify({
          canvasLeaves, beforeExit, generated
        })}`);
      assert.ok(!beforeExit.some(point => point.x === bx && point.y === y),
        'A native pointermove reached the canvas at re-entry');
      assert.ok(Math.hypot(first.x - beforeExit.at(-1).x, first.y - beforeExit.at(-1).y) < 3,
        'Generated moves started away from the canvas last pre-exit point');
      assert.ok(generated.every((point, i) => i === 0 ||
        Math.hypot(point.x - generated[i - 1].x, point.y - generated[i - 1].y) < 20),
      'The site received a snapping move');
      const expectedEnd = osOverlayGap ? {x: bx + 20, y: y + 40} : {x: bx, y};
      assert.ok(Math.hypot(last.x - expectedEnd.x, last.y - expectedEnd.y) < 2,
        'Generated moves did not reach the last re-entry move');
      if (osOverlayGap) {
        const start = beforeExit.at(-1);
        assert.ok(generated.every(point => point.x >= start.x - 2 && point.x <= bx + 22 &&
          point.y >= y - 42 && point.y <= y + 42),
        'The curve overshot while following rapid up and down moves');
      }
      assert.equal(count, canvasMoves.length, 'Site counter did not observe the generated moves');
      console.log(`PASS: DPIonMouse canvas receives gradual moves after ${osOverlayGap ?
        'focus loss' : overlayInsideCanvas ? 'DOM overlay' : canvasOnly ? 'canvas' : 'page'} re-entry`);
    }
  }
  else {
  await move(100, 100);
  await move(150, 100);
  await move(520, 100); // Chrome reports this off-page coordinate on mouseout.
  await evaluate("window.dispatchEvent(new Event('blur'))");
  await sleep(30);
  await move(350, 100);
  await sleep(55);
  const entryMouseMoves = await moves();
  const entryPointerMoves = await evaluate('window.testPointerMoves');
  assert.ok(!entryMouseMoves.some(e => e.trusted && e.x === 350 && e.y === 100),
    'Native mousemove reached the page at the re-entry point');
  assert.ok(!entryPointerMoves.some(e => e.trusted && e.x === 350 && e.y === 100),
    'Native pointermove reached the page at the re-entry point');
  const earlyMoves = (await moves()).filter(e => !e.trusted);
  assert.ok(earlyMoves.length >= 2 && earlyMoves.at(-1).x < 250,
    'Re-entry reached the entry point before gradually retracing the gap');
  await move(350, 250); // Turn while the generated cursor is still catching up.
  await sleep(20);
  await move(450, 120); // Third point should bend the path through the previous one.
  assert.ok(!(await evaluate('window.testPointerMoves')).some(e => e.trusted && e.x === 350 && e.y === 250),
    'Native pointermove reached the page during interpolation');
  await sleep(2500);
  const curve = await moves();
  const generated = curve.filter(e => !e.trusted);
  const pointerCurve = (await evaluate('window.testPointerMoves')).filter(e => !e.trusted);
  const rawCurve = (await evaluate('window.testPointerRawMoves')).filter(e => !e.trusted);
  const steps = generated.slice(1).map((point, i) =>
    Math.hypot(point.x - generated[i].x, point.y - generated[i].y));
  assert.ok(generated.length > 4, 'Expected interpolated mousemove events');
  assert.ok(pointerCurve.length > 4, 'Expected interpolated pointermove events');
  assert.ok(rawCurve.length > 4, 'Expected interpolated pointerrawupdate events');
  assert.ok(Math.abs(pointerCurve.at(-1).x - 450) < 2 &&
    Math.abs(pointerCurve.at(-1).y - 120) < 2,
  'Interpolated pointer cursor did not catch up');
  assert.ok(generated[0].x >= 150 && generated[0].x < 350,
    `First interpolated move started outside the in-page path: ${generated[0].x}`);
  assert.ok(generated.some(e => e.x > 340 && e.x < 370 && e.y > 120 && e.y < 240),
    'Expected a curved path toward the recorded middle point');
  const peak = generated.reduce((highest, point) => point.y > highest.y ? point : highest);
  assert.ok(Math.hypot(peak.x - 350, peak.y - 250) < 25,
    'The generated curve skipped the recorded middle point');
  assert.ok(Math.max(...generated.map(e => e.x)) < 475,
    'The generated cursor overshot the turn');
  assert.ok(Math.max(...steps) < 80, 'A generated move jumped farther than the speed limit');
  assert.ok(steps[0] < Math.max(...steps) * 0.5 &&
    steps.at(-1) < Math.max(...steps) * 0.5,
    'The generated speed did not ease in and out');
  assert.ok(generated.some(e => e.target === 'right'),
    'Expected generated moves to reach the new element');
  const boundaries = await evaluate('window.testBoundaries');
  assert.ok(boundaries.some(e => !e.trusted && e.type === 'mouseleave' && e.target === 'left') &&
    boundaries.some(e => !e.trusted && e.type === 'mouseenter' && e.target === 'right'),
    'Expected generated hover transitions across the element boundary');
  assert.ok(Math.abs(generated.at(-1).x - 450) < 2 &&
    Math.abs(generated.at(-1).y - 120) < 2, 'Interpolated cursor did not catch up');
  await move(460, 130);
  assert.ok((await moves()).some(e => e.trusted && e.x === 460 && e.y === 130),
    'Native mousemove did not resume after interpolation');
  console.log('PASS: re-entry follows an in-page curve, crosses elements, and releases native moves');

  await setup();
  await move(100, 100);
  await move(150, 100);
  await move(520, 100);
  await evaluate("window.dispatchEvent(new Event('blur'))");
  await sleep(30);
  await move(350, 100);
  await sleep(30);
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: 420, y: 250, button: 'left', clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: 420, y: 250, button: 'left', clickCount: 1
  });
  await move(430, 260);
  const afterClick = await moves();
  assert.ok(afterClick.some(e => !e.trusted && e.x === 420 && e.y === 250),
    'Click did not snap the generated cursor');
  assert.ok(afterClick.some(e => e.trusted && e.x === 430 && e.y === 260),
    'Native mousemove did not resume after click');
  console.log('PASS: click snaps interpolation and native mousemove resumes');

  await setup();
  await move(100, 100);
  await move(150, 100);
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: 150, y: 100, button: 'left', buttons: 1, clickCount: 1
  });
  await move(520, 100, 1);
  await evaluate("window.dispatchEvent(new Event('blur'))");
  await sleep(30);
  await move(350, 100, 1);
  await sleep(50);
  await move(350, 250, 1);
  await sleep(2000);
  const dragged = (await evaluate('window.testPointerMoves')).filter(e => !e.trusted);
  assert.ok(dragged.length > 4 && dragged.every(e => e.buttons === 1),
    'Generated pointer movement did not preserve the held button');
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: 350, y: 250, button: 'left', buttons: 0, clickCount: 1
  });
  console.log('PASS: held-button pointer movement stays interpolated');
  }
}
finally {
  ws?.close();
  chrome.kill();
  if (chrome.exitCode === null) {
    await Promise.race([
      new Promise(resolve => chrome.once('exit', resolve)),
      sleep(2000)
    ]);
  }
  rmSync(profile, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  if (server) await new Promise(resolve => server.close(resolve));
}
