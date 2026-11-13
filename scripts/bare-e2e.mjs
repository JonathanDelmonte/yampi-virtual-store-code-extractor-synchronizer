// A project that is only a theme, kept in theme/, with no .yampi-sync/ and no original kept by the
// extension, end to end with the demo panel and the fictitious editor only. The folder is a
// fictitious project in the browser's private file system (OPFS), handed to the panel in place of
// the native folder picker, which a test cannot drive. Nothing is ever written to the folder.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {readFile, mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const root = path.resolve(import.meta.dirname, '..'), dist = path.join(root, 'dist');
const evidence = path.join(root, '.cache/bare-validation');
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
const home = 'templates/home.twig', head = 'elements/head.twig', banner = 'sections/home/banner.twig', styles = 'assets/styles/global/main.scss';
// The fictitious store, and a project started from an earlier copy of it: the home was redone.
const store = {[home]: '<h1>Loja de testes</h1>\n', [head]: '<title>Loja de testes</title>\n', [banner]: '<section>Banner</section>\n', [styles]: 'body { margin: 0; }\n'};
const mine = '<h1>Loja de testes, redesenhada</h1>\n';
const text = value => Buffer.from(value).toString('base64');
const project = {
  ...Object.fromEntries(Object.entries(store).map(([file, value]) => ['theme/' + file, text(value)])),
  ['theme/' + home]: text(mine),
  // A 3D model the Yampi cannot keep, and what any project has around the theme.
  'theme/assets/models/cena.glb': Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 0xff, 0xfe]).toString('base64'),
  'package.json': text('{"name": "projeto-ficticio"}\n'),
  'node_modules/ficticio/index.js': text('module.exports = 1;\n'),
  'docs/README.md': text('# Projeto fictício\n')
};
try {
  const context = await browser.newContext({viewport: {width: 360, height: 900}, colorScheme: 'light', reducedMotion: 'reduce', locale: 'pt-BR'});
  const foreign = [], errors = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    foreign.push(route.request().url()); return route.abort();
  });
  await context.addInitScript(() => {window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('projeto-ficticio');});
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(45000);
  const shot = name => page.screenshot({path: path.join(evidence, name + '.png'), fullPage: true, animations: 'disabled', style: '#demo-notice, #fixture { display: none !important; }'});
  const fits = async label => {const layout = await page.evaluate(() => ({viewport: innerWidth, document: document.documentElement.scrollWidth})); assert.ok(layout.document <= layout.viewport, label + ': rolagem lateral ' + JSON.stringify(layout));};
  const readFolder = () => page.evaluate(async () => {
    const out = {}, visit = async (dir, prefix) => {for await (const entry of dir.values()) entry.kind === 'directory' ? await visit(entry, prefix + entry.name + '/') : out[prefix + entry.name] = btoa(String.fromCharCode(...new Uint8Array(await (await entry.getFile()).arrayBuffer())));};
    await visit(await (await navigator.storage.getDirectory()).getDirectoryHandle('projeto-ficticio'), ''); return out;
  });
  await page.goto(origin + '/demo.html?demo=1');
  await page.evaluate(files => sessionStorage.setItem('fixture-files', JSON.stringify(files)), store);
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.view === 'export' && !document.querySelector('#export').disabled);
  assert.equal(await page.locator('#baseline-info').isVisible(), false, 'A extensão começa sem o original desta loja.');
  await page.evaluate(async files => {
    const opfs = await navigator.storage.getDirectory();
    await opfs.removeEntry('projeto-ficticio', {recursive: true}).catch(() => {});
    const folder = await opfs.getDirectoryHandle('projeto-ficticio', {create: true});
    for (const [file, base64] of Object.entries(files)) {
      const parts = file.split('/'), name = parts.pop(); let dir = folder;
      for (const part of parts) dir = await dir.getDirectoryHandle(part, {create: true});
      const writer = await (await dir.getFileHandle(name, {create: true})).createWritable();
      await writer.write(Uint8Array.from(atob(base64), c => c.charCodeAt(0))); await writer.close();
    }
  }, project);
  // Choosing the folder: no download first, no error, and the comparison reads the whole store.
  await page.getByRole('tab', {name: 'Importar projeto'}).click();
  await page.locator('#pick-folder').click();
  await page.waitForFunction(() => document.body.dataset.view === 'review');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent?.includes('passou a ser o original deste projeto'));
  // A warning: its own tone and title, it stays while read, and it closes with one click.
  assert.equal(await page.locator('#toast').getAttribute('data-tone'), 'warn');
  assert.equal(await page.locator('#toast strong').textContent(), 'A loja lida agora passou a ser o original deste projeto');
  await shot('aviso-claro');
  await page.emulateMedia({colorScheme: 'dark'}); await shot('aviso-escuro'); await page.emulateMedia({colorScheme: 'light'});
  await page.locator('#toast').hover(); await page.waitForTimeout(400);
  assert.equal(await page.locator('#toast').isVisible(), true);
  await page.locator('#toast .toast-close').click();
  assert.equal(await page.locator('#toast').isVisible(), false, 'O aviso fecha com um clique.');
  // What the reading left out stays in the review, not only in a passing message.
  assert.match(await page.locator('#attention-list').textContent(), /assets\/models\/cena\.glb ficou de fora: a Yampi guarda só textos e imagens/);
  assert.equal(await page.locator('#notice').isVisible().catch(() => false), false, 'Nenhum erro ao importar.');
  assert.match(await page.locator('#summary').textContent(), /1 arquivo alterado\. Nenhum conflito\./);
  assert.equal(await page.locator('#apply-label').textContent(), 'Enviar 1 item para Loja de testes');
  assert.match(await page.locator('#reference-detail').textContent(), /comparado com a referência: a loja em/);
  // Update and versions keep records in .yampi-sync/, which this folder does not have: off, explained.
  assert.equal(await page.locator('#update-project').isDisabled(), true);
  assert.equal(await page.locator('#open-versions').isDisabled(), true);
  assert.match(await page.locator('#project-tools-note').textContent(), /\.yampi-sync\/, que esta pasta não tem/);
  await fits('revisão do tema solto'); await shot('tema-solto-revisao');
  // The send: only the redone home, confirmed in the fictitious editor.
  await page.locator('#apply').click(); await page.locator('#confirm-send').click();
  await page.waitForFunction(() => document.body.dataset.view === 'result' && document.querySelector('#status').textContent === 'Envio concluído');
  const storeAfter = await page.evaluate(() => JSON.parse(sessionStorage.getItem('fixture-files')));
  assert.deepEqual(storeAfter, {...store, [home]: mine}, 'Só a home mudou na loja.');
  const operations = await page.locator('#fixture-frame').evaluate(frame => frame.contentWindow.fictitiousOperations);
  assert.equal(operations.forbidden, 0, 'Nenhum controle proibido (como Publicar) foi acionado.');
  // The folder is exactly as the user left it: no .yampi-sync/, no file of the extension.
  assert.deepEqual(await readFolder(), project, 'Nada foi gravado na pasta do projeto.');
  // Choosing the folder again (Concluir leaves no project loaded) compares with the store after the
  // send, kept as the reference: nothing left to send, and no second reading of the whole store.
  await page.locator('#finish').click();
  await page.waitForFunction(() => document.body.dataset.view === 'pick');
  await page.locator('#pick-folder').click();
  await page.waitForFunction(() => document.body.dataset.view === 'review' && document.querySelector('#apply-label')?.textContent === 'Nada para enviar');
  assert.match(await page.locator('#summary').textContent(), /Nenhum conflito/);
  // The store refuses a creation without a message (the editor only logs it, and its window stays
  // open): the send stops in seconds and says so; continuing later creates it once.
  const novidade = 'sections/home/novidade.twig', novidadeText = '<section>Novidade</section>\n';
  await page.evaluate(async ([file, value]) => {
    const parts = ('projeto-ficticio/theme/' + file).split('/'), name = parts.pop(); let dir = await navigator.storage.getDirectory();
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    const writer = await (await dir.getFileHandle(name, {create: true})).createWritable(); await writer.write(value); await writer.close();
  }, [novidade, novidadeText]);
  await page.evaluate(() => sessionStorage.setItem('fixture-refuse-create', '1'));
  await page.locator('#leave-review').click();
  await page.waitForFunction(() => document.body.dataset.view === 'pick');
  await page.locator('#pick-folder').click();
  await page.waitForFunction(() => document.body.dataset.view === 'review' && document.querySelector('#apply-label')?.textContent === 'Enviar 1 item para Loja de testes');
  const refusedAt = Date.now();
  await page.locator('#apply').click(); await page.locator('#confirm-send').click();
  await page.waitForFunction(() => document.body.dataset.view === 'result' && document.querySelector('#status').textContent === 'Envio interrompido');
  assert.ok(Date.now() - refusedAt < 20000, `A recusa é reconhecida antes do prazo de 20 s (${Date.now() - refusedAt} ms).`);
  // The editor of 05/11/2026 creates in a row of the folder and shows the server's refusal under the field.
  assert.match(await page.locator('#detail').textContent(), /A Yampi recusou sections\/home\/novidade\.twig: Erro ao criar o arquivo\./);
  const fixtureState = () => page.locator('#fixture-frame').evaluate(frame => {const tree = frame.contentWindow.document.querySelector('yampi-code-editor').shadowRoot; return {row: !!tree.querySelector('.editing-row'), dialog: !!tree.querySelector('.ds-modal-overlay--active')};});
  assert.deepEqual(await fixtureState(), {row: false, dialog: false}, 'O campo de novo arquivo foi fechado sem criar.');
  await shot('criacao-recusada');
  // Earlier editors opened a window, and kept a server refusal to the console: recognized by its button.
  await page.evaluate(() => sessionStorage.setItem('fixture-creation', 'janela'));
  await page.locator('#resume').click();
  await page.waitForFunction(() => document.body.dataset.view === 'result' && document.querySelector('#status').textContent === 'Envio interrompido' && document.querySelector('#detail').textContent.includes('a janela "Adicionar arquivo" continuou aberta'));
  assert.match(await page.locator('#detail').textContent(), /A Yampi não confirmou a criação de sections\/home\/novidade\.twig: o pedido terminou e a janela "Adicionar arquivo" continuou aberta, sem mensagem/);
  assert.deepEqual(await fixtureState(), {row: false, dialog: false}, 'A janela da Yampi foi fechada sem confirmar.');
  await page.evaluate(() => {sessionStorage.removeItem('fixture-refuse-create'); sessionStorage.removeItem('fixture-creation');});
  await page.locator('#resume').click();
  await page.waitForFunction(() => document.body.dataset.view === 'result' && document.querySelector('#status').textContent === 'Envio concluído');
  assert.equal((await page.evaluate(() => JSON.parse(sessionStorage.getItem('fixture-files'))))[novidade], novidadeText, 'Ao continuar, o arquivo foi criado uma vez e preenchido.');
  await page.locator('#finish').click();
  await page.waitForFunction(() => document.body.dataset.view === 'pick');
  await page.locator('#pick-folder').click();
  await page.waitForFunction(() => document.body.dataset.view === 'review' && document.querySelector('#apply-label')?.textContent === 'Nada para enviar');
  // A redesign with files in folders the store does not have, and a script: one line per cause, the
  // files behind "Ver", and the reason the send waits.
  await page.evaluate(async files => {
    const opfs = await navigator.storage.getDirectory();
    let dir = await (await opfs.getDirectoryHandle('projeto-ficticio')).getDirectoryHandle('theme');
    for (const part of ['components']) dir = await dir.getDirectoryHandle(part, {create: true});
    for (const [file, value] of Object.entries(files)) {
      const parts = file.split('/'), name = parts.pop(); let target = dir;
      for (const part of parts) target = await target.getDirectoryHandle(part, {create: true});
      const writer = await (await target.getFileHandle(name, {create: true})).createWritable(); await writer.write(value); await writer.close();
    }
  }, {'catalogo/CatalogoCard.vue': '<template><div>Card</div></template>\n', 'catalogo/CatalogoLista.vue': '<template><div>Lista</div></template>\n', 'manual/ManualBusca.vue': '<template><div>Busca</div></template>\n', 'ajuda.js': 'export default 1;\n', 'passos.js': 'export default 2;\n'});
  await page.locator('#leave-review').click();
  await page.waitForFunction(() => document.body.dataset.view === 'pick');
  await page.locator('#pick-folder').click();
  await page.waitForFunction(() => document.body.dataset.view === 'review' && document.querySelector('#status')?.textContent === 'Ajuste o projeto antes de enviar');
  assert.match(await page.locator('#detail').textContent(), /^5 arquivos novos não podem ser criados na Yampi, e o envio espera por eles/);
  const attention = await page.locator('#attention-list').textContent();
  assert.match(attention, /3 arquivos novos estão em 2 pastas que não existem na loja, e a Yampi não cria pastas: components\/catalogo \(2\) e components\/manual \(1\)\. Mova-os para pastas que já existem/);
  assert.match(attention, /2 arquivos: A Yampi só cria arquivos \.twig, \.vue e \.scss/);
  assert.equal(await page.locator('#attention-list .attention-files').count(), 2);
  await page.locator('#attention-list .attention-files summary').first().click();
  assert.equal(await page.locator('#attention-list .attention-files').first().locator('li').count(), 3);
  assert.equal(await page.locator('#apply').isDisabled(), true);
  await fits('revisão agrupada'); await shot('revisao-agrupada');
  await page.getByRole('tab', {name: 'Baixar arquivos'}).click();
  assert.match(await page.locator('#baseline-info').textContent(), /^Loja lida na comparação em /);
  assert.deepEqual(foreign, [], 'Nenhum endereço externo.');
  assert.deepEqual(errors, [], 'Sem erros na página.');
  console.log('Tema solto aprovado: pasta com theme/ sem .yampi-sync/, original lido da loja fictícia na primeira comparação, envio conferido e pasta intacta. Nenhum acesso a loja real.');
} finally {
  await browser.close();
  server.close();
}
