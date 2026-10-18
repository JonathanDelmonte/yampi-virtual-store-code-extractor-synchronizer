import {describe, test, expect, afterEach} from 'vitest';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {unzipSync, zipSync, strToU8} from 'fflate';
import {encodeSnapshot, decodeProject} from '../src/core/archive';
import {demonstration} from '../src/core/preview';
import {demoSnapshot} from '../src/demo/sample';
import {readProject, renderPage, validateMarkup, compileStyles, compileComponents, registeredComponents} from '../local-runtime/engine.mjs';
import {packProject, returnSummary} from '../local-runtime/pack.mjs';
import {createLocalServer, validateLocal} from '../local-runtime/dev.mjs';
import {checkIntegrity} from '../local-runtime/preview.mjs';
import {adaptedLocutus} from '../local-runtime/twig.mjs';
import {localKit} from '../src/core/local-kit';
import {updateProject, rollbackProject} from '../scripts/update-project.mjs';
const folders = [], servers = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise(resolve => server.close(resolve));
  for (const folder of folders.splice(0)) {
    if (!path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep + 'yampi-ficticio-')) throw new Error('Destino de limpeza inválido.');
    await rm(folder, {recursive: true, force: true});
  }
});
async function temporary() {const root = await mkdtemp(path.join(os.tmpdir(), 'yampi-ficticio-')); folders.push(root); return root;}
async function project(zip) {
  const root = await temporary();
  for (const [p, b] of Object.entries(unzipSync(zip || await encodeSnapshot(demoSnapshot, true)))) {
    await mkdir(path.dirname(path.join(root, p)), {recursive: true}); await writeFile(path.join(root, p), b);
  }
  return root;
}
const render = (template, data = {}) => renderPage({'templates/t.twig': template}, 'templates/t.twig', data);
describe('ambiente local portátil', () => {
  test('atualizador preserva edições, configuração, contexto e baseline; dry-run não grava', async () => {
    const root = await project(), pkg = JSON.parse(await readFile(path.join(root, 'package.json'))); pkg.version = '0.2.4'; pkg.scripts.dev = 'node meu-servidor.mjs'; pkg.scripts.custom = 'echo personalizado'; delete pkg.scripts['check:integrity'];
    await writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2)); await writeFile(path.join(root, 'tema/templates/home.twig'), '<h1>Trabalho do usuário</h1>'); await writeFile(path.join(root, 'local.data.json'), '{"meusDados":true}');
    const protectedPaths = ['tema/templates/home.twig', 'local.data.json', 'local.config.json', '.yampi-sync/manifest.json', '.yampi-sync/baseline/templates/home.twig', 'preview/manifest.json']; const before = await Promise.all(protectedPaths.map(p => readFile(path.join(root, p))));
    const oldPackage = await readFile(path.join(root, 'package.json')); const plan = await updateProject(root); expect(plan.apply).toBe(false); expect(plan.packageChanges).toContainEqual({field: 'version', before: '0.2.4', after: '0.6.0'}); expect(await readFile(path.join(root, 'package.json'))).toEqual(oldPackage);
    const applied = await updateProject(root, {apply: true}); expect(applied.backup).toContain('.yampi-sync/updates/'); const next = JSON.parse(await readFile(path.join(root, 'package.json'))); expect(next.scripts.dev).toBe(pkg.scripts.dev); expect(next.scripts.custom).toBe(pkg.scripts.custom); expect(next.scripts['check:integrity']).toContain('integrity.mjs');
    for (let i = 0; i < protectedPaths.length; i++) expect(await readFile(path.join(root, protectedPaths[i]))).toEqual(before[i]); expect(await readFile(path.join(root, applied.backup, 'before/package.json'))).toEqual(oldPackage);
  });
  test('atualizador recusa ferramenta editada, links e original adulterado antes de gravar', async () => {
    const root = await project(); const oldPackage = await readFile(path.join(root, 'package.json')); await writeFile(path.join(root, '.yampi-sync/tools/dev.mjs'), '// Minha ferramenta personalizada\n'); await expect(updateProject(root, {apply: true})).rejects.toThrow('modificada pelo usuário'); expect(await readFile(path.join(root, 'package.json'))).toEqual(oldPackage);
    const linked = await temporary(); await symlink(root, path.join(linked, 'junction'), process.platform === 'win32' ? 'junction' : 'dir'); await expect(updateProject(path.join(linked, 'junction'), {apply: true})).rejects.toThrow('link');
  });
  test('atualizador troca preview/ por nova exportação, migra dados antigos e permite desfazer', async () => {
    const root = await project(), oldManifest = await readFile(path.join(root, 'preview/manifest.json')), oldTool = await readFile(path.join(root, '.yampi-sync/tools/engine.mjs'));
    await writeFile(path.join(root, 'local.data.json'), '{"merchantData":{"manifest":{"name":"cópia antiga"}}}');
    const fresh = demonstration(demoSnapshot.context, 'Nova captura fictícia', Object.keys(demoSnapshot.files)); fresh.capturedAt = '2026-10-14T12:00:00.000Z';
    const zip = path.join(await temporary(), 'nova.zip'); await writeFile(zip, await encodeSnapshot(demoSnapshot, true, fresh));
    const plan = await updateProject(root, {preview: zip});
    expect(plan.changed).toContainEqual({path: 'preview/manifest.json', action: 'replace'}); expect(plan.changed).toContainEqual({path: 'local.data.json', action: 'replace', note: 'formato anterior movido para o backup'}); expect(plan.preview.themeMatchesBaseline).toBe(true);
    const applied = await updateProject(root, {preview: zip, apply: true});
    expect(JSON.parse(await readFile(path.join(root, 'preview/manifest.json'))).capturedAt).toBe('2026-10-14T12:00:00.000Z'); expect(JSON.parse(await readFile(path.join(root, 'local.data.json'))).format).toBe('yampi-local-overrides');
    await expect(rollbackProject(root, applied.backup)).resolves.toMatchObject({apply: false});
    await rollbackProject(root, applied.backup, {apply: true});
    expect(await readFile(path.join(root, 'preview/manifest.json'))).toEqual(oldManifest); expect(String(await readFile(path.join(root, 'local.data.json')))).toContain('cópia antiga'); expect(await readFile(path.join(root, '.yampi-sync/tools/engine.mjs'))).toEqual(oldTool);
    const other = path.join(await temporary(), 'outra.zip'); await writeFile(other, await encodeSnapshot({...demoSnapshot, context: {...demoSnapshot.context, storeName: 'Outra loja'}}, true));
    await expect(updateProject(root, {preview: other})).rejects.toThrow('outra loja');
  });
  test('Twig monta includes e filtro de assets sem dependência da Yampi; não lê arquivos externos', () => {
    const result = renderPage(demoSnapshot.files, 'templates/home.twig', {section: {params: {title: 'Fictício'}}});
    expect(result).toContain('<h1>Fictício</h1>'); expect(result).toContain('/tema/assets/images/example.png');
    expect(() => renderPage({'templates/home.twig': '{% include "../../package.json" %}'}, 'templates/home.twig', {})).toThrow();
    expect(() => render('{{ "style.css" | vendor_url }}')).toThrow('Yampi');
    expect(render('{{ values|filter(v => v.active)|map(v => v.label)|join(", ") }}', {values: [{active: true, label: '<Fictício>'}, {active: false, label: 'ignorado'}]})).toBe('&lt;Fictício&gt;');
  });
  test('Twig segue o Twig PHP com strict_variables desligado', () => {
    const data = {p: {nulo: null}, sections: [{params: {title: 'zero'}}, {params: {title: 'um'}}]};
    const cases = {
      '{{ p.ausente | raw }}': '', '{{ p.nulo | raw }}': '', '{{ true | raw }}': '1', '{{ false | raw }}': '', '{{ p.ausente | default("x") }}': 'x', '{{ p.ausente | length }}': '0',
      '{{ p.ausente | upper }}': '', '{{ p.ausente | trim }}': '', '{{ p.ausente | replace({"a": "b"}) }}': '', '{{ "%s!" | format(p.ausente) }}': '!', '{{ p.ausente | abs }}': '0', '{{ p.ausente | url_encode }}': '',
      '{{ p.ausente | json_encode }}': 'null', '{{ {a: 1} | json_encode | raw }}': '{"a":1}', '{{ [1] | merge([2]) | join(",") }}': '1,2', '{{ "2026-10-09" | date("d/m/Y") }}': '09/10/2026',
      '{{ sections.1.params.title }}': 'um', '{{ [1, 2, 3] | filter(v => v > 1) | map(v => v * 2) | join(",") }}': '4,6', '{{ true ~ "x" }}': '1x', '{{ false ~ "x" }}': 'x', '{{ "5" + 1 }}': '6', '{{ p.ausente + 1 }}': '1',
    };
    for (const [template, expected] of Object.entries(cases)) expect(render(template, data), template).toBe(expected);
    for (const template of ['{{ p.nulo | merge([1]) }}', '{{ p.ausente | filter(v => v) | length }}', '{{ "abc" + 1 }}']) expect(() => render(template, data), template).toThrow();
    expect(adaptedLocutus).toEqual(expect.arrayContaining(['locutus/php/strings', 'locutus/php/math', 'locutus/php/strings/sprintf', 'locutus/php/math/round']));
  });
  test('markup: binding inválido falha; tag não fechada vira aviso com o arquivo provável', () => {
    expect(() => validateMarkup(render('<example :value="{{ missing }}"></example>'))).toThrow('v-bind');
    const files = {'sections/product/similares.twig': '<section><rocket-emitter event="x"><h2>Semelhantes</h2></section>', 'templates/product.twig': '<div id="app">{% include "sections/product/similares.twig" %}</div>'};
    const html = '<!doctype html><html><body>' + renderPage(files, 'templates/product.twig', {}) + '</body></html>';
    const {warnings} = validateMarkup(html, {files});
    expect(warnings).toHaveLength(1); expect(warnings[0].reason).toContain('rocket-emitter'); expect(warnings[0].files).toEqual(['sections/product/similares.twig (1 aberturas, 0 fechamentos)']);
  });
  test('projeto usa o nome do editor, entradas Sass, sobreposições vazias e preserva espaços no VS Code', () => {
    const kit = localKit(['assets/styles/global/main.scss', 'assets/styles/global/buttons.scss', 'assets/styles/pages/home.scss'], 'CON');
    expect(kit['loja-con.code-workspace']).toBeDefined(); expect(JSON.parse(kit['package.json']).name).toBe('loja-con');
    expect(JSON.parse(kit['loja-con.code-workspace']).folders).toEqual([{path: '.', name: 'CON'}]);
    expect(JSON.parse(kit['local.config.json']).styles).toEqual(['assets/styles/global/main.scss']);
    expect(JSON.parse(kit['local.config.json']).pageStyles.home).toBeUndefined();
    expect(JSON.parse(kit['local.data.json'])).toMatchObject({format: 'yampi-local-overrides', version: 1, global: {}, pages: {}});
    const settings = JSON.parse(kit['.vscode/settings.json']);
    expect(settings).toMatchObject({'files.exclude': {'.yampi-sync': true}, 'files.eol': '\n', 'files.insertFinalNewline': false, 'files.trimFinalNewlines': false, 'files.trimTrailingWhitespace': false, 'editor.formatOnSave': false, 'files.encoding': 'utf8', '[vue]': {'editor.formatOnSave': false}});
    expect(kit['.editorconfig']).toContain('trim_trailing_whitespace = false'); expect(kit['.editorconfig']).not.toMatch(/^insert_final_newline/m);
    // Each group of ignore rules is explained by a comment line above it.
    const blocks = [];
    for (const line of kit['.gitignore'].trim().split('\n')) {
      const last = blocks.at(-1);
      if (line.startsWith('#') && last && !last.rules.length) last.comments.push(line);
      else if (line.startsWith('#')) blocks.push({comments: [line], rules: []});
      else if (last) last.rules.push(line); else blocks.push({comments: [], rules: [line]});
    }
    expect(blocks.every(block => block.comments.length > 0 && block.rules.length > 0)).toBe(true);
    expect(kit['.gitignore']).toContain('# Em um repositório PRIVADO'); expect(kit['README.md']).toContain('Como editar local.data.json');
    expect(Object.keys(kit).filter(p => p.startsWith('.yampi-sync/tools/')).sort()).toEqual(['contract.mjs', 'dependencies.mjs', 'dev.mjs', 'engine.mjs', 'integrity.mjs', 'pack.mjs', 'parity.mjs', 'platform-browser.mjs', 'platform.mjs', 'preview.mjs', 'twig.mjs'].map(n => '.yampi-sync/tools/' + n));
  });
  test('compila Sass, parciais e imports relativos; $assets aponta para os ícones da plataforma', () => {
    expect(compileStyles({'assets/styles/main.scss': '@use "colors"; body { color: colors.$brand; }', 'assets/styles/_colors.scss': '$brand: #123456;'}, ['assets/styles/main.scss'])).toContain('#123456');
    expect(() => compileStyles({'assets/a.scss': '@use "../../segredo";'}, ['assets/a.scss'])).toThrow();
    expect(compileStyles({'assets/main.scss': '.image { background: url($assets + "/img/a.svg"); }'}, ['assets/main.scss'])).toContain('/__platform/assets/img/a.svg');
    expect(compileStyles({'assets/main.scss': '.a { opacity: 0.5; }'}, ['assets/main.scss'], {style: 'compressed'})).toBe('.a{opacity:.5}');
  });
  test('resolve aliases de componentes e bibliotecas; compila Vue funcional e recusa módulo desconhecido', async () => {
    const source = {
      'components/Link.vue': '<template functional><a :href="props.href"><slot/></a></template><script>export default {props:["href"]}</script>',
      'components/Example.vue': '<template><Link href="#">Fictício</Link></template><script>import Link from "@/components/Link.vue"; import {mapGetters} from "~/vuex"; export default {components:{Link},computed:{...mapGetters("preview",["isPreview"])}}</script>',
    };
    const output = await compileComponents(source, process.cwd()); expect(output.js).toContain('functional = true'); expect(output.js).toContain('_compiled = true');
    await expect(compileComponents({'components/Bad.vue': '<template><p/></template><script>import value from "@/modules/unknown";export default {value}</script>'}, process.cwd())).rejects.toThrow('não simulado');
  });
  test('compila componente Vue 2 interativo, sem CSS do Splide por padrão, e rejeita recursos não simulados', async () => {
    const output = await compileComponents(demoSnapshot.files, process.cwd()); expect(output.js).toContain('count++');
    expect(output.css).toMatch(/button\[data-v-[a-f0-9]+\]/); expect(output.css).not.toContain('.splide__track');
    expect((await compileComponents(demoSnapshot.files, process.cwd(), {splideCss: true})).css).toContain('.splide');
    await expect(compileComponents({'components/Bad.vue': '<template><p>oi</p></template><style module>p{color:red}</style>'}, process.cwd())).rejects.toThrow('module');
  });
  test('registra só os componentes de components.twig e avisa sobre os demais', () => {
    const files = {'elements/scripts/components.twig': "<script src='{{ '/components/A.js' | components_url }}'></script><script src='{{ '/components/Ausente.js' | components_url }}'></script><script src='{{ '/dist/vendor/x.js' | components_url }}'></script>", 'components/A.vue': '<template><p/></template>', 'components/deep/B.vue': '<template><p/></template>'};
    const result = registeredComponents(files);
    expect(result.components).toEqual(['components/A.vue']);
    expect(result.warnings.map(w => [w.code, w.resource])).toEqual([['component-not-listed', 'components/deep/B.vue'], ['component-file-missing', 'Ausente']]);
    expect(registeredComponents(files, {registerUnlisted: true}).components).toEqual(['components/A.vue', 'components/deep/B.vue']);
    expect(registeredComponents({'components/A.vue': ''}).components).toEqual(['components/A.vue']);
  });
  test('ZIP de retorno inclui só tema e origem e preserva edição e imagens', async () => {
    const root = await project(); await writeFile(path.join(root, 'tema/templates/home.twig'), '<h1>Editado</h1>\n');
    await writeFile(path.join(root, 'segredo.env'), 'ficticio-nao-exportar');
    const bytes = await packProject(root), entries = unzipSync(bytes), result = await decodeProject(bytes);
    expect(Object.keys(entries).every(p => p.startsWith('tema/') || p.startsWith('.yampi-sync/baseline/') || p === '.yampi-sync/manifest.json')).toBe(true);
    expect(result.local['templates/home.twig']).toBe('<h1>Editado</h1>\n'); expect(result.baseline).toEqual(demoSnapshot);
  });
  test('pack aponta arquivo modificado que inclui arquivo novo', async () => {
    const root = await project();
    await mkdir(path.join(root, 'tema/sections/home'), {recursive: true});
    await writeFile(path.join(root, 'tema/sections/home/novo.twig'), '<p>Novo</p>\n');
    await writeFile(path.join(root, 'tema/templates/home.twig'), '<main>{% include "sections/home/novo.twig" %}</main>\n');
    const summary = await returnSummary(root);
    expect(summary.modified).toEqual(['templates/home.twig']); expect(summary.added).toEqual(['sections/home/novo.twig']);
    expect(summary.blocked).toEqual([{path: 'templates/home.twig', dependencies: [{path: 'sections/home/novo.twig', via: 'twig'}]}]);
  });
  test('pack recusa original adulterado e links para fora do projeto', async () => {
    const root = await project(); await writeFile(path.join(root, '.yampi-sync/baseline/templates/home.twig'), strToU8('adulterado'));
    await expect(readProject(root)).rejects.toThrow('Original');
    const linked = await project(), outside = await temporary();
    await writeFile(path.join(outside, 'privado-ficticio.twig'), 'Este conteúdo não deve ser exportado.');
    await symlink(outside, path.join(linked, 'tema/templates/linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(packProject(linked)).rejects.toThrow('Links');
  });
  test('integridade: --original, adicionados separados e ZIP de retorno conferido', async () => {
    const root = await project();
    expect(await checkIntegrity(root, {original: true})).toMatchObject({modified: 0, added: 0, returnZip: {status: 'absent'}, previewFormat: 2});
    await writeFile(path.join(root, 'tema/templates/home.twig'), '<h1>Editado</h1>\n'); await writeFile(path.join(root, 'tema/templates/novo.twig'), '<p>Novo</p>\n');
    await expect(checkIntegrity(root, {original: true})).rejects.toThrow('1 modificados, 1 adicionados');
    await writeFile(path.join(root, 'retorno-yampi.zip'), await packProject(root));
    expect(await checkIntegrity(root, {returnZip: 'retorno-yampi.zip'})).toMatchObject({modified: 1, added: 1, addedFiles: ['templates/novo.twig'], returnZip: {status: 'matches'}});
    const entries = unzipSync(await readFile(path.join(root, 'retorno-yampi.zip'))); entries['tema/extra.txt'] = strToU8('x'); entries['tema/templates/home.twig'] = strToU8('outro');
    await writeFile(path.join(root, 'retorno-yampi.zip'), zipSync(entries));
    await expect(checkIntegrity(root, {returnZip: 'retorno-yampi.zip'})).rejects.toThrow(/entrada extra tema\/extra\.txt.*conteúdo diferente tema\/templates\/home\.twig|conteúdo diferente tema\/templates\/home\.twig.*entrada extra/);
    expect((await checkIntegrity(root)).returnZip.status).toBe('stale');
  });
  test('servidor bloqueia escrita, host externo e acesso à baseline', async () => {
    const root = await project();
    const local = await createLocalServer(root); servers.push(local.server);
    await new Promise(resolve => local.server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + local.server.address().port;
    expect((await fetch(base, {method: 'POST'})).status).toBe(403);
    const forbidden = await new Promise(resolve => http.get(base, {headers: {Host: 'outro.invalid'}}, response => {response.resume(); resolve(response.statusCode);}).on('error', () => resolve(0)));
    expect(forbidden).toBe(403);
    expect((await fetch(base + '/.yampi-sync/manifest.json')).status).toBe(404);
    const image = await fetch(base + '/tema/assets/images/example.png'); expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('content-security-policy')).toContain('sandbox');
  });
  test('exportação demonstrativa passa no check só com os templates existentes', async () => {
    const root = await project();
    await symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const manifest = JSON.parse(await readFile(path.join(root, 'preview/manifest.json')));
    expect(manifest.pages.map(p => p.kind)).toEqual(['home']);
    const report = await validateLocal(root);
    expect(report.pages.map(p => [p.kind, p.expectedSections])).toEqual([['home', null], ['long', null]]);
  }, 60000);
  test('check não anuncia sucesso se o template não pode ser renderizado', async () => {
    const root = await project();
    await writeFile(path.join(root, 'tema/templates/home.twig'), '{% invalid_tag %}');
    // Missing installed project dependencies also must fail, never a fake validation success.
    await expect(validateLocal(root)).rejects.toThrow();
  });
});
