// Update of the project folder and its versions, end to end, with the demo panel and the fictitious
// editor only. The folder is a fictitious project in the browser's private file system (OPFS), handed
// to the panel in place of the native folder picker, which a test cannot drive.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {readFile, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {unzipSync} from 'fflate';

const root = path.resolve(import.meta.dirname, '..'), dist = path.join(root, 'dist');
const evidence = path.join(root, '.cache/update-validation');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'yampi-update-fictional-'));
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
const head = 'elements/head.twig', long = 'templates/long.twig', scss = 'assets/styles/global/main.scss', header = 'elements/header/head.twig', promo = 'sections/home/promo.twig';
try {
  const context = await browser.newContext({viewport: {width: 360, height: 900}, colorScheme: 'light', reducedMotion: 'reduce', locale: 'pt-BR', acceptDownloads: true});
  const foreign = [], errors = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    foreign.push(route.request().url()); return route.abort();
  });
  // The panel's folder picker returns the fictitious project folder kept in OPFS.
  await context.addInitScript(() => {window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('loja-de-testes');});
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(45000);
  const shot = name => page.screenshot({path: path.join(evidence, name + '.png'), fullPage: true, animations: 'disabled', style: '#demo-notice, #fixture { display: none !important; }'});
  const fits = async label => {const layout = await page.evaluate(() => ({viewport: innerWidth, document: document.documentElement.scrollWidth})); assert.ok(layout.document <= layout.viewport, label + ': rolagem lateral ' + JSON.stringify(layout));};
  const folder = {
    // Every file of the fictitious project folder, as text.
    read: () => page.evaluate(async () => {
      const out = {}, visit = async (dir, prefix) => {for await (const entry of dir.values()) entry.kind === 'directory' ? await visit(entry, prefix + entry.name + '/') : out[prefix + entry.name] = await (await entry.getFile()).text();};
      await visit(await (await navigator.storage.getDirectory()).getDirectoryHandle('loja-de-testes'), ''); return out;
    }),
    write: (files) => page.evaluate(async files => {
      const opfs = await navigator.storage.getDirectory();
      await opfs.removeEntry('loja-de-testes', {recursive: true}).catch(() => {});
      const project = await opfs.getDirectoryHandle('loja-de-testes', {create: true});
      for (const [file, base64] of Object.entries(files)) {
        const parts = file.split('/'), name = parts.pop(); let dir = project;
        for (const part of parts) dir = await dir.getDirectoryHandle(part, {create: true});
        const writer = await (await dir.getFileHandle(name, {create: true})).createWritable();
        await writer.write(Uint8Array.from(atob(base64), c => c.charCodeAt(0))); await writer.close();
      }
    }, files)
  };
  await page.goto(origin + '/demo.html?demo=1');
  await page.waitForFunction(() => document.body.dataset.view === 'export' && !document.querySelector('#export').disabled);
  await page.locator('#include-preview').uncheck();
  const exported = page.waitForEvent('download'); await page.locator('#export').click();
  const zip = path.join(temporary, 'original.zip'); await (await exported).saveAs(zip);
  await page.waitForFunction(() => document.body.dataset.view === 'result');
  await page.locator('#finish').click(); await page.waitForFunction(() => document.body.dataset.view === 'export');
  const entries = unzipSync(new Uint8Array(await readFile(zip))), decode = bytes => new TextDecoder().decode(bytes);
  const original = Object.fromEntries(Object.entries(entries).filter(([file]) => file.startsWith('tema/')).map(([file, bytes]) => [file.slice(5), bytes]));
  // The developer's work: a line near the top of the long template, and the head.
  const longLines = decode(original[long]).split('\n');
  const mine = {[long]: longLines.map((line, index) => index === 9 ? line + ' <!-- pasta -->' : line).join('\n'), [head]: '<meta name="description" content="Descrição da pasta">\n'};
  const project = {};
  for (const [file, bytes] of Object.entries(entries)) if (file.startsWith('tema/') || file.startsWith('.yampi-sync/')) project[file] = Buffer.from(bytes).toString('base64');
  for (const [file, text] of Object.entries(mine)) project['tema/' + file] = Buffer.from(text).toString('base64');
  await folder.write(project);
  // The client's work in the store: a line near the end of the same template, the head too, the styles,
  // a removed file and a new one.
  const store = Object.fromEntries(Object.entries(original).filter(([file]) => !/\.(png|jpe?g|webp|svg)$/.test(file)).map(([file, bytes]) => [file, decode(bytes)]));
  store[long] = longLines.map((line, index) => index === 1990 ? line + ' <!-- loja -->' : line).join('\n');
  store[head] = '<meta name="description" content="Descrição do cliente">\n';
  store[scss] = store[scss] + 'h1 { letter-spacing: .02em; }\n';
  delete store[header];
  store[promo] = '<section>Promoção criada pelo cliente</section>\n';
  await page.evaluate(files => sessionStorage.setItem('fixture-files', JSON.stringify(files)), store);
  await page.getByRole('tab', {name: 'Importar projeto'}).click();
  await page.locator('#pick-folder').click();
  await page.waitForFunction(() => document.body.dataset.view === 'review');
  assert.equal(await page.locator('#project-tools').isVisible(), true, 'Atualizar e Versões aparecem com o projeto lido da pasta.');
  // Before updating, the head changed in both places: a conflict that blocks the send of that file.
  assert.match(await page.locator('#summary').textContent(), /conflito/);
  await page.locator('#update-project').click();
  await page.waitForFunction(() => document.body.dataset.view === 'update');
  assert.equal(await page.locator('#count-store').textContent(), '3', 'Estilos, arquivo removido e arquivo novo vêm da loja.');
  assert.equal(await page.locator('#count-merged').textContent(), '1');
  assert.equal(await page.locator('#count-decide').textContent(), '1');
  assert.match(await page.locator('#update-attention-list').textContent(), /elements\/head\.twig: mudou dos dois lados nas mesmas linhas\. Vai com as duas versões marcadas/);
  assert.match(await page.locator('#status').textContent(), /1 arquivo para decidir antes de atualizar/);
  await fits('revisão da atualização'); await shot('atualizacao-revisao');
  // Comparing shows the three versions; choosing changes only the plan, never the folder yet.
  await page.locator('#update-attention-list button', {hasText: 'Comparar'}).click();
  assert.equal(await page.locator('#diff').isVisible(), true);
  assert.equal(await page.locator('#diff-choose-store').isVisible(), true);
  await page.locator('#diff-choose-mine').click();
  assert.match(await page.locator('#update-attention-list').textContent(), /Fica a da pasta\. No próximo envio, ela substitui a da loja/);
  await page.locator('#diff-choose-marks').click();
  await page.locator('#close-diff').click();
  assert.equal(decode(Buffer.from(project['tema/' + head], 'base64')), (await folder.read())['tema/' + head], 'Nada é gravado antes de aplicar.');
  await page.locator('#apply-update').click();
  await page.waitForFunction(() => document.body.dataset.view === 'pick' && document.querySelector('#notice strong')?.textContent === 'Pasta atualizada com a loja');
  assert.match(await page.locator('#notice').textContent(), /Com marcações de conflito para resolver no editor de código: elements\/head\.twig\./);
  await shot('atualizacao-concluida');
  const after = await folder.read();
  assert.match(after['tema/' + long], /<!-- pasta -->/); assert.match(after['tema/' + long], /<!-- loja -->/);
  assert.match(after['tema/' + head], /^<<<<<<< pasta \(sua versão\)\n<meta name="description" content="Descrição da pasta">\n=======\n<meta name="description" content="Descrição do cliente">\n>>>>>>> loja \(Yampi\)\n$/);
  assert.equal(after['tema/' + scss], store[scss]);
  assert.equal(after['tema/' + promo], store[promo]);
  assert.equal(after['tema/' + header], undefined);
  assert.equal(after['.yampi-sync/referencia-pendente.json'], undefined);
  assert.equal(after['.yampi-sync/baseline/' + head], store[head]);
  assert.equal(after['.yampi-sync/baseline/' + header], undefined);
  assert.equal(JSON.parse(after['.yampi-sync/manifest.json']).reference.reason, 'update');
  const records = files => Object.keys(files).filter(file => /^\.yampi-sync\/versoes\/[^/]+\.json$/.test(file));
  assert.equal(records(after).length, 3, 'Referência, pasta e loja guardadas antes de mudar a pasta.');
  assert.ok(!Object.keys(after).some(file => file.startsWith('.yampi-sync/versoes/') && /\.(png|jpe?g|webp|svg)$/.test(file)), 'Versões não guardam imagens.');
  // The next comparison never sends the marked file.
  await page.locator('#reload-folder').click();
  await page.waitForFunction(() => document.body.dataset.view === 'review');
  await page.locator('#all-files > summary').click();
  assert.match(await page.locator('#attention-list').textContent(), /Ainda tem marcações de conflito/);
  // Versions: open the folder before the update and bring the head back.
  await page.locator('#open-versions').click();
  await page.waitForFunction(() => !document.querySelector('#versions-sheet').hidden && document.querySelectorAll('#versions-list li').length === 3);
  await fits('versões'); await shot('versoes-lista');
  await page.locator('#versions-list li', {hasText: 'Pasta antes de atualizar'}).getByRole('button', {name: 'Abrir'}).click();
  await page.waitForFunction(() => !document.querySelector('#version-detail').hidden);
  assert.match(await page.locator('#version-rows').textContent(), /head\.twigelements\/Mudou desde então/);
  await shot('versao-aberta');
  await page.locator('#version-rows li', {hasText: 'head.twig'}).filter({hasText: 'elements/'}).first().getByRole('button', {name: 'Trazer'}).click();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent?.includes('1 arquivo trazido'));
  const restored = await folder.read();
  assert.equal(restored['tema/' + head], mine[head]);
  assert.equal(records(restored).length, 4, 'A pasta de antes de trazer também fica guardada.');
  // A named version of the folder as it is now.
  await page.locator('#version-back').click();
  await page.locator('#version-name').fill('Cabeçalho aprovado pelo cliente');
  await page.locator('#save-version').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#versions-list .file-name')].some(node => node.textContent === 'Cabeçalho aprovado pelo cliente'));
  assert.equal(records(await folder.read()).length, 5);
  await page.locator('#close-versions').click();
  const operations = await page.locator('#fixture-frame').evaluate(frame => frame.contentWindow.fictitiousOperations);
  assert.deepEqual(operations, {dispatch: 0, save: 0, forbidden: 0, add: 0}, 'Atualizar e recuperar versões nunca gravam na loja.');
  // A send afterwards: the merged template and the head brought back from the version (the user's
  // explicit choice, with the store's head in the backup). The folder's reference follows the send.
  await page.locator('#reload-folder').click();
  await page.waitForFunction(() => document.body.dataset.view === 'review' && !document.querySelector('#apply').disabled);
  assert.equal(await page.locator('#apply-label').textContent(), 'Enviar 2 itens para Loja de testes');
  await page.locator('#apply').click(); await page.locator('#confirm-send').click();
  await page.waitForFunction(() => document.body.dataset.view === 'result' && document.querySelector('#status').textContent === 'Envio concluído');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent === 'Envio registrado também na pasta do projeto.');
  const sent = await folder.read(), sentManifest = JSON.parse(sent['.yampi-sync/manifest.json']);
  assert.equal(sentManifest.reference.reason, 'send');
  assert.equal(sent['.yampi-sync/baseline/' + long], restored['tema/' + long], 'A referência da pasta recebe o que foi conferido na loja.');
  assert.equal(sent['.yampi-sync/baseline/' + head], mine[head]);
  assert.equal(sent['.yampi-sync/referencia-pendente.json'], undefined);
  assert.equal(records(sent).length, 6, 'Uma versão guarda a loja depois do envio.');
  assert.ok(Object.entries(sent).some(([file, value]) => records({[file]: ''}).length && JSON.parse(value).kind === 'envio'));
  // Each save reloads the fictitious editor (and its counters): check what the store kept instead.
  const storeAfter = await page.evaluate(() => JSON.parse(sessionStorage.getItem('fixture-files')));
  assert.equal(storeAfter[long], restored['tema/' + long]); assert.equal(storeAfter[head], mine[head]);
  assert.deepEqual(foreign, []); assert.deepEqual(errors, []);
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify({fictionalOnly: true, merged: true, conflictMarked: true, storeOnlyApplied: true, removedFollowed: true, referenceRewritten: true, versions: 6, imagesInVersions: 0, storeWritesBeforeSend: 0, sendRecordedInFolder: true, errors}, null, 2) + '\n');
  console.log('Atualização aprovada: junção linha a linha, conflito marcado, arquivos removidos e novos da loja, referência reescrita na pasta, versões só de texto, recuperação e versão nomeada sem gravar na loja; o envio seguinte ficou registrado na pasta.');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  assert.ok(temporary.startsWith(path.resolve(os.tmpdir()) + path.sep + 'yampi-update-fictional-'));
  await rm(temporary, {recursive: true, force: true});
}
