#!/usr/bin/env node

// Run the actual injected script against Chrome's DOM and native mouse input.
// CHROME_BIN can point to another Chromium-based browser.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
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
const chrome = spawn(chromeBin, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions',
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'
], {stdio: 'ignore'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;

try {
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
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ({data}) => {
    const response = JSON.parse(data);
    if (!pending.has(response.id)) return;
    pending.get(response.id)(response);
    pending.delete(response.id);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    pending.set(next, response => response.error ? reject(Error(response.error.message)) : resolve(response.result));
    ws.send(JSON.stringify({id: next, method, params}));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression, returnByValue: true});
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const move = (x, y) => send('Input.dispatchMouseEvent', {type: 'mouseMoved', x, y});
  const pageUrl = 'data:text/html,' + encodeURIComponent(`
    <style>body{margin:0}div{position:absolute;top:0;height:400px;width:250px}</style>
    <div id="left" style="left:0;background:red"></div>
    <div id="right" style="left:250px;background:blue"></div>
  `);
  const setup = async () => {
    await send('Page.navigate', {url: pageUrl});
    for (let i = 0; i < 100; i += 1) {
      if (await evaluate('document.readyState') === 'complete') break;
      await sleep(20);
    }
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
    await evaluate(`(() => {
      window.testMoves = [];
      window.testPointerMoves = [];
      window.testBoundaries = [];
      document.addEventListener('mousemove', e => testMoves.push({
        x: e.clientX, y: e.clientY, trusted: e.isTrusted, target: e.target.id
      }), true);
      document.addEventListener('pointermove', e => testPointerMoves.push({
        x: e.clientX, y: e.clientY, trusted: e.isTrusted
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
    assert.deepEqual(settings, {connected: true, enabled: 'true', interpolation: '35'});
  };
  const moves = () => evaluate('window.testMoves');

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 500, height: 400, deviceScaleFactor: 1, mobile: false
  });
  await setup();
  await move(100, 100);
  await move(150, 100);
  await move(520, 100); // Chrome reports this off-page coordinate on mouseout.
  await sleep(30);
  await move(350, 100);
  await sleep(55);
  await move(350, 250); // Turn while the generated cursor is still catching up.
  assert.ok((await evaluate('window.testPointerMoves')).some(e => e.trusted && e.x === 350 && e.y === 250),
    'Native pointermove was suppressed during mouse interpolation');
  await sleep(550);
  const curve = await moves();
  const generated = curve.filter(e => !e.trusted);
  assert.ok(generated.length > 4, 'Expected interpolated mousemove events');
  assert.ok(generated[0].x > 150 && generated[0].x < 350,
    `First interpolated move started outside the in-page path: ${generated[0].x}`);
  assert.ok(generated.some(e => e.x > 200 && e.x < 350 && e.y > 100 && e.y < 250),
    'Expected a curved path while following the new cursor position');
  assert.ok(generated.some(e => e.target === 'right'),
    'Expected generated moves to reach the new element');
  const boundaries = await evaluate('window.testBoundaries');
  assert.ok(boundaries.some(e => !e.trusted && e.type === 'mouseleave' && e.target === 'left') &&
    boundaries.some(e => !e.trusted && e.type === 'mouseenter' && e.target === 'right'),
    'Expected generated hover transitions across the element boundary');
  assert.ok(Math.abs(generated.at(-1).x - 350) < 2 &&
    Math.abs(generated.at(-1).y - 250) < 2, 'Interpolated cursor did not catch up');
  await move(360, 260);
  assert.ok((await moves()).some(e => e.trusted && e.x === 360 && e.y === 260),
    'Native mousemove did not resume after interpolation');
  console.log('PASS: re-entry follows an in-page curve, crosses elements, and releases native moves');

  await setup();
  await move(100, 100);
  await move(150, 100);
  await move(520, 100);
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
}
