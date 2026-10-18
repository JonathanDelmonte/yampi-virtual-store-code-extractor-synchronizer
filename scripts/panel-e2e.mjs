// UI regression checks use only the local demo and fictional exports. No real store access.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {readFile, writeFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {chromium} from 'playwright';
import {unzipSync, zipSync, strToU8} from 'fflate';

const root = path.resolve(import.meta.dirname, '..'), dist = path.join(root, 'dist');
const evidence = path.join(root, '.cache/panel-validation');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'yampi-panel-fictional-'));
await mkdir(evidence, {recursive: true});
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2'};
const server = http.createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://localhost').pathname, target = path.resolve(dist, '.' + name);
    if (!target.startsWith(dist + path.sep)) throw new Error('path');
    res.writeHead(200, {'content-type': types[path.extname(target)] || 'application/octet-stream'}).end(await readFile(target));
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({headless: true});
try {
  const context = await browser.newContext({viewport: {width: 360, height: 900}, colorScheme: 'dark', reducedMotion: 'reduce', locale: 'pt-BR', acceptDownloads: true});
  const foreign = [], errors = [], viewports = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    foreign.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(45000);
  const shot = name => page.screenshot({path: path.join(evidence, name + '.png'), fullPage: true, animations: 'disabled', style: '#demo-notice, #fixture { display: none !important; }'});
  async function fits(label) {
    const layout = await page.evaluate(() => ({viewport: innerWidth, document: document.documentElement.scrollWidth}));
    assert.ok(layout.document <= layout.viewport, label + ': rolagem lateral ' + JSON.stringify(layout));
  }
  await page.goto(origin + '/demo.html?demo=1');
  await page.waitForFunction(() => document.body.dataset.view === 'export' && !document.querySelector('#export').disabled);
  assert.equal(await page.locator('#connection-state').textContent(), 'Editor conectado');
  assert.equal(await page.getByRole('tab', {name: 'Baixar arquivos'}).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#export-section #export').count(), 1, 'A ação de baixar deve estar na própria seção.');
  assert.equal(await page.locator('#dock').evaluate(node => getComputedStyle(node).position), 'static');
  await page.locator('#include-preview').uncheck();
  for (const colorScheme of ['dark', 'light']) {
    await page.emulateMedia({colorScheme});
    for (const width of [320, 360, 560, 800]) {
      await page.setViewportSize({width, height: 900}); await fits('export ' + colorScheme + ' ' + width);
      viewports.push({colorScheme, width, horizontalOverflow: false});
    }
    await page.setViewportSize({width: 360, height: 900}); await shot('baixar-' + colorScheme);
  }
  await page.emulateMedia({colorScheme: 'dark'});
  await page.getByRole('tab', {name: 'Baixar arquivos'}).focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab', {name: 'Importar projeto'}).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#mode-import').evaluate(node => document.activeElement === node), true, 'As setas devem manter o foco nas abas.');
  assert.equal(await page.locator('#import-section').isVisible(), true);
  assert.equal(await page.locator('#import-section #pick-folder').isVisible(), true);
  await shot('importar-dark');
  await page.locator('#zip-choice > summary').click();
  await page.locator('#baseline').focus();
  assert.equal(await page.locator('.file-picker').evaluate(node => node.matches(':focus-within')), true);
  assert.equal(await page.locator('#zip-name').textContent(), 'Nenhum ZIP selecionado');
  for (const width of [320, 360, 560, 800]) {await page.setViewportSize({width, height: 900}); await fits('ZIP ' + width);}
  await page.setViewportSize({width: 360, height: 900}); await shot('importar-zip-dark');
  await page.locator('#menu').click();
  assert.equal(await page.locator('#recovery').evaluate(node => node.open), true);
  assert.equal(await page.locator('#download-backup').isDisabled(), true);
  assert.equal(await page.locator('#restore').isDisabled(), true);
  await shot('backups-dark');
  await page.getByRole('tab', {name: 'Importar projeto'}).focus(); await page.keyboard.press('Home');
  assert.equal(await page.locator('#export-section').isVisible(), true);
  const exported = page.waitForEvent('download'); await page.locator('#export').click();
  await page.waitForFunction(() => document.body.dataset.view === 'job' && !!document.querySelector('#phases li'));
  assert.equal(await page.locator('#mode-export').isDisabled(), true);
  assert.equal(await page.locator('#phases-box').evaluate(node => node.open), true);
  await shot('progresso-dark');
  const source = path.join(temporary, 'original.zip'); await (await exported).saveAs(source);
  await page.waitForFunction(() => document.body.dataset.view === 'result' && document.querySelector('#status').textContent === 'ZIP baixado');
  await page.locator('#finish').click();
  await page.waitForFunction(() => document.body.dataset.view === 'export');
  const entries = unzipSync(new Uint8Array(await readFile(source)));
  entries['tema/elements/head.twig'] = strToU8(new TextDecoder().decode(entries['tema/elements/head.twig']) + '\n<!-- Alteração fictícia para revisar -->\n');
  const returning = path.join(temporary, 'retorno-yampi-ficticio.zip'); await writeFile(returning, zipSync(entries));
  await page.getByRole('tab', {name: 'Importar projeto'}).click();
  await page.locator('#baseline').setInputFiles(returning);
  await page.waitForFunction(() => document.body.dataset.view === 'review' && !document.querySelector('#apply').disabled);
  assert.match(await page.locator('#summary').textContent(), /1 item para enviar/);
  assert.equal(await page.locator('#zip-name').textContent(), 'retorno-yampi-ficticio.zip');
  assert.equal(await page.locator('#review #apply').count(), 1);
  await page.locator('#all-files > summary').click();
  await page.locator('#rows .file-row').first().waitFor();
  assert.match(await page.locator('#rows').textContent(), /head.twig/);
  await shot('revisao-dark');
  await page.getByRole('tab', {name: 'Baixar arquivos'}).click();
  await page.getByRole('tab', {name: 'Importar projeto'}).click();
  assert.equal(await page.locator('#review').isVisible(), true, 'Mudar de aba deve preservar a comparação.');
  const operations = await page.locator('#fixture-frame').evaluate(frame => frame.contentWindow.fictitiousOperations);
  assert.deepEqual(operations, {dispatch: 0, save: 0, forbidden: 0, add: 0}, 'Navegação, exportação e comparação não podem gravar.');
  assert.deepEqual(foreign, []); assert.deepEqual(errors, []);
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify({fictionalOnly: true, viewports, keyboardTabs: true, zipImported: true, reviewPreserved: true, inlineActions: true, mutations: 0, errors}, null, 2) + '\n');
  console.log('Painel aprovado: abas por mouse/teclado, conexão visível, ações no conteúdo, ZIP importado, comparação preservada, progresso aberto, recuperação vazia, claro/escuro e 320–800 px. Zero gravações ou acessos a loja real.');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  assert.ok(temporary.startsWith(path.resolve(os.tmpdir()) + path.sep + 'yampi-panel-fictional-'));
  await rm(temporary, {recursive: true, force: true});
}
