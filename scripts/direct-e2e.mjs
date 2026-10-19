// Times the same export of a larger fictitious theme twice, with the built extension in Chromium:
// through the fictitious editor only, file by file (as up to 0.6), and with the direct reading,
// checked against the editor. Every request is answered here; nothing reaches Yampi.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp, mkdir, writeFile, readFile, cp, rm} from 'node:fs/promises';
import {unzipSync} from 'fflate';
import {nativePanelDriver} from './side-panel-test.mjs';
import {extensionFiles} from './distribution.mjs';
import {fictitiousServer, SERVER_ORIGIN} from './fictitious-server.mjs';
const repository = path.resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'yampi-leitura-direta-'));
const count = Number(process.env.DIRECT_FILES || 120);
if (!Number.isInteger(count) || count < 20 || count > 1000) throw new Error('DIRECT_FILES deve ficar entre 20 e 1000.');
// Generated here, entirely fictitious: sections, components, styles and blocks.
const theme = {};
for (let i = 0; i < count; i++) {
  const n = String(i).padStart(4, '0');
  if (i % 4 === 0) theme[`sections/home/secao-${n}.twig`] = `<section class="secao-${n}">\n  {{ texto_ficticio_${n} }}\n</section>\n`;
  else if (i % 4 === 1) theme[`components/Ficticio${n}.vue`] = `<template>\n  <div>Componente fictício ${n}</div>\n</template>\n`;
  else if (i % 4 === 2) theme[`assets/styles/sections/s-${n}.scss`] = `.s-${n} {\n  color: #${n}aa;\n}\n`;
  else theme[`elements/blocos/bloco-${n}.twig`] = `{# bloco fictício ${n} #}\n<div>${'texto fictício '.repeat(30)}</div>\n`;
}
let browser;
try {
  const extension = path.join(temporary, 'extension');
  for (const file of extensionFiles) {await mkdir(path.dirname(path.join(extension, file)), {recursive: true}); await cp(path.join(repository, 'dist', file), path.join(extension, file));}
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  // Test-only: stands for the access a real toolbar click grants. Every request is answered below.
  manifest.host_permissions = ['https://app.yampi.com.br/*'];
  manifest.background.service_worker = 'test-worker.js';
  manifest.web_accessible_resources = [{resources: ['test-launcher.html', 'test-launcher.js'], matches: ['https://app.yampi.com.br/*']}];
  await writeFile(path.join(extension, 'test-worker.js'), `import {openEditorPanel} from './background.js'; globalThis.testRequests = []; chrome.runtime.onMessage.addListener((message, sender, reply) => {if (message?.command) globalThis.testRequests.push(message.command.op); if (message?.testToolbarClick && sender.url === chrome.runtime.getURL('test-launcher.html') && sender.tab) {void openEditorPanel(sender.tab).then(() => reply(true), error => reply({error: String(error)})); return true;}});`);
  await writeFile(path.join(extension, 'test-launcher.html'), '<button id="open">Clique do ícone (teste fictício)</button><script src="test-launcher.js"></script>');
  await writeFile(path.join(extension, 'test-launcher.js'), `document.querySelector('button').onclick = async () => {try {document.body.dataset.result = JSON.stringify(await chrome.runtime.sendMessage({testToolbarClick: true}));} catch (error) {document.body.dataset.result = String(error);}}; document.body.dataset.ready = 'true';`);
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  browser = await chromium.launchPersistentContext(path.join(temporary, 'browser'), {channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  browser.setDefaultTimeout(60000);
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const extensionId = worker.url().split('/')[2];
  const html = (await readFile(path.join(repository, 'dist/fixture.html'), 'utf8')).replace('<script src="bridge.js"></script>', '').replace('</body>', `<iframe id="test-toolbar" src="chrome-extension://${extensionId}/test-launcher.html"></iframe></body>`);
  const fixtureJs = await readFile(path.join(repository, 'dist/fixture.js'));
  // A server a little slower than a local one. Switched off, it refuses the session at once.
  const server = fictitiousServer({latency: 120});
  let serverOn = false;
  await browser.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (url.origin === 'https://app.yampi.com.br' && /^\/store\/code-editor\/?$/.test(url.pathname)) return route.fulfill({contentType: 'text/html', body: html});
    if (url.origin === 'https://app.yampi.com.br' && url.pathname.endsWith('/fixture.js')) return route.fulfill({contentType: 'text/javascript', body: fixtureJs});
    if (url.origin === SERVER_ORIGIN) return serverOn ? server.handle(route) : route.fulfill({status: 401, headers: {'access-control-allow-origin': 'https://app.yampi.com.br', 'access-control-allow-credentials': 'true'}, body: '{}'});
    return route.abort();
  });
  const editor = await browser.newPage();
  await editor.goto('https://app.yampi.com.br/store/code-editor/');
  await editor.waitForFunction(() => document.querySelector('yampi-code-editor')?.shadowRoot?.querySelector('aside .file-name'));
  await editor.evaluate(files => {sessionStorage.setItem('fixture-files', JSON.stringify(files));}, theme);
  await editor.reload();
  // The fictitious theme plus the fixture's example image.
  await editor.waitForFunction(total => document.querySelector('yampi-code-editor')?.shadowRoot?.querySelectorAll('aside .file-name').length === total, count + 1);
  const driver = await nativePanelDriver(browser, path.join(temporary, 'downloads'), worker);
  await editor.frameLocator('#test-toolbar').locator('body[data-ready="true"]').waitFor();
  await editor.bringToFront();
  await editor.frameLocator('#test-toolbar').locator('#open').click();
  await editor.frameLocator('#test-toolbar').locator('body[data-result="true"]').waitFor();
  const panel = await driver.attach();
  await panel.waitForFunction(() => document.body.dataset.view === 'export').catch(async error => {
    throw new Error(`${error.message} ${JSON.stringify(await panel.evaluate(() => ({view: document.body.dataset.view, status: document.querySelector('#status')?.textContent, detail: document.querySelector('#detail')?.textContent})))}`);
  });
  async function exportOnce(direct) {
    serverOn = direct;
    await panel.evaluate(() => {const box = document.querySelector('#include-preview'); if (box.checked) box.click();});
    await worker.evaluate(() => {globalThis.testRequests = [];});
    const files = server.counts.file, started = Date.now();
    await panel.locator('#export').click();
    await panel.waitForFunction(() => document.body.dataset.view === 'result', {timeout: 900000});
    const ms = Date.now() - started;
    assert.equal(await panel.locator('#status').textContent(), 'ZIP baixado');
    const events = await panel.evaluate(() => [...document.querySelectorAll('#event-list li')].map(li => li.textContent));
    let zip;
    for (const deadline = Date.now() + 30000; !zip && Date.now() < deadline;) {
      // The test driver saves downloads under internal names, without the .zip extension.
      const item = await worker.evaluate(async since => (await chrome.downloads.search({orderBy: ['-startTime'], limit: 10})).find(entry => entry.state === 'complete' && new Date(entry.startTime).getTime() >= since), started - 1000);
      if (item) zip = unzipSync(new Uint8Array(await readFile(item.filename))); else await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.ok(zip, 'O ZIP fictício não chegou.');
    const ops = await worker.evaluate(() => globalThis.testRequests);
    await panel.evaluate(() => {const finish = document.querySelector('#finish'); if (finish && finish.getClientRects().length) finish.click(); else document.querySelector('#mode-export').click();});
    await panel.waitForFunction(() => document.body.dataset.view === 'export');
    return {ms, events, zip, editorReads: ops.filter(op => op === 'read' || op === 'readAsset').length, serverFiles: server.counts.file - files};
  }
  const slow = await exportOnce(false), fast = await exportOnce(true);
  // Both copies are the same, byte for byte, and hold exactly the fictitious theme.
  const texts = zip => Object.fromEntries(Object.entries(zip).filter(([name]) => name.startsWith('tema/')).map(([name, bytes]) => [name, Buffer.from(bytes).toString('base64')]));
  assert.deepEqual(texts(fast.zip), texts(slow.zip));
  for (const [file, content] of Object.entries(theme)) assert.equal(new TextDecoder().decode(fast.zip[`tema/${file}`]), content, file);
  assert.equal(slow.serverFiles, 0); assert.equal(slow.editorReads, count + 1);
  assert.ok(fast.editorReads <= 5 && fast.serverFiles === count + 1, JSON.stringify({editorReads: fast.editorReads, serverFiles: fast.serverFiles}));
  assert.ok(fast.events.some(text => text.includes('Leitura direta conferida')), fast.events.join(' | '));
  assert.ok(slow.events.some(text => text.includes('Leitura direta indisponível')), slow.events.join(' | '));
  const report = {scope: 'Somente o editor fictício (450 ms para abrir cada arquivo) e um servidor fictício com 120 ms por pedido; não mede uma loja real.', files: count + 1, editorOnly: {seconds: +(slow.ms / 1000).toFixed(1), editorReads: slow.editorReads}, direct: {seconds: +(fast.ms / 1000).toFixed(1), editorReads: fast.editorReads, serverFiles: fast.serverFiles, peakParallel: server.peak()}, speedup: +(slow.ms / fast.ms).toFixed(1), identicalZipThemes: true};
  await mkdir(path.join(repository, '.cache'), {recursive: true});
  await writeFile(path.join(repository, '.cache/direct-benchmark.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await rm(temporary, {recursive: true, force: true}).catch(() => {});
}
