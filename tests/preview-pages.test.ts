import {describe, test, expect, vi, afterEach} from 'vitest';
import {mkdtemp, mkdir, writeFile, readFile, rm, utimes} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {unzipSync} from 'fflate';
import {dataRoutes, routeKey, sendRoutes, storeRoute, themeRoutes} from '../src/core/preview-links';
import {Pacer, pool} from '../src/core/pacer';
import {demonstration, previewEntries, kindsText} from '../src/core/preview';
import {encodeSnapshot} from '../src/core/archive';
import {fetchFailure, fetchPublicResource, REDIRECTED} from '../src/browser/public-fetch';
import {demoSnapshot} from '../src/demo/sample';
// @ts-expect-error Embedded runtime is native JavaScript, exercised here at runtime.
import {loadPreview, routeFor} from '../local-runtime/preview.mjs';
// @ts-expect-error Embedded runtime is native JavaScript, exercised here at runtime.
import {readProject} from '../local-runtime/engine.mjs';
const STORE = 'https://loja-ficticia.invalid';
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) {
    if (!path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep + 'yampi-ficticio-')) throw new Error('Destino de limpeza inválido.');
    await rm(folder, {recursive: true, force: true});
  }
});
describe('links da própria loja', () => {
  test('caminhos de slug da mesma origem; nada de home, arquivo, carrinho, segredo ou outra loja', () => {
    expect(storeRoute('/categoria-a?sort_by=best_sellers', STORE)).toEqual({url: STORE + '/categoria-a?sort_by=best_sellers', key: '/categoria-a', product: false});
    expect(storeRoute(STORE + '/jogo-x/p', STORE)).toMatchObject({key: '/jogo-x/p', product: true});
    expect(storeRoute('/busca?q=%20Oferta%20&sort_by=x', STORE)?.key).toBe('/busca?q=Oferta');
    for (const value of ['/', '//outra.invalid/x', 'https://outra.invalid/categoria', '/assets/a.png', '/carrinho', '/checkout/x', '/categoria?token=x', '/busca?q=', 'javascript:alert(1)', 'categoria-relativa', 42]) expect(storeRoute(value, STORE), String(value)).toBeUndefined();
    expect(routeKey(new URL(STORE + '/a/b?page=2&sort_by=x'))).toBe('/a/b');
  });
  test('dados: onde está o link, sem posições de lista; tema: o arquivo, e slug só como palpite', () => {
    const found = dataRoutes({categories: [{url_path: '/c1', children: {data: [{url_path: STORE + '/c1/s1'}]}}], pages: [{path: '/atendimento/trocas'}], promotion: [{url: '/promo'}], banners: [{link: '/busca?q=x'}, {link: 'https://cdn.invalid/b.jpg'}]}, STORE, 'merchant');
    expect([...found.values()].map(route => [route.key, route.sources])).toEqual([['/c1', ['merchant.categories']], ['/c1/s1', ['merchant.categories.children']], ['/atendimento/trocas', ['merchant.pages']], ['/promo', ['merchant.promotion']], ['/busca?q=x', ['merchant.banners']]]);
    const theme = themeRoutes({'elements/atalhos.twig': `<a href="/colecao-encerrada">x</a><a href="{{ x.url_path }}">y</a><a href="/busca?q=jardim">z</a>`, 'components/A.vue': `const links = [{'href': '/categoria-b'}]; const plus = {'slug': 'jogo-plus'}; const fixed = '/jogo-fixo/p';`, 'assets/a.scss': 'a{content:"href=\'/nao\'"}'}, STORE);
    expect([...theme.values()].map(route => [route.key, route.sources, !!route.inferred])).toEqual([['/colecao-encerrada', ['elements/atalhos.twig'], false], ['/busca?q=jardim', ['elements/atalhos.twig'], false], ['/categoria-b', ['components/A.vue'], false], ['/jogo-fixo/p', ['components/A.vue'], false], ['/jogo-plus/p', ['components/A.vue'], true]]);
    // The send checks only literal links of the texts it takes, never slug guesses.
    expect(sendRoutes({'a.twig': '<a href="/x">', 'b.twig': '<a href="/y">', 'c.vue': "{'slug': 'z'}"}, ['a.twig', 'c.vue'], STORE).map(route => route.key)).toEqual(['/x']);
    expect(kindsText({category: 2, search: 1, pages: 1, promotion: 0})).toBe('2 categorias ou vitrines, 1 busca, 1 institucional');
  });
});
describe('leitura pública que pede calma', () => {
  test('429 e 503 levam o Retry-After na mensagem; redirecionamento não é seguido nem confundido com rede', async () => {
    const answer = (status: number, headers: Record<string, string> = {}) => vi.fn(async () => new Response('x', {status, headers}));
    await expect(fetchPublicResource(STORE + '/a', [STORE], answer(429, {'retry-after': '7'}) as never)).rejects.toThrow('HTTP 429; aguardar 7 s');
    await expect(fetchPublicResource(STORE + '/a', [STORE], answer(503, {'retry-after': new Date(Date.now() + 3000).toUTCString()}) as never)).rejects.toThrow(/HTTP 503; aguardar [1-4] s/);
    await expect(fetchPublicResource(STORE + '/a', [STORE], answer(404) as never)).rejects.toThrow('HTTP 404.');
    const redirect = vi.fn(async () => {const response = new Response(null, {status: 302}); Object.defineProperty(response, 'type', {value: 'opaqueredirect'}); return response;});
    await expect(fetchPublicResource(STORE + '/a', [STORE], redirect as never)).rejects.toThrow(REDIRECTED);
    expect(fetchFailure('Recurso público indisponível: HTTP 429; aguardar 7 s.')).toEqual({status: 429, retryAfter: 7});
    expect(fetchFailure(REDIRECTED)).toEqual({redirected: true});
    expect(fetchFailure('Failed to fetch')).toEqual({});
  });
  test('as leituras esperam juntas, saem mais espaçadas e voltam ao ritmo aos poucos', async () => {
    let clock = 0; const waits: number[] = [];
    const pacer = new Pacer(async ms => {waits.push(ms); clock += ms;}, () => clock);
    await pacer.turn(); expect(waits).toEqual([]);
    pacer.calm(25);
    await pacer.turn(); expect(waits).toEqual([10000, 10000, 5000]);
    await pacer.turn(); expect(waits.at(-1)).toBe(250);
    for (let i = 0; i < 20; i++) pacer.ok();
    // The slot already given keeps its gap; the next ones leave at once.
    await pacer.turn(); waits.length = 0; await pacer.turn(); await pacer.turn(); expect(waits).toEqual([]);
    const aborted = new AbortController(); aborted.abort();
    const stopped = new Pacer(async () => {}, () => 0, aborted.signal); stopped.calm(1);
    await expect(stopped.turn()).rejects.toThrow('cancelada');
    expect(await pool([3, 1, 2], async n => n * 2, 2)).toEqual([6, 2, 4]);
  });
});
describe('formato 3 da prévia', () => {
  const page = (id: number, stage?: 'store' | 'product') => ({id: 'page-' + id, kind: stage === 'product' ? 'product' as const : 'category' as const, sourceUrl: demoSnapshot.context.previewOrigin + '/c' + id, ...(stage ? {stage} : {}), raw: {themeConfig: {page: 'category', sections: []}, merchant: {alias: 'ficticia', manifest: {name: 'x'}}, data: {content: {data: {name: 'Página ' + id}}}}});
  test('cada etapa tem o seu limite; themeConfig e merchant repetidos vão uma vez para raw/shared', async () => {
    const bundle = demonstration(demoSnapshot.context, 'Teste', Object.keys(demoSnapshot.files));
    bundle.pages = [page(0), page(1, 'store'), page(2, 'store'), page(3, 'product')];
    const entries = await previewEntries(bundle, demoSnapshot.files), manifest = JSON.parse(new TextDecoder().decode(entries['preview/manifest.json']));
    expect(manifest.version).toBe(3); expect(manifest.shared).toHaveLength(2);
    expect(manifest.pages.map((item: {stage?: string; shared?: object}) => [item.stage ?? null, Object.keys(item.shared || {}).sort()])).toEqual([[null, ['merchant', 'themeConfig']], ['store', ['merchant', 'themeConfig']], ['store', ['merchant', 'themeConfig']], ['product', ['merchant', 'themeConfig']]]);
    expect(Object.keys(JSON.parse(new TextDecoder().decode(entries['preview/raw/page-2.json'])))).toEqual(['data']);
    bundle.limits = {...bundle.limits, productPages: 1}; bundle.pages.push(page(4, 'product'));
    await expect(previewEntries(bundle)).rejects.toThrow('limites');
    bundle.limits.productPages = 400; bundle.pages.push({...page(5), stage: 'outra' as never});
    await expect(previewEntries(bundle)).rejects.toThrow('limites');
  });
  test('o runtime local monta as páginas, recusa um compartilhado alterado e confere de novo um arquivo editado', async () => {
    const bundle = demonstration(demoSnapshot.context, 'Teste', Object.keys(demoSnapshot.files));
    bundle.source = {kind: 'published', origin: demoSnapshot.context.previewOrigin, association: 'published-unverified'};
    bundle.pages = [{...page(0), kind: 'home', sourceUrl: demoSnapshot.context.previewOrigin + '/'}, page(1, 'store'), {...page(2, 'store'), sourceUrl: demoSnapshot.context.previewOrigin + '/busca?q=Oferta', context: 'search'}, {...page(3, 'product'), sourceUrl: demoSnapshot.context.previewOrigin + '/jogo/p'}];
    const root = await mkdtemp(path.join(os.tmpdir(), 'yampi-ficticio-')); folders.push(root);
    for (const [name, bytes] of Object.entries(unzipSync(await encodeSnapshot(demoSnapshot, true, bundle)))) {await mkdir(path.dirname(path.join(root, name)), {recursive: true}); await writeFile(path.join(root, name), bytes);}
    const project = await readProject(root), preview = await loadPreview(root, project);
    expect(preview.pages.map((item: {stage?: string; raw: {merchant: {alias: string}}}) => [item.stage ?? null, item.raw.merchant.alias])).toEqual([[null, 'ficticia'], ['store', 'ficticia'], ['store', 'ficticia'], ['product', 'ficticia']]);
    expect(Object.isFrozen(preview.pages[1].raw.merchant)).toBe(true);
    const at = (target: string) => routeFor(preview, new URL(demoSnapshot.context.previewOrigin + target))?.id;
    expect([at('/c1'), at('/c1?sort_by=lowest_price&page=3'), at('/busca?q=Oferta'), at('/busca?q=Oferta&sort_by=x'), at('/busca?q=outra'), at('/busca'), at('/jogo/p'), at('/jogo/p?variante=2'), at('/'), at('/?utm=x'), at('/nada')]).toEqual(['page-1', 'page-1', 'page-2', 'page-2', undefined, undefined, 'page-3', 'page-3', 'page-0', undefined, undefined]);
    const manifest = JSON.parse(await readFile(path.join(root, 'preview/manifest.json'), 'utf8'));
    const shared = path.join(root, 'preview', manifest.shared[0].file);
    const original = await readFile(shared);
    await writeFile(shared, '{"alterado":true}\n');
    await expect(loadPreview(root, project)).rejects.toThrow('alterados');
    await writeFile(shared, original);
    await expect(loadPreview(root, project)).resolves.toBeDefined();
    // Same size, same content check again after a change of time: an edit by hand is never served from memory.
    const own = path.join(root, 'preview/raw/page-1.json'), text = await readFile(own, 'utf8');
    await writeFile(own, text.replace('Página 1', 'Página 9')); await utimes(own, new Date(), new Date(Date.now() + 5000));
    await expect(loadPreview(root, project)).rejects.toThrow('alterados');
  });
});
