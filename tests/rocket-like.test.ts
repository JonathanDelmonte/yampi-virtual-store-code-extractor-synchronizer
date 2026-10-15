import {describe, test, expect, afterEach} from 'vitest';
import {mkdtemp, mkdir, writeFile, rm, symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {unzipSync} from 'fflate';
import {installDomParser} from './fixtures/dom';
import {rocketLike, platformMinify, FONTS, IMG, ASSETS, type RocketOptions} from './fixtures/rocket-like';
import {preparePreview, finishPreview} from '../src/browser/preview-capture';
import {encodeSnapshot} from '../src/core/archive';
import {underlyingImage} from '../local-runtime/contract.mjs';
// @ts-expect-error Embedded runtime is native JavaScript, exercised here at runtime.
import {compileStyles} from '../local-runtime/engine.mjs';
// @ts-expect-error Embedded runtime is native JavaScript, exercised here at runtime.
import {validateLocal, loadLocal, renderRoute, createLocalServer} from '../local-runtime/dev.mjs';
const folders: string[] = [], servers: http.Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise(resolve => server.close(resolve));
  for (const folder of folders.splice(0)) {
    if (!path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep + 'yampi-ficticio-')) throw new Error('Destino de limpeza inválido.');
    await rm(folder, {recursive: true, force: true});
  }
});
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
async function exportFixture(options: RocketOptions = {}) {
  const fixture = rocketLike(options);
  const served = Object.fromEntries(Object.entries(fixture.themeSheets).map(([url, entries]) => [url, {type: 'text/css', text: entries.length ? platformMinify(compileStyles(fixture.snapshot.files, entries, {style: 'compressed', assets: ASSETS})) : ''}]));
  const resources: Record<string, {text?: string; base64?: string; type: string}> = {...fixture.resources, ...served}, requested: string[] = [];
  const fetcher = async (url: string) => {
    requested.push(url);
    const resource = resources[url];
    if (!resource) throw new Error('Recurso fictício ausente: ' + url);
    return {url, type: resource.type, bytes: resource.base64 ? Uint8Array.from(atob(resource.base64), c => c.charCodeAt(0)) : new TextEncoder().encode(resource.text)};
  };
  const restore = installDomParser();
  try {
    const draft = await preparePreview(fixture.snapshot, fetcher);
    const bundle = await finishPreview(draft, fetcher, fixture.origins);
    const zip = await encodeSnapshot(fixture.snapshot, true, bundle);
    const root = await mkdtemp(path.join(os.tmpdir(), 'yampi-ficticio-')); folders.push(root);
    const entries = unzipSync(zip);
    for (const [name, bytes] of Object.entries(entries)) {await mkdir(path.dirname(path.join(root, name)), {recursive: true}); await writeFile(path.join(root, name), bytes);}
    // Dependencies come from this repository; the tools are byte-identical copies.
    await symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    return {fixture, bundle, entries, root, requested};
  } finally {restore();}
}
describe('exportação nova no formato real da vitrine', () => {
  test('npm run check passa sem edição manual e cada página renderiza todas as seções visíveis', async () => {
    const {bundle, root, entries} = await exportFixture();
    expect(bundle.pages.map(p => p.kind + (p.context === 'search' ? ':search' : ''))).toEqual(expect.arrayContaining(['home', 'category', 'product', 'pages', 'promotion', 'category:search']));
    const report = await validateLocal(root);
    for (const page of report.pages.filter((p: {captured: boolean}) => p.captured)) expect(page.renderedSections, page.kind + ' ' + page.capture).toBe(page.expectedSections);
    const home = report.pages.find((p: {kind: string}) => p.kind === 'home');
    expect(home.expectedSections).toBe(3);
    expect(report.cssParity.association).toBe('published-verified-by-css');
    expect(report.components.map((w: {resource: string}) => w.resource)).toContain('components/UnlistedWidget.vue');
    const product = report.pages.find((p: {kind: string}) => p.kind === 'product');
    expect(product.warnings.some((w: {code: string; files: string[]}) => w.code === 'markup-fixed-by-browser' && w.files.join().includes('sections/product/product_similars.twig'))).toBe(true);
    const contract = JSON.parse(decode(entries['preview/report.json'])).contract;
    expect(contract.templates.every((t: {captures: string[]}) => t.captures.length > 0)).toBe(true);
    expect(contract.keys.section.missing).toContainEqual({key: 'texto_opcional', reason: 'not-provided-by-storefront'});
    expect(contract.keys.merchant.missing).toEqual([]);
    expect(contract.pages.every((p: {unresolved: unknown[]}) => !p.unresolved.length)).toBe(true);
  }, 60000);
  test('seção principal usa data.config, aliases main_* resolvem e sections.1 corresponde ao banner', async () => {
    const {root, bundle} = await exportFixture(), local = await loadLocal(root);
    const category = bundle.pages.find(p => p.kind === 'category' && !p.context)!, search = bundle.pages.find(p => p.context === 'search')!;
    expect(renderRoute(local, 'category', category.id).html).toContain(':products-per-page="12"');
    expect(renderRoute(local, 'category', search.id).html).toContain(':products-per-page="24"');
    const home = renderRoute(local, 'home');
    expect(home.html).toMatch(/class="main_banner main_banner-1"[\s\S]*class="text_button text_button-2"[\s\S]*class="collection collection-3"/);
    expect(home.html).not.toContain('Coleção oculta');
    expect(home.html).toContain('<p class="optional"></p>');
    const product = renderRoute(local, 'product', bundle.pages.find(p => p.kind === 'product')!.id);
    expect(product.state.renderedSections).toBe(2);
    expect(renderRoute(local, 'pages').html).toContain('Texto fictício institucional.');
  }, 60000);
  test('privacidade: lista de bloqueio, company preservada e nenhum segredo no pacote', async () => {
    const {entries} = await exportFixture();
    const preview = Object.entries(entries).filter(([name]) => name.startsWith('preview/') && /\.json$/.test(name)).map(([, bytes]) => decode(bytes)).join('\n');
    for (const secret of ['FAKE-SECRET-KEY-0001', 'FAKE-CHECKOUT-TOKEN', 'FAKE-SESSION-ID', 'FAKE-TOKEN', 'PX-FICTICIO', 'contato@ficticia.invalid', '123.456.789-09', 'Rua Fictícia']) expect(preview).not.toContain(secret);
    const home = JSON.parse(decode(entries['preview/raw/page-0.json']));
    expect(home.merchant.company).toMatchObject({person_type: 'person', cpf: 'redacted', email: 'redacted', phone: {number: 'redacted'}, social: {instagram: 'https://instagram.invalid/ficticia'}});
    expect(Object.keys(home.themeConfig.theme.params)).toEqual(expect.arrayContaining(['grids_card_style', 'buttons_style', 'empty_cart_title', 'border_apply_on_images']));
    expect(home.themeConfig.theme.params.checkout_api_key).toBeUndefined();
    expect(home.themeConfig.sections.find((s: {section_alias: string}) => s.section_alias === 'main_banner')).toMatchObject({order: 1, params: {resource: {first_banner: {image: `${IMG}/banners/hero-large.jpg`, mobile_image: `${IMG}/banners/hero-mobile-large.jpg`}}}});
    expect(home.merchant).toMatchObject({cookies_policy: {active: true}, checkout: {skip_cart: false}, meta: {title: 'Loja Fictícia'}});
    expect(home.merchant.session_id).toBeUndefined();
    expect(JSON.stringify(JSON.parse(decode(entries['preview/raw/api.json'])))).not.toContain('session_token');
  }, 60000);
  test('captura sem URLs de Sass, só fontes latin, ícones de $assets e uma variante por imagem', async () => {
    const {bundle, requested, entries} = await exportFixture();
    expect(requested.some(url => /\.scss|\/functions$|_index/.test(url))).toBe(false);
    expect(requested).not.toContain(`${FONTS}/s/fictional-cyrillic.woff2`);
    expect(requested).toContain(`${FONTS}/s/fictional-latin.woff2`);
    expect(bundle.platform.assetsBase).toBe(ASSETS);
    expect(bundle.resources.find(r => r.url === `${ASSETS}/img/themes/vitrine/icons/cart.svg`)?.category).toBe('icon');
    expect(bundle.platform.fontSheets).toEqual([{url: `${FONTS}/css2?family=Fictional+Sans`, families: ['Fictional Sans']}]);
    const fontSheet = decode(bundle.assets[bundle.resources.find(r => r.category === 'font-css')!.path]);
    expect(fontSheet).not.toContain('cyrillic'); expect(fontSheet).not.toContain('placeholder'); expect(fontSheet).toContain('/preview/assets/');
    const images = bundle.resources.filter(r => r.category === 'image').map(r => underlyingImage(r.url));
    expect(new Set(images).size).toBe(images.length);
    expect(bundle.aliases[`${IMG}/banners/hero-large.jpg`]).toContain('/fit-in/1200x400/');
    expect(requested).not.toContain(`${IMG}/banners/hero-large.jpg`);
    expect(bundle.api.map(r => r.path).sort()).toEqual(['catalog/banners', 'catalog/collections']);
    expect(requested.filter(url => url.includes('id%5B%5D=22'))).toEqual([]);
    expect(bundle.platform.themeSheets.map(s => s.group)).toEqual(expect.arrayContaining(['styles', 'pageStyles', 'mobilePageStyles', 'mobileStyles']));
    const report = JSON.parse(decode(entries['preview/report.json']));
    expect(Object.keys(report.assets.byCategory)).toEqual(expect.arrayContaining(['font', 'icon', 'image', 'theme-css', 'font-css']));
    expect(Object.values(entries).reduce((sum, bytes) => sum + bytes.length, 0)).toBeLessThan(3 * 1024 * 1024);
  }, 60000);
  test('sobreposições por página não vazam para outras rotas', async () => {
    const {root, bundle} = await exportFixture();
    await writeFile(path.join(root, 'local.data.json'), JSON.stringify({format: 'yampi-local-overrides', version: 1, global: {theme: {params: {custom_css: '.global-override{color:red}'}}}, pages: {home: {sections: {main_banner: {params: {slider_delay: 9}}}}}}));
    const local = await loadLocal(root), category = bundle.pages.find(p => p.kind === 'category' && !p.context)!;
    expect(renderRoute(local, 'home').html).toContain(':delay="9"');
    const categoryHtml = renderRoute(local, 'category', category.id);
    expect(categoryHtml.state.expectedSections).toBe(1); expect(categoryHtml.html).not.toContain('main_banner');
    expect(categoryHtml.html).toContain('.global-override{color:red}');
  }, 60000);
  test('servidor: rotas da loja, classes do body, ordem do CSS mobile e ícones da plataforma', async () => {
    const {root} = await exportFixture();
    const local = await createLocalServer(root); servers.push(local.server);
    await new Promise<void>(resolve => local.server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + (local.server.address() as {port: number}).port;
    const category = await (await fetch(base + '/categoria-a')).text();
    expect(category).toContain('<body class="ficticia category');
    expect(category).toContain('Categoria A');
    expect(await (await fetch(base + '/')).text()).toContain('main_banner-1');
    expect(await (await fetch(base + '/__local/')).text()).toContain('Páginas capturadas');
    const page = await (await fetch(base + '/preview?page=home')).text();
    const order = ['/__local/css/global.css', '/__local/css/themes/vitrine-home.css', '/__local/css/themes/vitrine-home-mobile.css', '/__local/css/themes/vitrine-mobile.css'].map(href => page.indexOf(href));
    expect(order.every((position, i) => position > 0 && (i === 0 || position > order[i - 1]))).toBe(true);
    expect(page).toContain('media="screen and (max-width: 700px)"');
    expect(page).toMatch(/href="\/preview\/assets\/[a-f0-9]{64}\.css"[^>]*rel="stylesheet"/);
    const combined = await (await fetch(base + '/__local/style.css?page=home')).text();
    expect(combined.indexOf('#111')).toBeLessThan(combined.indexOf('#222'));
    const icon = await fetch(base + '/__platform/assets/img/themes/vitrine/icons/cart.svg');
    expect(icon.status).toBe(200); expect(icon.headers.get('content-type')).toBe('image/svg+xml');
    const missing = await fetch(base + '/rota-inexistente');
    expect(missing.status).toBe(404); expect(await missing.text()).toContain('Rota não capturada');
  }, 60000);
  test('fixture negativo: company ausente, alias sem arquivo e diagnósticos explícitos', async () => {
    const withoutCompany = await exportFixture({company: false});
    await expect(validateLocal(withoutCompany.root)).rejects.toThrow(/footer\.twig/);
    expect(JSON.parse(decode(withoutCompany.entries['preview/report.json'])).contract.keys.merchant.missing).toContainEqual({key: 'company', reason: 'not-provided-by-storefront'});
    const unresolved = await exportFixture({missingAlias: true});
    const report = JSON.parse(decode(unresolved.entries['preview/report.json']));
    expect(report.contract.pages[0].unresolved.map((u: {alias: string}) => u.alias)).toEqual(['secao_inexistente']);
    await expect(validateLocal(unresolved.root)).rejects.toThrow('Seção sem arquivo: alias "secao_inexistente" na página "home"');
  }, 60000);
});
