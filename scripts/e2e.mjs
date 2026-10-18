import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp, mkdir, writeFile, readFile, readdir, cp, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {unzipSync, zipSync, strToU8} from 'fflate';
import {createLocalServer} from '../local-runtime/dev.mjs';
import {nativePanelDriver} from './side-panel-test.mjs';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {extensionFiles} from './distribution.mjs';
const repository = path.resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'yampi-e2e-ficticio-'));
let browser, localServer, panel,localOrigin;
// Screenshots show the resting screen: entry fades finish first; endless pulses are left running.
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
async function command(cmd, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {cwd, stdio: 'pipe'}); let log = '';
    child.stdout.on('data', b => {log += b;}); child.stderr.on('data', b => {log += b;});
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd}: ${log}`)));
  });
}
try {
  const extension = path.join(temporary, 'extension'), project = path.join(temporary, 'project');
  await mkdir(extension); await mkdir(project);
  for (const file of extensionFiles) {await mkdir(path.dirname(path.join(extension,file)),{recursive:true});await cp(path.join(repository, 'dist', file), path.join(extension, file));}
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  // Test-only permission. Every HTTP request to this origin is fulfilled below by the fixture; nothing reaches Yampi.
  manifest.host_permissions = ['https://app.yampi.com.br/*','https://loja-exemplo.invalid/*','https://dark-cdn.invalid/*'];
  manifest.background.service_worker = 'test-worker.js';
  manifest.web_accessible_resources = [{resources: ['test-launcher.html', 'test-launcher.js'], matches: ['https://app.yampi.com.br/*']}];
  await writeFile(path.join(extension, 'test-worker.js'), `import {openEditorPanel} from './background.js'; const panels = new Set(); globalThis.testDisconnectPanels = () => {for (const port of panels) port.disconnect(); panels.clear();}; chrome.runtime.onConnect.addListener(port => {panels.add(port); port.onDisconnect.addListener(() => panels.delete(port));}); globalThis.testHeartbeats = 0; globalThis.testRequests = []; globalThis.testClicks=[]; chrome.runtime.onMessage.addListener((message, sender, reply) => {if (message?.action === 'heartbeat') globalThis.testHeartbeats++; if (message?.command || message?.action === 'lock') globalThis.testRequests.push(message.command?.op || 'lock:' + message.access); if(message?.testToolbarClick)globalThis.testClicks.push({url:sender.url,tab:sender.tab}); if (message?.testToolbarClick && sender.url === chrome.runtime.getURL('test-launcher.html') && sender.tab) {void openEditorPanel(sender.tab).then(() => reply(true),error=>reply({error:String(error)})); return true;}});`);
  await writeFile(path.join(extension, 'test-launcher.html'), '<button id="open">Clique do ícone (teste fictício)</button><script src="test-launcher.js"></script>');
  await writeFile(path.join(extension, 'test-launcher.js'), `document.querySelector('button').onclick = async () => {document.body.dataset.clicked='true'; try{const result=await chrome.runtime.sendMessage({testToolbarClick:true}); document.body.dataset.result=JSON.stringify(result);}catch(error){document.body.dataset.result=String(error);}}; document.body.dataset.ready='true';`);
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  browser = await chromium.launchPersistentContext(path.join(temporary, 'browser'), {channel: 'chromium', headless: true, acceptDownloads: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  browser.setDefaultTimeout(30000);
  console.log('E2E: Chromium e extensão iniciados.');
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  assert.equal((await worker.evaluate(() => chrome.sidePanel.getOptions({}))).enabled, false);
  const extensionId = worker.url().split('/')[2];
  const html = (await readFile(path.join(repository, 'dist/fixture.html'), 'utf8')).replace('<script src="bridge.js"></script>', '').replace('</body>', `<iframe id="test-toolbar" src="chrome-extension://${extensionId}/test-launcher.html"></iframe></body>`);
  const fixtureJs = await readFile(path.join(repository, 'dist/fixture.js'));
  await browser.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (url.origin === 'https://app.yampi.com.br' && url.pathname === '/') return route.fulfill({contentType:'text/html',body:`<h1>Painel fictício fora do editor</h1><iframe id="test-toolbar" src="chrome-extension://${extensionId}/test-launcher.html"></iframe>`});
    if (url.origin === 'https://app.yampi.com.br' && /^\/store\/code-editor\/?$/.test(url.pathname)) return route.fulfill({contentType: 'text/html', body: html});
    if (url.origin === 'https://app.yampi.com.br' && ['/store/code-editor/fixture.js', '/store/fixture.js'].includes(url.pathname)) return route.fulfill({contentType: 'text/javascript', body: fixtureJs});
    if (url.origin === localOrigin) return route.continue();
    return route.abort();
  });
  const editor = await browser.newPage(); await editor.goto('https://app.yampi.com.br/');
  const downloads = path.join(temporary, 'downloads'); await mkdir(downloads);
  await mkdir(path.join(repository, '.cache'), {recursive: true});
  const driver = await nativePanelDriver(browser, downloads, worker);
  const pagesBefore = browser.pages().length;
  await editor.frameLocator('#test-toolbar').locator('body[data-ready="true"]').waitFor();
  await editor.frameLocator('#test-toolbar').locator('#open').click();
  const guide = await driver.attach(undefined,'guide');
  await guide.waitForFunction(()=>document.body.dataset.guideReady==='true');
  assert.equal(await guide.locator('#guide-title').textContent(),'Abra o editor de código da Yampi.');
  assert.deepEqual(await worker.evaluate(()=>chrome.storage.session.get(null)),{});
  assert.deepEqual(await worker.evaluate(()=>globalThis.testRequests),[]);
  assert.deepEqual(await readdir(downloads),[]);
  await settled(guide); await guide.screenshot({path:path.join(repository,'.cache/panel-guide-e2e.png')});
  await guide.locator('#open-editor').click();
  await editor.waitForURL('https://app.yampi.com.br/store/code-editor/');
  assert.equal(browser.pages().length,pagesBefore);
  assert.deepEqual(await worker.evaluate(()=>globalThis.testRequests),[]);
  console.log('E2E: orientação nativa fora do editor; botão abre o editor na mesma aba, sem sessão, injeção ou cópia automática.');
  await editor.locator('#test-info').waitFor();
  await editor.waitForFunction(() => document.querySelector('yampi-code-editor')?.shadowRoot?.querySelector('aside .file-name'));
  // Surrounding-app text and controls must never be mistaken for the editor, including enabled saves.
  await editor.evaluate(() => {
    const decoy = document.createElement('div'); decoy.id = 'surrounding-app';
    decoy.innerHTML = '<header>Editor de código <span>Outra identificação</span><a target="_blank" href="https://outra-loja.invalid/">Ver prévia</a></header><aside><span class="file-name">decoy.twig</span></aside><main><button>Salvar arquivo</button></main>';
    document.body.append(decoy);
    const root = document.querySelector('yampi-code-editor').shadowRoot;
    root.querySelector('#editor-title').textContent = 'Arquivos do tema';
    root.querySelector('header a span').textContent = 'Abrir prévia';
  });
  await editor.frameLocator('#test-toolbar').locator('body[data-ready="true"]').waitFor();
  // The native guide is closing and changes the browser's page bounds. Keyboard
  // activation keeps the real user gesture without stale pointer coordinates.
  await editor.bringToFront();
  await editor.frameLocator('#test-toolbar').locator('#open').press('Enter');
  await editor.frameLocator('#test-toolbar').locator('body[data-result="true"]').waitFor();
  panel = await driver.attach();
  console.log('E2E: painel lateral nativo iniciado pelo handler do ícone.');
  await panel.waitForFunction(() => document.body.dataset.view === 'export');
  assert.equal(await panel.locator('#connection-state').textContent(), 'Editor conectado');
  assert.equal(await panel.evaluate(() => document.querySelector('#mode-export').getAttribute('aria-selected')), 'true');
  assert.equal(await panel.evaluate(() => !!document.querySelector('#export-section #dock') && getComputedStyle(document.querySelector('#dock')).position === 'static'), true);
  assert.deepEqual(await editor.evaluate(() => {const root = document.querySelector('yampi-code-editor').shadowRoot; return [root.querySelectorAll('.selected').length, root.querySelectorAll('.cm-content').length];}), [0, 0]);
  assert.deepEqual(await readdir(downloads), []);
  assert.ok((await worker.evaluate(() => globalThis.testRequests)).every(op => ['context', 'lock:read'].includes(op)));
  await editor.frameLocator('#test-toolbar').locator('#open').click();
  await panel.waitForFunction(() => document.body.dataset.view === 'export');
  assert.deepEqual(await readdir(downloads), []);
  await settled(panel); await panel.screenshot({path: path.join(repository, '.cache/panel-confirm-e2e.png')});
  await panel.locator('#include-preview').click();
  const exported = driver.waitExtensionDownload(); await panel.locator('#export').click();
  await panel.waitForFunction(() => document.body.dataset.view === 'result');
  assert.equal(await panel.locator('#status').textContent(), 'ZIP baixado', await panel.locator('#detail').textContent());
  assert.equal(await panel.evaluate(() => !document.querySelector('#done-counts').hidden && !document.querySelector('#preview-more').hidden), true);
  const download = await exported, exportPath = path.join(temporary, 'export.zip'); await download.saveAs(exportPath);
  assert.equal(browser.pages().length, pagesBefore, 'O clique não pode abrir outra aba.');
  assert.equal(await panel.evaluate(() => document.querySelector('#review').hidden && document.querySelector('#confirm-panel').hidden), true);
  const nativeContexts = await worker.evaluate(() => chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']}));
  assert.ok(nativeContexts.some(c => c.documentUrl.includes('panel.html?tab=')));
  await mkdir(path.join(repository, '.cache'), {recursive: true});
  await settled(panel); await panel.screenshot({path: path.join(repository, '.cache/panel-export-e2e.png')});
  console.log('E2E: exportação com PNG e texto integral conferida.');
  const entries = unzipSync(new Uint8Array(await readFile(exportPath)));
  assert.equal(Object.keys(entries).filter(p => p.startsWith('tema/')).length, 10);
  assert.ok(new TextDecoder().decode(entries['tema/templates/long.twig']).includes('Linha 2000'));
  assert.ok(entries['tema/assets/images/example.png'].length > 0);
  assert.equal(await editor.evaluate(() => window.fictitiousUnchanged()), true);
  assert.deepEqual(await editor.evaluate(() => window.fictitiousOperations), {dispatch: 0, save: 0, forbidden: 0, add: 0});
  assert.ok((await worker.evaluate(() => globalThis.testRequests)).every(op => ['context', 'inventory', 'read', 'readAsset', 'lock:read'].includes(op)));
  assert.ok(await editor.evaluate(() => !!document.querySelector('yampi-code-editor').shadowRoot.querySelector('.cm-content').cmView), 'O fluxo principal deve usar a associação antiga do CodeMirror.');
  console.log('E2E: confirmação exigida; cópia sem edições, saves ou controles destrutivos no CodeMirror 6.36.2.');
  console.log('E2E: Shadow DOM, títulos alterados e controles externos ignorados.');
  const guards = await editor.evaluate(async () => {
    const bridge = window.YampiThemeSyncBridge, host = document.querySelector('yampi-code-editor'), root = host.shadowRoot;
    const initial = await bridge.command({op: 'context'}); if (!initial.ok) throw new Error(initial.error);
    const duplicate = document.createElement('yampi-code-editor'); document.body.append(duplicate);
    const multiple = await bridge.command({op: 'context'}); duplicate.remove();
    const inactive = document.createElement('div'); inactive.className = 'tab-item'; inactive.innerHTML = '<div class="change-icon"></div>'; root.querySelector('main').append(inactive);
    const dirty = await bridge.command({op: 'context'}); inactive.remove();
    const switched = bridge.command({op: 'read', path: 'templates/long.twig', context: initial.value});
    await new Promise(r => setTimeout(r, 100)); root.querySelector('#shop-name').textContent = 'Outra loja fictícia';
    const changedStore = await switched; root.querySelector('#shop-name').textContent = 'Loja de testes';
    const replacing = bridge.command({op: 'read', path: 'templates/long.twig', context: initial.value});
    await new Promise(r => setTimeout(r, 100));
    const replacement = document.createElement('yampi-code-editor'), replacementRoot = replacement.attachShadow({mode: 'open'});
    replacementRoot.innerHTML = root.querySelector('header').outerHTML + '<aside><div class="collapse-list"><div class="folder-title">assets</div></div></aside><main></main>';
    host.replaceWith(replacement); const changedComponent = await replacing; replacement.replaceWith(host);
    const closed = document.createElement('yampi-code-editor'); closed.attachShadow({mode: 'closed'}); host.replaceWith(closed);
    const inaccessible = await bridge.command({op: 'context'}); closed.replaceWith(host);
    return {multiple, dirty, changedStore, changedComponent, inaccessible};
  });
  for (const result of Object.values(guards)) assert.equal(result.ok, false);
  assert.match(guards.dirty.error, /não salvas/); assert.match(guards.changedStore.error, /loja|origem/i);
  assert.match(guards.changedComponent.error, /componente do editor mudou/); assert.match(guards.inaccessible.error, /estrutura de arquivos/);
  console.log('E2E: loja/componente trocados, múltiplos editores, rascunho inativo e Shadow DOM fechado bloqueados.');
  for (const [name, bytes] of Object.entries(entries)) {await mkdir(path.dirname(path.join(project, name)), {recursive: true}); await writeFile(path.join(project, name), bytes);}
  const npmCli = process.platform === 'win32' ? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') : process.env.npm_execpath;
  assert.ok(npmCli, 'Execute via npm run test:e2e.');
  await command(process.execPath, [npmCli, 'ci'], project);
  await command(process.execPath, [path.join(project, '.yampi-sync/tools/dev.mjs'), '--check'], project);
  console.log('E2E: projeto exportado instalado e compilado.');
  const local = await createLocalServer(project); localServer = local.server;
  await new Promise((resolve, reject) => {localServer.once('error', reject); localServer.listen(0, '127.0.0.1', resolve);});localOrigin='http://127.0.0.1:'+localServer.address().port;
  const preview = await browser.newPage(); await preview.goto(localOrigin+'/preview?page=home');
  await preview.waitForFunction(() => document.querySelector('button')?.textContent?.includes('Clique para testar'));
  await preview.locator('button').click(); assert.match(await preview.locator('button').textContent(), /1/);
  assert.equal(await preview.locator('button').evaluate(button => getComputedStyle(button).borderTopColor), 'rgb(32, 99, 79)');
  assert.equal(await preview.getByRole('img', {name: 'Imagem fictícia'}).evaluate(img => img.complete && img.naturalWidth > 0), true);
  assert.equal(await preview.locator('a[href="#exemplo-local"]').textContent(), 'Link fictício · slot funciona');
  await preview.locator('.image-state').filter({hasText:'Imagem carregada'}).waitFor();
  await preview.locator('.splide__slide').click();
  assert.equal(await preview.locator('.gallery-state').textContent(), 'Galeria clicada');
  assert.equal(await preview.evaluate(() => window.__yampiLocalReady), true);
  assert.deepEqual(await preview.evaluate(() => window.__yampiLocalMessages || []), []);
  console.log('E2E: Vue interativo e PNG local conferidos.');
  await writeFile(path.join(project, 'tema/elements/head.twig'), '<meta name="description" content="Editado localmente">\n');
  // A new text in an existing folder and a new image in a subfolder reach the store with no manual step.
  const newText = '<p>Arquivo novo criado pela extensão</p>\n<img src="{{ \'images/novas/nova.png\' | assets_url }}" alt="">\n';
  const novaPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await writeFile(path.join(project, 'tema/templates/new.twig'), newText);
  await mkdir(path.join(project, 'tema/assets/images/novas'), {recursive: true});
  await writeFile(path.join(project, 'tema/assets/images/novas/nova.png'), novaPng);
  await command(process.execPath, [path.join(project, '.yampi-sync/tools/pack.mjs')], project);
  const folderImport = path.join(temporary, 'folder-import');
  await mkdir(folderImport);
  for (const relative of ['tema', '.yampi-sync']) await cp(path.join(project, relative), path.join(folderImport, relative), {recursive: true});
  await mkdir(path.join(folderImport, 'node_modules'), {recursive: true});
  await writeFile(path.join(folderImport, 'node_modules/ignored.txt'), 'Dependência fictícia não enviada');
  await editor.bringToFront(); await panel.locator('#finish').click(); await panel.waitForFunction(() => document.body.dataset.view === 'export');
  await panel.locator('#mode-import').click(); await panel.waitForFunction(() => document.body.dataset.view === 'pick');
  await panel.waitForFunction(() => !document.querySelector('#folder').disabled);
  await panel.locator('#folder').setInputFiles(folderImport, {timeout: 15000});
  console.log('E2E: pasta selecionada.');
  await panel.waitForFunction(() => document.body.dataset.view === 'review');
  assert.match(await panel.locator('#local-info').textContent(), /10 textos e 2 imagens/);
  await panel.locator('#baseline').setInputFiles(path.join(project, 'retorno-yampi.zip'));
  await panel.waitForFunction(() => !document.querySelector('#baseline').disabled);
  await panel.waitForFunction(() => document.body.dataset.view === 'review');
  // One summary in plain words: what changes, what is created and where the image goes. Nothing needs the user's attention.
  assert.match(await panel.locator('#summary').textContent(), /3 itens para enviar: 1 arquivo alterado, 1 arquivo novo e 1 imagem nova\. Nenhum conflito\./);
  assert.equal(await panel.locator('#status').textContent(), '3 alterações prontas');
  assert.match(await panel.locator('#moves-list').textContent(), /images\/novas\/nova\.png → images\/nova\.png/);
  assert.equal(await panel.evaluate(() => document.querySelector('#attention').hidden), true);
  assert.equal(await panel.locator('#apply').textContent(), 'Enviar 3 itens para Loja de testes');
  await settled(panel); await panel.screenshot({path: path.join(repository, '.cache/panel-import-e2e.png')});
  // Two clicks: send, then confirm. The backup download comes before any change.
  await panel.locator('#apply').click();
  assert.equal(await panel.evaluate(() => document.querySelector('#confirm-panel').hidden), false);
  assert.equal(await panel.locator('#target-store').textContent(), 'Loja de testes');
  const backup = driver.waitExtensionDownload(); await panel.locator('#confirm-send').click(); await (await backup).saveAs(path.join(temporary, 'backup.zip'));
  // The send runs in the extension's background document: closing the panel must not stop it.
  const editorTabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url?.endsWith('/store/code-editor/')).id);
  const jobState = () => worker.evaluate(async id => (await chrome.storage.session.get('job:' + id))['job:' + id], editorTabId);
  const openPanels = () => worker.evaluate(async () => (await chrome.runtime.getContexts({contextTypes: ['SIDE_PANEL']})).length);
  assert.equal((await jobState())?.status, 'running', 'O envio deveria estar em andamento depois do backup.');
  await settled(panel); await panel.screenshot({path: path.join(repository, '.cache/panel-progress-e2e.png')});
  await worker.evaluate(id => chrome.sidePanel.setOptions({tabId: id, enabled: false}), editorTabId);
  for (let i = 0; i < 100 && await openPanels(); i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(await openPanels(), 0, 'O painel deveria estar fechado durante o envio.');
  let finished;
  for (let i = 0; i < 1200; i++) {finished = await jobState(); if (finished && !['running', 'waiting'].includes(finished.status)) break; await new Promise(r => setTimeout(r, 100));}
  assert.equal(finished?.status, 'completed', finished?.error);
  assert.ok(finished.phases.every(phase => ['done', 'skipped'].includes(phase.status)));
  assert.equal(await worker.evaluate(id => chrome.action.getBadgeText({tabId: id}), editorTabId), '✓');
  assert.equal(await worker.evaluate(async () => Object.values(await chrome.storage.session.get(null)).find(value => value.editorUrl)?.locked), false);
  console.log('E2E: painel fechado no meio do envio; a execução em segundo plano terminou, liberou o editor e marcou o ícone.');
  // Reopening the panel shows the result and starts nothing.
  await editor.bringToFront();
  await editor.frameLocator('#test-toolbar').locator('body').evaluate(body => {delete body.dataset.result;});
  await editor.frameLocator('#test-toolbar').locator('#open').press('Enter');
  await editor.frameLocator('#test-toolbar').locator('body[data-result="true"]').waitFor();
  panel = await driver.attach(editorTabId);
  await panel.waitForFunction(() => document.body.dataset.view === 'result');
  assert.equal(await panel.locator('#status').textContent(), 'Envio concluído');
  console.log('E2E: arquivo novo e imagem criados pelos controles do editor; envio, backup e reload conferidos item a item.');
  assert.equal(await panel.evaluate(() => document.querySelector('#done').hidden), false);
  assert.match(await panel.locator('#done-summary').textContent(), /2 arquivos salvos, 1 deles criado pela extensão e 1 imagem enviada/);
  await settled(panel); await panel.screenshot({path: path.join(repository, '.cache/panel-done-e2e.png')});
  assert.match(await editor.locator('#test-info').textContent(), /Publicações: 0/);
  const sent = await editor.evaluate(() => JSON.parse(sessionStorage.getItem('fixture-files')));
  assert.equal(sent['elements/head.twig'], '<meta name="description" content="Editado localmente">\n');
  assert.equal(sent['templates/new.twig'], newText.replace('images/novas/nova.png', 'images/nova.png'));
  const uploaded = await editor.evaluate(() => JSON.parse(sessionStorage.getItem('fixture-assets')));
  assert.deepEqual(Object.keys(uploaded), ['assets/images/nova.png']);
  assert.equal(uploaded['assets/images/nova.png'], 'data:image/png;base64,' + novaPng.toString('base64'));
  await panel.reload(); await panel.waitForFunction(() => document.body.dataset.view === 'result');
  // Session storage also keeps each tab's job state under "job:<tab>"; sessions are the other keys.
  const sessions = () => worker.evaluate(async () => Object.entries(await chrome.storage.session.get(null)).filter(([key]) => !key.includes(':')).map(([, value]) => value));
  assert.equal((await sessions())[0].access, undefined);
  assert.match(await panel.locator('#journal-info').textContent(), /3 de 3 itens conferidos/);
  await panel.locator('#menu').click(); await panel.waitForFunction(() => document.querySelector('#recovery').open);
  await panel.locator('#restore').click(); await panel.waitForFunction(() => document.body.dataset.view === 'review' && document.querySelector('#status').textContent.startsWith('Restaurar'));
  // Undo: the changed file goes back and the created one returns to Yampi's empty content; nothing is deleted.
  assert.match(await panel.locator('#summary').textContent(), /2 itens para enviar/);
  // A remote edit after the send must be protected during restore.
  await editor.locator('#remote-file').selectOption('elements/head.twig'); await editor.locator('#external-change').click();
  await panel.locator('#menu').click(); await panel.locator('#restore').click(); await panel.waitForFunction(() => document.body.dataset.view === 'review' && document.querySelector('#summary').textContent.includes('conflito'));
  assert.match(await panel.locator('#summary').textContent(), /1 conflito precisa da sua decisão/);
  console.log('E2E: conflito na restauração protegido.');
  // Nested header is accepted; ambiguous identity is rejected without masking the error.
  await editor.evaluate(() => {const label = document.createElement('span'); label.id = 'ambiguous'; label.textContent = 'Outra identificação'; document.querySelector('yampi-code-editor').shadowRoot.querySelector('#shop-name').after(label);});
  await panel.reload(); await panel.waitForFunction(() => document.body.dataset.view === 'offline');
  assert.match(await panel.locator('#detail').textContent(), /Nome da loja não reconhecido/);
  assert.equal(await panel.evaluate(() => document.querySelector('#retry').hidden), false);
  await worker.evaluate(() => globalThis.testDisconnectPanels());
  await panel.waitForFunction(() => !document.querySelector('#retry').hidden);
  assert.equal(await panel.locator('#connection-state').textContent(), 'Editor desconectado');
  assert.equal(await panel.locator('#status').textContent(), 'Não foi possível conectar');
  assert.match(await panel.locator('#detail').textContent(), /Nome da loja não reconhecido/);
  await editor.locator('#ambiguous').evaluate(el => el.remove());
  await panel.locator('#retry').click(); await panel.waitForFunction(() => document.body.dataset.connection === 'connected');
  assert.equal(await panel.locator('#connection-state').textContent(), 'Editor conectado');
  await worker.evaluate(() => globalThis.testDisconnectPanels());
  await panel.waitForFunction(() => document.querySelector('#status').textContent === 'Conexão encerrada');
  await panel.locator('#retry').click(); await panel.waitForFunction(() => document.body.dataset.connection === 'connected');
  assert.equal((await sessions())[0].locked, false);
  assert.ok(await worker.evaluate(() => globalThis.testHeartbeats > 0), 'O painel deve enviar heartbeat real ao worker.');
  console.log('E2E: desconexão preserva diagnóstico; retry recria port e heartbeat chega ao worker.');
  // Importing a folder never consumes node_modules/config/tools as store files.
  const corrupted = {...entries, '.yampi-sync/baseline/templates/home.twig': strToU8('alterado')};
  await writeFile(path.join(temporary, 'corrupted.zip'), zipSync(corrupted));
  await panel.locator('#baseline').setInputFiles(path.join(temporary, 'corrupted.zip'));
  await panel.waitForFunction(() => !document.querySelector('#notice').hidden);
  assert.match(await panel.locator('#notice').textContent(), /Baseline/);
  await mkdir(path.join(repository, '.cache'), {recursive: true});
  await settled(panel); await panel.screenshot({path: path.join(repository, '.cache/panel-e2e.png'), fullPage: true});
  await preview.screenshot({path: path.join(repository, '.cache/local-preview-e2e.png'), fullPage: true});
  // Also exercise the newer CodeMirror version against the same production bridge with fictitious data.
  const currentEditor = await browser.newPage(); await currentEditor.goto('https://app.yampi.com.br/store/code-editor/?codemirror=current');
  await currentEditor.waitForFunction(() => document.querySelector('yampi-code-editor')?.shadowRoot?.querySelector('aside .file-name'));
  await currentEditor.addScriptTag({content: await readFile(path.join(repository, 'dist/bridge.js'), 'utf8')});
  const currentRead = await currentEditor.evaluate(async () => {
    const bridge = window.YampiThemeSyncBridge; await bridge.command({op: 'inventory'});
    const value = await bridge.command({op: 'read', path: 'templates/long.twig'});
    return {value, current: !!document.querySelector('yampi-code-editor').shadowRoot.querySelector('.cm-content').cmTile, unchanged: window.fictitiousUnchanged(), operations: window.fictitiousOperations};
  });
  assert.equal(currentRead.value.ok, true); assert.equal(currentRead.current, true); assert.equal(currentRead.unchanged, true);
  assert.equal(currentRead.value.value, new TextDecoder().decode(entries['tema/templates/long.twig']));
  assert.deepEqual(currentRead.operations, {dispatch: 0, save: 0, forbidden: 0, add: 0});
  console.log('E2E aprovado: confirmação antes da cópia, CodeMirror antigo e atual, zero mutações na exportação, Shadow DOM, isolamento de loja/componente, erro de conexão e retry, PNG, projeto portátil com npm ci, Twig/Sass/Vue 2, importação de pasta/ZIP, envio com backup/reload e restauração. Nenhuma requisição alcançou a Yampi.');
  // Exercise the actual panel -> authenticated worker -> public capture -> ZIP
  // pipeline. The worker's fetch receives only the synthetic public responses.
  await build({entryPoints:[path.join(repository,'tests/fixtures/visual-stores.ts')],bundle:true,platform:'node',format:'esm',outfile:path.join(temporary,'visual-fixtures.mjs')});
  const {visualStore}=await import(pathToFileURL(path.join(temporary,'visual-fixtures.mjs'))),visual=visualStore('dark');
  const previewOrigin=JSON.parse(new TextDecoder().decode(entries['.yampi-sync/manifest.json'])).context.previewOrigin;
  const publicResources=Object.fromEntries(Object.entries(visual.resources).map(([url,resource])=>[url.replace(visual.snapshot.context.previewOrigin,previewOrigin),{...resource,...(resource.text?{text:resource.text.split(visual.snapshot.context.previewOrigin).join(previewOrigin)}:{})}]));
  await worker.evaluate(resources=>{const realFetch=globalThis.fetch;globalThis.testVisualReads=[];globalThis.fetch=async(url,options)=>{const resource=resources[String(url)];if(!resource)return realFetch(url,options);if(options?.method!=='GET'||options?.credentials!=='omit'||options?.redirect!=='error')throw new Error('Leitura pública sem proteção');globalThis.testVisualReads.push(String(url));const body=resource.base64?Uint8Array.from(atob(resource.base64),c=>c.charCodeAt(0)):resource.text;const response=new Response(body,{headers:{'content-type':resource.type}});Object.defineProperty(response,'url',{value:String(url)});return response;};},publicResources);
  await currentEditor.frameLocator('#test-toolbar').locator('#open').click();const visualTabId=await worker.evaluate(async()=> (await chrome.tabs.query({})).find(t=>t.url?.endsWith('?codemirror=current')).id);panel=await driver.attach(visualTabId);await panel.waitForFunction(()=>document.body.dataset.connection==='connected');
  // Persistent tabs switch directly from the store's remembered review to download.
  await panel.locator('#mode-export').click();
  await panel.locator('#export').click();await panel.waitForFunction(()=>['Falta autorizar imagens e fontes'].includes(document.querySelector('#status').textContent)||document.body.dataset.view==='result');
  assert.equal(await panel.locator('#status').textContent(),'Falta autorizar imagens e fontes',await panel.locator('#detail').textContent());
  const visualDownload=driver.waitExtensionDownload();await panel.locator('#preview-allow').click();await panel.waitForFunction(()=>document.body.dataset.view==='result');assert.equal(await panel.locator('#status').textContent(),'ZIP baixado',await panel.locator('#detail').textContent());
  const visualPath=path.join(temporary,'visual.zip');await (await visualDownload).saveAs(visualPath);const visualEntries=unzipSync(new Uint8Array(await readFile(visualPath))),visualManifest=JSON.parse(new TextDecoder().decode(visualEntries['preview/manifest.json']));
  assert.equal(visualManifest.version,2);assert.equal(visualManifest.source.association,'published-unverified');assert.equal(visualManifest.resources.length,6);assert.equal(visualManifest.pages.length,6);assert.ok(visualManifest.pages.every(p=>visualEntries['preview/'+p.file]));assert.ok(JSON.parse(new TextDecoder().decode(visualEntries['preview/raw/page-0.json'])).themeConfig.sections.length>0);assert.ok((await worker.evaluate(()=>globalThis.testVisualReads)).length>=12);
  assert.deepEqual(await currentEditor.evaluate(()=>window.fictitiousOperations),{dispatch:0,save:0,forbidden:0,add:0});assert.equal(await currentEditor.evaluate(()=>window.fictitiousUnchanged()),true);assert.match(await panel.locator('#preview-info').textContent(),/rascunho não vinculado/);
  console.log('E2E visual: painel real, autorização por origem, coleta pública estática e ZIP com páginas/assets; zero mutações no editor fictício.');
} catch (error) {
  if (browser) for (const worker of browser.serviceWorkers()) console.error('Diagnóstico fictício:', JSON.stringify(await worker.evaluate(async () => ({clicks:globalThis.testClicks,contexts: await chrome.runtime.getContexts({}), sessions: await chrome.storage.session.get(null), tabs: await Promise.all((await chrome.tabs.query({})).map(async t => ({url:t.url, title:await chrome.action.getTitle({tabId:t.id})})))})).catch(() => 'Worker indisponível'),null,2));
  if(browser)for(const page of browser.pages())for(const frame of page.frames().filter(frame=>frame.url().includes('test-launcher')))console.error('Launcher fictício:',await frame.evaluate(()=>({...document.body.dataset})).catch(()=>null));
  await mkdir(path.join(repository, '.cache'), {recursive: true});
  if (panel) {
    // A tab-scoped panel may be hidden while the preview tab is active. A
    // diagnostic screenshot must never prevent cleanup of a failed test.
    await Promise.race([panel.screenshot({path: path.join(repository, '.cache/panel-e2e-error.png'), fullPage: true}), new Promise((_, reject) => setTimeout(() => reject(new Error('Painel oculto')), 5000))]).catch(() => {});
  }
  throw error;
} finally {
  if (browser) await browser.close();
  if (localServer) await new Promise(resolve => localServer.close(resolve));
  if (!path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep + 'yampi-e2e-ficticio-')) throw new Error('Destino de limpeza inválido.');
  await rm(temporary, {recursive: true, force: true});
}
