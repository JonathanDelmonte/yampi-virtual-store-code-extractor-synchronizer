// The download goes on with the editor in a background tab. With the built extension in Chromium,
// the fictitious editor and the fictitious rocket-like storefront (store pages, product pages, a
// 404, a redirect and a category that asks for calm), the test clicks "Baixar ZIP" with the
// storefront and then opens another tab in the same window. It checks that:
// - the editor tab was really hidden (its timers ran about once a second) and the download
//   finished by itself, reading every file through the editor;
// - the editor page held the operation's Web Lock while it ran, and let it go at the end;
// - the bar only moved forward and stayed below 99% while store or product pages were left;
// - the public reads shared the editor's store checks (before, two per read);
// - the ZIP holds the theme, the store's pages and the products' pages.
// Playwright keeps every page it is attached to visible and awake (focus emulation), so it only
// prepares the run and then disconnects; the rest goes through the DevTools protocol directly.
// Host names resolve nowhere: nothing reaches Yampi or a real store.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile, cp, rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {unzipSync} from 'fflate';
import {nativePanelDriver} from './side-panel-test.mjs';
import {extensionFiles} from './distribution.mjs';
import {SERVER_ORIGIN} from './fictitious-server.mjs';
const repository = path.resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'yampi-segundo-plano-'));
// The fictitious editor's "Ver prévia" link (src/demo/fixture.html).
const STOREFRONT = 'https://loja-exemplo.invalid';
// Each public read takes a while, as on a real network.
const LATENCY_MS = Number(process.env.BACKGROUND_LATENCY_MS || 80);
const LOCK = 'zirtuno-sync-operacao';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// A bare DevTools client, attached the way Playwright is not: without keeping pages visible.
async function devtools(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {socket.onopen = resolve; socket.onerror = reject;});
  let id = 0; const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data), waiter = message.id && pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {const next = ++id; pending.set(next, {resolve, reject}); socket.send(JSON.stringify({id: next, method, params, ...(sessionId ? {sessionId} : {})}));});
  const attach = async match => {
    const {targetInfos} = await send('Target.getTargets'), target = targetInfos.find(match);
    if (!target) throw new Error('Alvo do navegador não encontrado.');
    return (await send('Target.attachToTarget', {targetId: target.targetId, flatten: true})).sessionId;
  };
  const evaluate = async (sessionId, expression) => {
    const reply = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, sessionId);
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
    return reply.result.value;
  };
  return {send, attach, evaluate, close: () => socket.close()};
}
let chrome, connected;
try {
  await build({entryPoints: [path.join(repository, 'tests/fixtures/rocket-like.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(temporary, 'rocket-like.mjs'), logLevel: 'silent'});
  const fixture = await import(pathToFileURL(path.join(temporary, 'rocket-like.mjs')));
  const store = fixture.rocketLike();
  // The rocket-like storefront, moved to the fictitious editor's storefront address.
  const moved = text => text.split(fixture.STORE).join(STOREFRONT);
  const publicResources = Object.fromEntries(Object.entries(store.resources).map(([url, resource]) => [moved(url), {...resource, ...(resource.text ? {text: moved(resource.text)} : {})}]));
  const extension = path.join(temporary, 'extension');
  for (const file of extensionFiles) {await mkdir(path.dirname(path.join(extension, file)), {recursive: true}); await cp(path.join(repository, 'dist', file), path.join(extension, file));}
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  // Test-only: stands for the access the toolbar click and the download click grant.
  manifest.host_permissions = ['https://app.yampi.com.br/*', STOREFRONT + '/*', 'https://cdn.yampi.io/*', 'https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*', ...store.origins.filter(origin => origin !== fixture.STORE).map(origin => origin + '/*')];
  manifest.background.service_worker = 'test-worker.js';
  manifest.web_accessible_resources = [{resources: ['test-launcher.html', 'test-launcher.js'], matches: ['https://app.yampi.com.br/*']}];
  // Counts the runner's public reads and keeps every state of the job the worker stores.
  await writeFile(path.join(extension, 'test-worker.js'), `import {openEditorPanel} from './background.js'; globalThis.testReads = 0; globalThis.testStates = []; chrome.storage.session.onChanged.addListener(changes => {for (const [key, change] of Object.entries(changes)) if (key.startsWith('job:') && change.newValue) globalThis.testStates.push({at: Date.now(), status: change.newValue.status, fraction: change.newValue.fraction, active: change.newValue.phases.filter(p => p.status === 'active').map(p => p.id), detail: change.newValue.detail});}); chrome.runtime.onMessage.addListener((message, sender, reply) => {if (message?.action === 'preview-fetch') globalThis.testReads++; if (message?.testToolbarClick && sender.url === chrome.runtime.getURL('test-launcher.html') && sender.tab) {void openEditorPanel(sender.tab).then(() => reply(true), error => reply({error: String(error)})); return true;}});`);
  await writeFile(path.join(extension, 'test-launcher.html'), '<button id="open">Clique do ícone (teste fictício)</button><script src="test-launcher.js"></script>');
  await writeFile(path.join(extension, 'test-launcher.js'), `document.querySelector('button').onclick = async () => {try {document.body.dataset.result = JSON.stringify(await chrome.runtime.sendMessage({testToolbarClick: true}));} catch (error) {document.body.dataset.result = String(error);}}; document.body.dataset.ready = 'true';`);
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  // Chromium as a person runs it: without the flags Playwright adds to keep background tabs awake.
  chrome = spawn(chromium.executablePath(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${path.join(temporary, 'browser')}`, '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
  const endpoint = await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('Chromium não abriu: ' + output)), 30000);
    chrome.stderr.on('data', data => {output += data; const found = output.match(/DevTools listening on (ws:\/\/\S+)/); if (found) {clearTimeout(timer); resolve(found[1]);}});
  });
  connected = await chromium.connectOverCDP(endpoint);
  const browser = connected.contexts()[0];
  browser.setDefaultTimeout(60000);
  const worker = browser.serviceWorkers().find(item => item.url().endsWith('/test-worker.js')) || await browser.waitForEvent('serviceworker', item => item.url().endsWith('/test-worker.js'));
  const extensionId = worker.url().split('/')[2];
  const html = (await readFile(path.join(repository, 'dist/fixture.html'), 'utf8')).replace('<script src="bridge.js"></script>', '').replace('</body>', `<iframe id="test-toolbar" src="chrome-extension://${extensionId}/test-launcher.html"></iframe></body>`);
  const fixtureJs = await readFile(path.join(repository, 'dist/fixture.js'));
  await browser.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (url.origin === 'https://app.yampi.com.br' && /^\/store\/code-editor\/?$/.test(url.pathname)) return route.fulfill({contentType: 'text/html', body: html});
    if (url.origin === 'https://app.yampi.com.br' && url.pathname.endsWith('/fixture.js')) return route.fulfill({contentType: 'text/javascript', body: fixtureJs});
    // No direct reading from the server here: every file is opened in the editor, in the background.
    if (url.origin === SERVER_ORIGIN) return route.fulfill({status: 401, headers: {'access-control-allow-origin': 'https://app.yampi.com.br', 'access-control-allow-credentials': 'true'}, body: '{}'});
    return route.abort();
  });
  // The worker's public reads get the fictitious storefront, with its 404, redirect and 429s.
  await worker.evaluate(({resources, latency}) => {
    const throttled = new Map();
    globalThis.fetch = async (input, options) => {
      const url = String(input), parsed = new URL(url);
      if (options?.method !== 'GET' || options?.credentials !== 'omit' || options?.redirect !== 'manual') throw new Error('Leitura pública sem proteção');
      for (const key of [...parsed.searchParams.keys()]) if (key !== 'q') parsed.searchParams.delete(key);
      const resource = resources[url] ?? resources[parsed.href];
      await new Promise(resolve => setTimeout(resolve, latency));
      if (!resource) throw new TypeError('Failed to fetch: recurso fictício ausente ' + url);
      const seen = throttled.get(url) || 0;
      if (resource.throttle && seen < resource.throttle) {throttled.set(url, seen + 1); return new Response('Calma', {status: 429, headers: {'retry-after': '1'}});}
      if (resource.status && resource.status >= 300 && resource.status < 400) {const response = new Response(null, {status: 200}); Object.defineProperty(response, 'type', {value: 'opaqueredirect'}); return response;}
      const body = resource.base64 ? Uint8Array.from(atob(resource.base64), c => c.charCodeAt(0)) : new TextEncoder().encode(resource.text ?? '');
      const response = new Response(body, {status: resource.status ?? 200, headers: {'content-type': resource.type}});
      Object.defineProperty(response, 'url', {value: url});
      return response;
    };
  }, {resources: publicResources, latency: LATENCY_MS});
  const editor = await browser.newPage();
  await editor.goto('https://app.yampi.com.br/store/code-editor/');
  await editor.waitForFunction(() => document.querySelector('yampi-code-editor')?.shadowRoot?.querySelector('aside .file-name'));
  const driver = await nativePanelDriver(browser, path.join(temporary, 'downloads'), worker);
  await editor.frameLocator('#test-toolbar').locator('body[data-ready="true"]').waitFor();
  await editor.bringToFront();
  await editor.frameLocator('#test-toolbar').locator('#open').click();
  await editor.frameLocator('#test-toolbar').locator('body[data-result="true"]').waitFor();
  const panel = await driver.attach();
  await panel.waitForFunction(() => document.body.dataset.view === 'export');
  // Counts the store checks the worker asks the editor page for.
  await editor.evaluate(() => {
    const original = window.YampiThemeSyncBridge;
    window.testLooks = 0;
    window.YampiThemeSyncBridge = {version: original.version, command: command => {if (command.op === 'context') window.testLooks++; return original.command(command);}};
  });
  const editorTabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url?.endsWith('/store/code-editor/')).id);
  await panel.evaluate(() => {const box = document.querySelector('#include-preview'); if (!box.checked) box.click();});
  const started = Date.now();
  await panel.locator('#export').click();
  for (const deadline = Date.now() + 30000; (await worker.evaluate(async id => (await chrome.storage.session.get('job:' + id))['job:' + id]?.status, editorTabId)) !== 'running';) {
    if (Date.now() > deadline) throw new Error('O download não começou: ' + JSON.stringify(await panel.evaluate(() => ({view: document.body.dataset.view, status: document.querySelector('#status')?.textContent}))));
    await pause(50);
  }
  // From here on, nothing keeps the editor tab awake: Playwright leaves, and another tab comes to the front.
  await connected.close(); connected = undefined;
  const tools = await devtools(endpoint);
  await tools.send('Target.createTarget', {url: 'about:blank', newWindow: false, background: false});
  const page = await tools.attach(target => target.type === 'page' && target.url.endsWith('/store/code-editor/'));
  const service = await tools.attach(target => target.type === 'service_worker' && target.url.endsWith('/test-worker.js'));
  const jobState = () => tools.evaluate(service, `chrome.storage.session.get('job:${editorTabId}').then(value => value['job:${editorTabId}'])`);
  const held = () => tools.evaluate(page, `navigator.locks.query().then(state => state.held.map(lock => lock.name))`);
  // The browser slows a hidden page's timers down to about one run a second.
  const timers = await tools.evaluate(page, `new Promise(done => {const start = performance.now(); let runs = 0; const tick = () => {if (++runs < 4) setTimeout(tick, 10); else done(performance.now() - start);}; tick();})`);
  let hidden = 0, visible = 0, lockSeen = false, finished;
  for (const deadline = Date.now() + 240000; Date.now() < deadline;) {
    finished = await jobState();
    if (finished && !['running', 'waiting'].includes(finished.status)) break;
    assert.notEqual(finished?.status, 'waiting', 'A vitrine fictícia já está liberada: nada deveria aguardar uma decisão.');
    if (await tools.evaluate(page, 'document.visibilityState') === 'hidden') hidden++; else visible++;
    if ((await held()).includes(LOCK)) lockSeen = true;
    await pause(100);
  }
  const ms = Date.now() - started;
  assert.equal(finished?.status, 'completed', finished?.error || JSON.stringify(finished));
  assert.ok(hidden > 0 && visible === 0, `A aba do editor deveria ficar em segundo plano: ${hidden} vezes oculta, ${visible} visível.`);
  assert.ok(timers > 1500, `Os temporizadores da aba oculta deveriam estar desacelerados: ${Math.round(timers)} ms.`);
  assert.ok(lockSeen, 'A página do editor deveria segurar a trava da operação enquanto ela roda.');
  for (let i = 0; i < 50 && (await held()).includes(LOCK); i++) await pause(100);
  assert.ok(!(await held()).includes(LOCK), 'A trava deveria ser solta no fim.');
  assert.equal(finished.fraction, 1);
  assert.ok(finished.phases.every(phase => ['done', 'skipped'].includes(phase.status)), JSON.stringify(finished.phases));
  // Every file of the theme came through the editor, in the hidden tab.
  assert.ok(finished.events.some(event => event.text.startsWith('Leitura direta indisponível')), JSON.stringify(finished.events.map(event => event.text)));
  // The bar: forward only, and short of 99% while pages are left.
  const states = await tools.evaluate(service, 'globalThis.testStates');
  const running = states.filter(state => state.status === 'running');
  assert.ok(running.every((state, i) => i === 0 || state.fraction >= running[i - 1].fraction), 'A barra voltou.');
  const pagesLeft = running.filter(state => state.active.some(id => ['sample', 'preview', 'store', 'products'].includes(id)));
  assert.ok(pagesLeft.length > 0 && pagesLeft.every(state => state.fraction < 0.99), JSON.stringify(pagesLeft.filter(state => state.fraction >= 0.99).slice(0, 3)));
  const productStates = running.filter(state => state.active.includes('products'));
  assert.ok(productStates.length > 0, 'As páginas dos produtos deveriam aparecer nas etapas.');
  // The public reads shared the editor's store checks.
  const reads = await tools.evaluate(service, 'globalThis.testReads'), looks = await tools.evaluate(page, 'window.testLooks');
  assert.ok(reads > 20 && looks < reads, JSON.stringify({reads, looks}));
  // The ZIP: theme, representative pages, store pages and product pages.
  let zip;
  for (const deadline = Date.now() + 30000; !zip && Date.now() < deadline;) {
    const file = await tools.evaluate(service, `chrome.downloads.search({orderBy: ['-startTime'], limit: 10}).then(items => items.find(item => item.state === 'complete' && new Date(item.startTime).getTime() >= ${started - 1000})?.filename)`);
    if (file) zip = unzipSync(new Uint8Array(await readFile(file))); else await pause(150);
  }
  assert.ok(zip, 'O ZIP fictício não chegou.');
  const previewManifest = JSON.parse(new TextDecoder().decode(zip['preview/manifest.json']));
  const stages = previewManifest.pages.reduce((count, item) => ({...count, [item.stage || 'recorte']: (count[item.stage || 'recorte'] || 0) + 1}), {});
  assert.ok(stages.store > 0 && stages.product > 0 && Object.keys(zip).filter(name => name.startsWith('tema/')).length >= 10, JSON.stringify(stages));
  tools.close();
  const percent = state => Math.round(state.fraction * 100);
  const report = {
    scope: `Editor fictício e vitrine fictícia (rocket-like), ${LATENCY_MS} ms por leitura pública, aba do editor oculta; não mede uma loja real.`,
    seconds: +(ms / 1000).toFixed(1), hiddenTimersMs: Math.round(timers), webLockHeld: true,
    publicReads: reads, editorStoreChecks: looks, storeChecksBefore: reads * 2,
    pages: stages, barWhileProducts: productStates.map(percent).filter((value, i, all) => i === 0 || value !== all[i - 1])
  };
  await mkdir(path.join(repository, '.cache'), {recursive: true});
  await writeFile(path.join(repository, '.cache/background-e2e.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await connected?.close().catch(() => {});
  chrome?.kill();
  if (chrome) await new Promise(resolve => {if (chrome.exitCode !== null || chrome.signalCode) resolve(); else chrome.once('exit', resolve);});
  if (!path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep + 'yampi-segundo-plano-')) throw new Error('Destino de limpeza inválido.');
  await rm(temporary, {recursive: true, force: true}).catch(() => {});
}
