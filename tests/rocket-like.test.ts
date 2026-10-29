import {describe, test, expect, afterEach} from 'vitest';
import {mkdtemp, mkdir, writeFile, rm, symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {unzipSync} from 'fflate';
import {installDomParser} from './fixtures/dom';
import {rocketLike, platformMinify, fixtureFetch, FONTS, IMG, ASSETS, STORE, more, type RocketOptions, type FixtureResource} from './fixtures/rocket-like';
import type {PreviewLimits} from '../src/core/preview';
import {preparePreview, finishPreview} from '../src/browser/preview-capture';
import {expandPreview} from '../src/browser/preview-pages';
import {fetchPublicResource} from '../src/browser/public-fetch';
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
// A captured page as the local tools read it: its own file plus the shared themeConfig/merchant.
function rawPage(entries: Record<string, Uint8Array>, id: string) {
  const manifest = JSON.parse(decode(entries['preview/manifest.json'])), page = manifest.pages.find((item: {id: string}) => item.id === id);
  const own = JSON.parse(decode(entries['preview/' + page.file]));
  for (const [key, sha] of Object.entries(page.shared || {})) own[key] = JSON.parse(decode(entries[`preview/raw/shared/${sha}.json`]));
  return own;
}
async function exportFixture(options: RocketOptions = {}, extra: {limits?: Partial<PreviewLimits>; tweak?: (resources: Record<string, FixtureResource>) => void} = {}) {
  const fixture = rocketLike(options);
  const served = Object.fromEntries(Object.entries(fixture.themeSheets).map(([url, entries]) => [url, {type: 'text/css', text: entries.length ? platformMinify(compileStyles(fixture.snapshot.files, entries, {style: 'compressed', assets: ASSETS})) : ''}]));
  const resources: Record<string, FixtureResource> = {...fixture.resources, ...served}, requested: string[] = [];
  extra.tweak?.(resources);
  const network = fixtureFetch(resources, requested);
  // The same download the extension's worker makes, on top of the fictional storefront.
  const fetcher = async (url: string) => {const result = await fetchPublicResource(url, fixture.origins, network); return {url: result.url, type: result.type, bytes: Uint8Array.from(atob(result.encoded), c => c.charCodeAt(0))};};
  // Waiting is counted, not slept: 429 answers say how long.
  const waits: number[] = [], progress: string[] = []; let clock = 0;
  const restore = installDomParser();
  try {
    const draft = await preparePreview(fixture.snapshot, fetcher, extra.limits ? {limits: extra.limits} : {});
    const bundle = await expandPreview(await finishPreview(draft, fetcher, fixture.origins), fixture.snapshot.files, fetcher, {wait: async ms => {waits.push(ms); clock += ms;}, now: () => clock, onProgress: (stage, done, total) => progress.push(`${stage} ${done}/${total}`)});
    const zip = await encodeSnapshot(fixture.snapshot, true, bundle);
    const root = await mkdtemp(path.join(os.tmpdir(), 'yampi-ficticio-')); folders.push(root);
    const entries = unzipSync(zip);
    for (const [name, bytes] of Object.entries(entries)) {await mkdir(path.dirname(path.join(root, name)), {recursive: true}); await writeFile(path.join(root, name), bytes);}
    // Dependencies come from this repository; the tools are byte-identical copies.
    await symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    return {fixture, bundle, entries, root, requested, waits, progress};
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
    const home = rawPage(entries, 'page-0');
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
describe('páginas da loja e dos produtos depois do recorte', () => {
  const route = (url: string) => {const parsed = new URL(url); return parsed.pathname + parsed.search;};
  test('categorias, subcategorias, vitrines, rodapé, promoção, busca do tema e cada produto entram na exportação', async () => {
    const {bundle, entries, waits, progress} = await exportFixture();
    const staged = (stage: string) => bundle.pages.filter(page => page.stage === stage).map(page => route(page.sourceUrl));
    expect(bundle.pages.filter(page => !page.stage).length).toBeLessThanOrEqual(8);
    expect(staged('store')).toEqual(expect.arrayContaining(['/categoria-c?sort_by=best_sellers', '/categoria-c/sub-c1?sort_by=best_sellers', '/categoria-c/sub-c2', '/categoria-d', '/destaques/l', '/busca?q=oferta', '/promocoes/semana', '/atendimento/trocas', '/atendimento/privacidade', '/categoria-oculta?sort_by=best_sellers']));
    expect(bundle.pages.map(page => route(page.sourceUrl))).toEqual(expect.arrayContaining(['/', '/categoria-a', '/categoria-b', '/sobre', '/promocao']));
    // Every product any captured page shows has its own page: those of the cut plus the stage's.
    const productRoutes = new Set(bundle.pages.filter(page => page.kind === 'product').map(page => route(page.sourceUrl)));
    for (const id of [1, 2, 3, ...Object.values(more).map(item => item.id)]) expect(productRoutes, 'produto ' + id).toContain(`/produto-ficticio-${id}/p`);
    // A similar product only another product page shows comes in the second product round; the one only it shows stays out, said so.
    expect(productRoutes).toContain('/produto-ficticio-13/p'); expect(productRoutes).not.toContain('/produto-ficticio-14/p');
    expect(bundle.issues.find(issue => issue.code === 'product-page-rounds')?.reason).toBe('1 caminho só apareceu nas páginas da última rodada (2 rodadas) e ficou de fora (ex.: /produto-ficticio-14/p).');
    expect(bundle.issues.map(issue => issue.code)).not.toContain('product-page-limit'); expect(bundle.stages!.product!.left).toBe(1);
    expect(bundle.pages.find(page => route(page.sourceUrl) === '/busca?q=oferta')).toMatchObject({kind: 'category', context: 'search', stage: 'store'});
    expect(bundle.pages.find(page => route(page.sourceUrl) === '/promocoes/semana')).toMatchObject({kind: 'promotion', stage: 'store'});
    // The category only a product links to comes in the last round, after the products.
    expect(staged('store').at(-1)).toBe('/categoria-oculta?sort_by=best_sellers');
    // A 404 is a broken link, with where it is written; a redirect elsewhere is only left out.
    expect(bundle.issues.filter(issue => issue.code === 'link-broken')).toEqual([{code: 'link-broken', resource: '/categoria-removida', reason: expect.stringContaining('sections/global/footer.twig')}, {code: 'link-broken', resource: '/produto-removido/p', reason: expect.stringContaining('sections/global/footer.twig')}]);
    expect(bundle.stages!.product!.skipped).toEqual([{route: '/produto-removido/p', reason: 'HTTP 404: link quebrado', sources: ['sections/global/footer.twig']}]);
    expect(bundle.issues.some(issue => issue.code === 'page-unavailable' && issue.resource === STORE + '/atendimento/parceiro' && /redirecionado/.test(issue.reason))).toBe(true);
    expect(bundle.stages!.store!.skipped).toEqual(expect.arrayContaining([{route: '/categoria-removida', reason: 'HTTP 404: link quebrado', sources: ['sections/global/footer.twig']}, {route: '/atendimento/parceiro', reason: 'redirecionamento não seguido', sources: ['merchant.pages']}]));
    // Category D answered 429 twice: every read waited the Retry-After before trying again.
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(2000);
    expect(bundle.issues.some(issue => issue.resource?.includes('categoria-d'))).toBe(false);
    expect(progress.some(line => /^store \d+\/\d+$/.test(line))).toBe(true); expect(progress.at(-1)).toMatch(/^store /);
    expect(progress.filter(line => line.startsWith('product ')).at(-1)).toBe(`product ${bundle.stages!.product!.found}/${bundle.stages!.product!.found}`);
    expect(bundle.issues.map(issue => issue.code)).not.toContain('page-limit');
    expect(bundle.issues.filter(issue => issue.code === 'page-kind-missing')).toEqual([]);
    expect(bundle.stages!.store!.byKind).toMatchObject({category: 6, search: 1, promotion: 1, pages: 2});
    // Stored once: themeConfig and merchant shared by many pages, each page file only with its own data.
    const manifest = JSON.parse(decode(entries['preview/manifest.json']));
    expect(manifest.version).toBe(3); expect(manifest.shared.length).toBeGreaterThan(0);
    const product = manifest.pages.find((page: {sourceUrl: string}) => page.sourceUrl === STORE + '/produto-ficticio-7/p');
    expect(product).toMatchObject({stage: 'product', shared: {themeConfig: expect.any(String), merchant: expect.any(String)}});
    expect(Object.keys(JSON.parse(decode(entries['preview/' + product.file]))).sort()).toEqual(['bodyClasses', 'data']);
    expect(rawPage(entries, product.id).data.product.data.name).toBe('Produto Fictício 7');
    const report = JSON.parse(decode(entries['preview/report.json']));
    expect(report.pages).toMatchObject({store: bundle.stages!.store!.captured, product: bundle.stages!.product!.captured, stages: {store: {skipped: expect.any(Array)}}});
  }, 60000);
  test('uma chave bloqueada dentro de window.data de categoria e de produto não chega ao ZIP', async () => {
    const {entries, bundle} = await exportFixture();
    expect(bundle.pages.some(page => route(page.sourceUrl).startsWith('/categoria-c?'))).toBe(true);
    expect(bundle.pages.some(page => route(page.sourceUrl) === '/produto-ficticio-4/p')).toBe(true);
    const preview = Object.entries(entries).filter(([name]) => name.startsWith('preview/') && /\.json$/.test(name)).map(([, bytes]) => decode(bytes)).join('\n');
    for (const secret of ['FAKE-CATEGORY-TOKEN', 'FAKE-PRODUCT-KEY', 'Cliente Fictício']) expect(preview).not.toContain(secret);
    expect(bundle.removedKeys).toEqual(expect.arrayContaining(['customer', 'session_token', 'api_key']));
  }, 60000);
  test('a prévia local abre cada página pelo caminho, com qualquer ordem; a busca, só pela pergunta', async () => {
    const {root} = await exportFixture();
    const report = await validateLocal(root);
    expect(report.pages.filter((page: {stage?: string}) => page.stage).every((page: {renderedSections: number; expectedSections: number}) => page.renderedSections === page.expectedSections)).toBe(true);
    const local = await createLocalServer(root); servers.push(local.server);
    await new Promise<void>(resolve => local.server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + (local.server.address() as {port: number}).port;
    const open = async (target: string) => {const response = await fetch(base + target); return {status: response.status, html: await response.text()};};
    for (const [target, text] of [['/categoria-c?sort_by=lowest_price', 'Categoria C'], ['/categoria-c/sub-c1?sort_by=best_sellers&page=2', 'Subcategoria C1'], ['/categoria-oculta?sort_by=best_sellers', 'Categoria Oculta'], ['/destaques/l', 'Destaques fictícios'], ['/atendimento/trocas', 'Trocas'], ['/promocoes/semana', 'Semana fictícia'], ['/busca?q=oferta', 'Busca'], ['/produto-ficticio-9/p', 'Produto Fictício 9']] as const) {
      const page = await open(target);
      expect(page.status, target).toBe(200); expect(page.html, target).toContain(text);
    }
    expect((await open('/produto-ficticio-5/p')).html).toContain('href="/categoria-oculta?sort_by=best_sellers"');
    const other = await open('/busca?q=outra');
    expect(other.status).toBe(404); expect(other.html).toContain('Rota não capturada');
    const index = await open('/__local/');
    expect(index.html).toMatch(/<strong>Produtos<\/strong>: 13/); expect(index.html).toMatch(/<strong>Buscas<\/strong>: 2/);
    expect((index.html.match(/<li>/g) || []).length).toBeLessThan(20);
  }, 60000);
  test('429 sem fim, 404 e redirecionamento viram aviso; o limite da etapa fica no relatório', async () => {
    // A store that never stops asking for calm: the page waits each time and only then is left out.
    const calm = await exportFixture({}, {tweak: resources => {resources[STORE + '/categoria-c/sub-c2'].throttle = 99;}});
    expect(calm.bundle.stages!.store!.skipped).toContainEqual(expect.objectContaining({route: '/categoria-c/sub-c2', reason: 'HTTP 429'}));
    expect(calm.bundle.issues.find(issue => issue.code === 'page-unavailable' && issue.resource === STORE + '/categoria-c/sub-c2')?.reason).toMatch(/HTTP 429/);
    // Five more answers of 429 with Retry-After: 1 (plus the two of category D), waited in full.
    expect(calm.waits.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(7000);
    expect(calm.bundle.pages.some(page => page.sourceUrl === STORE + '/produto-ficticio-7/p')).toBe(false);
    // The stage's own budget: what passes it is counted and named, and the export finishes.
    const limited = await exportFixture({}, {limits: {storePages: 4}});
    expect(limited.bundle.pages.filter(page => page.stage === 'store').length).toBe(4);
    expect(limited.bundle.issues.find(issue => issue.code === 'store-page-limit')?.reason).toMatch(/^Limite de 4 páginas da loja ou 24 MiB atingido; \d+ caminhos ficaram de fora/);
    // Past the budget is a limit, never a "last round" note.
    expect(limited.bundle.issues.map(issue => issue.code)).not.toContain('store-page-rounds');
    expect(limited.bundle.stages!.store!.left).toBeGreaterThan(0);
    expect(limited.bundle.pages.filter(page => !page.stage).length).toBe(calm.bundle.pages.filter(page => !page.stage).length);
    const zip = await encodeSnapshot(limited.fixture.snapshot, true, limited.bundle);
    expect(zip.length).toBeGreaterThan(0);
  }, 60000);
});
