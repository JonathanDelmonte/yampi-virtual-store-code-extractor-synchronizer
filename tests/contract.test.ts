import {describe, test, expect} from 'vitest';
import {resolveSectionFile, platformContext, expectedSections, applyOverrides, validateOverrides, emptyOverrides, mergePatch, legacyToRaw, referencedKeys, capturedKeys, componentList, themeSheet, underlyingImage, urlRewriter, type RawPage} from '../local-runtime/contract.mjs';
import {dependencyReport, resolvedReferences} from '../local-runtime/dependencies.mjs';
// @ts-expect-error Embedded runtime is native JavaScript, exercised here at runtime.
import {compareCss, normalizeCss} from '../local-runtime/parity.mjs';
// @ts-expect-error Embedded runtime is native JavaScript, exercised here at runtime.
import {replayFrom, clientFor} from '../local-runtime/platform-browser.mjs';
const header = {section_alias: 'header', position: 0, order: 0, visible: true, params: {color: '#111'}};
const footer = {section_alias: 'footer', position: 2, order: 0, visible: true, params: {}};
const raw = (sections: unknown[], data: Record<string, unknown> = {}, merchant: Record<string, unknown> = {}): RawPage => ({themeConfig: {theme: {alias: 'vitrine', params: {color_primary: '#0b5d68'}}, sections: sections as Record<string, unknown>[]}, data, merchant});
describe('contrato único entre captura, check, dev e testes', () => {
  test('resolve aliases por regra: página, sem main_, global, pasta de conteúdo e nome único', () => {
    const paths = ['sections/home/main_banner.twig', 'sections/category/category_content.twig', 'sections/global/footer.twig', 'sections/content/base_page_content.twig', 'sections/extra/destaque.twig'];
    expect(resolveSectionFile('main_banner', 'home', paths)).toBe('sections/home/main_banner.twig');
    expect(resolveSectionFile('main_category_content', 'category', paths)).toBe('sections/category/category_content.twig');
    expect(resolveSectionFile('footer', 'product', paths)).toBe('sections/global/footer.twig');
    expect(resolveSectionFile('base_page_content', 'pages', paths)).toBe('sections/content/base_page_content.twig');
    expect(resolveSectionFile('destaque', 'home', paths)).toBe('sections/extra/destaque.twig');
    expect(resolveSectionFile('qualquer', 'home', paths, {'home/qualquer': 'sections/extra/destaque.twig'})).toBe('sections/extra/destaque.twig');
    expect(() => resolveSectionFile('ausente', 'home', paths)).toThrow('Seção sem arquivo: alias "ausente" na página "home". Procurado em sections/home/ausente.twig, sections/global/ausente.twig.');
    expect(() => resolveSectionFile('../x', 'home', paths)).toThrow('inválido');
  });
  test('deriva header, footer e seções principais da lista crua, na ordem de order', () => {
    const page = raw([header, {section_alias: 'b', position: 1, order: 2, visible: true}, {section_alias: 'a', position: 1, order: 1, visible: '0'}, {section_alias: 'c', position: 1, visible: true}, footer]);
    const context = platformContext(page, {kind: 'home'}) as Record<string, any>;
    expect(context.header).toEqual(header); expect(context.footer).toEqual(footer);
    expect(context.mainSections.map((s: {section_alias: string}) => s.section_alias)).toEqual(['a', 'b', 'c']);
    expect(context.pageConfig.data.sections[1].section_alias).toBe('b'); expect(context.pageConfig.data.theme.params.color_primary).toBe('#0b5d68');
    expect(expectedSections(page)).toEqual([{alias: 'b', order: 2}, {alias: 'c', order: null}]);
    expect(context.context).toBe('home'); expect(context.page).toBe('home');
  });
  test('data.config é a seção principal e tem precedência sobre themeConfig.sections', () => {
    const page = raw([header, {section_alias: 'main_category_content', position: 1, order: 1, visible: true, params: {show_sort: false, title: 'tema'}}, footer], {context: 'search', config: {section_alias: 'main_category_content', position: 1, order: 1, visible: true, params: {products_per_page: 24, show_sort: true}}, content: {data: {data: []}}}, {categories: [{id: 1, featured: true}, {id: 2}]});
    const context = platformContext(page, {kind: 'category'}) as Record<string, any>;
    expect(context.mainSections[0].params).toEqual({show_sort: true, title: 'tema', products_per_page: 24});
    expect(context.customData.config.params.products_per_page).toBe(24); expect(context.context).toBe('search');
    expect(context.categories).toHaveLength(2); expect(context.featured_categories).toEqual([{id: 1, featured: true}]);
    const onlyConfig = platformContext(raw([header, footer], {config: {section_alias: 'main_product_content', params: {a: 1}}}), {kind: 'product'}) as Record<string, any>;
    expect(onlyConfig.mainSections).toEqual([{position: 1, visible: true, section_alias: 'main_product_content', params: {a: 1}}]);
  });
  test('sobreposições: escopo global, por página e por captura, seções por alias e ordem', () => {
    const home = raw([header, {section_alias: 'main_banner', position: 1, order: 1, visible: true, params: {slider_delay: 5, title: 'A'}}, {section_alias: 'collection', position: 1, order: 2, params: {title: 'X'}}, {section_alias: 'collection', position: 1, order: 3, params: {title: 'Y'}}, footer]);
    const category = raw([header, {section_alias: 'main_category_content', position: 1, order: 1, visible: true, params: {}}, footer]);
    const overrides = validateOverrides({format: 'yampi-local-overrides', version: 1, global: {theme: {params: {color_primary: '#ff0000'}}, sections: {header: {params: {color: '#222'}}}}, pages: {home: {sections: {main_banner: {params: {slider_delay: 9, title: null}}, 'collection@3': {params: {title: 'Z'}}}}, 'page-9': {data: {extra: true}}}});
    const patchedHome = applyOverrides(home, overrides, {kind: 'home', id: 'page-0'}), patchedCategory = applyOverrides(category, overrides, {kind: 'category', id: 'page-1'});
    const sections = patchedHome.themeConfig!.sections as Record<string, any>[];
    expect(sections.find(s => s.section_alias === 'main_banner')!.params).toEqual({slider_delay: 9});
    expect(sections.filter(s => s.section_alias === 'collection').map(s => s.params.title)).toEqual(['X', 'Z']);
    expect(sections[0].params.color).toBe('#222'); expect((patchedHome.themeConfig!.theme as any).params.color_primary).toBe('#ff0000');
    expect((patchedCategory.themeConfig!.sections as Record<string, any>[]).map(s => s.section_alias)).toEqual(['header', 'main_category_content', 'footer']);
    expect(patchedCategory.data).toEqual({}); expect(applyOverrides(category, overrides, {kind: 'category', id: 'page-9'}).data).toEqual({extra: true});
    expect(home.themeConfig!.sections).toHaveLength(5); expect((home.themeConfig!.sections as Record<string, any>[])[1].params.slider_delay).toBe(5);
    expect(() => validateOverrides({...emptyOverrides(), global: {thme: {}}})).toThrow('chave desconhecida global.thme');
    expect(mergePatch({a: {b: 1, c: 2}, d: [1]}, {a: {b: null}, d: [2], __proto__: {x: 1}})).toEqual({a: {c: 2}, d: [2]});
  });
  test('formatos anteriores viram dados brutos sem perder seções', () => {
    const legacy = legacyToRaw({merchantData: {alias: 'a'}, pageConfig: {theme: {params: {x: 1}}}, sections: {header: {params: {h: 1}}, footer: {params: {f: 1}}}, mainSectionsByPage: {home: [{section_alias: 'banner'}]}, products: [{id: 1}], pages: {home: {content: {data: {name: 'Home'}}}}}, 'home');
    expect(legacy.themeConfig!.sections).toEqual([{section_alias: 'header', params: {h: 1}, position: 0}, {order: 0, visible: true, section_alias: 'banner', position: 1}, {section_alias: 'footer', params: {f: 1}, position: 2}]);
    expect(legacy.merchant).toEqual({alias: 'a'}); expect(legacy.data).toEqual({products: [{id: 1}], content: {data: {name: 'Home'}}});
    expect(legacyToRaw({sections: [header, footer]}, 'home').themeConfig!.sections).toEqual([header, footer]);
  });
  test('chaves referenciadas pelo código e capturadas', () => {
    const keys = referencedKeys({'sections/a.twig': '{{ section.params.title }} {{ pageConfig.data.theme.params.color }} {{ merchantData.company.name }} {{ customData.config.params.products_per_page }}', 'components/A.vue': '<script>export default {computed: {x() {return this.themeStyle.grids_card_style + this.merchant.alias;}}}</script>', 'assets/a.scss': '.params.ignored{}'});
    expect(keys).toEqual({theme: ['color', 'grids_card_style'], section: ['products_per_page', 'title'], merchant: ['alias', 'company']});
    const captured = capturedKeys([raw([{section_alias: 'a', params: {title: 'x'}}], {config: {params: {products_per_page: 1}}}, {alias: 'a'})]);
    expect([...captured.section].sort()).toEqual(['products_per_page', 'title']); expect([...captured.theme]).toEqual(['color_primary']);
  });
  test('components.twig, folhas publicadas, imagens subjacentes e reescrita de URLs', () => {
    expect(componentList("<script src='{{ '/components/A.js' | components_url }}'></script>\n<script src=\"{{ '/dist/vendor/x.js' | components_url }}\"></script>")).toEqual({entries: ['/components/A.js', '/dist/vendor/x.js'], components: ['A']});
    expect(themeSheet('https://cdn.invalid/x/css/global.css')).toEqual({group: 'styles'});
    expect(themeSheet('https://cdn.invalid/css/themes/meu-tema-pages-mobile.css')).toEqual({group: 'mobilePageStyles', page: 'pages'});
    expect(themeSheet('https://cdn.invalid/css/themes/meu-tema-mobile.css')).toEqual({group: 'mobileStyles'});
    expect(themeSheet('https://cdn.invalid/css/outra.css')).toBeUndefined();
    const original = 'https://img.invalid/assets/p/foto-large.jpg', thumbor = 'https://img.invalid/AbCdEfGhIjKlMnOpQrStUvWxYz0=/fit-in/600x600/assets/p/foto-large.jpg';
    expect(underlyingImage(thumbor)).toBe(underlyingImage(original)); expect(underlyingImage(thumbor)).toBe('img.invalid/assets/p/foto.jpg');
    expect(underlyingImage('https://img.invalid/unsafe/300x0/https://other.invalid/a-small.png')).toBe('other.invalid/a.png');
    expect(underlyingImage('https://img.invalid/assets/p/outra-large.jpg')).not.toBe(underlyingImage(original));
    const rewrite = urlRewriter({[original]: '/preview/assets/a.jpg', __origin: 'https://store.invalid'});
    expect(rewrite({a: original, b: '//img.invalid/assets/p/foto-large.jpg', c: `<img src="${original}">`, d: 'https://store.invalid/produto', e: 3})).toEqual({a: '/preview/assets/a.jpg', b: '/preview/assets/a.jpg', c: '<img src="/preview/assets/a.jpg">', d: 'https://store.invalid/produto', e: 3});
  });
  test('retorno bloqueia arquivo enviado que depende de arquivo novo', () => {
    const remote = ['assets/styles/main.scss', 'assets/styles/_old.scss', 'templates/home.twig', 'sections/home/a.twig', 'components/Old.vue', 'elements/scripts/components.twig', 'assets/images/old.png'];
    const local = [...remote, 'assets/styles/_novo.scss', 'sections/home/nova.twig', 'components/NovoCard.vue', 'assets/images/hero.png'];
    const texts = {
      'assets/styles/main.scss': '@import "old", "novo";\n.a{color:red}',
      'templates/home.twig': '{% include "sections/home/nova.twig" %}{{ "images/hero.png" | assets_url }}{% include "yampi-internals/head.twig" %}<novo-card></novo-card>{{ get_section_file("a", "home") }}',
      'components/Old.vue': '<template><NovoCard/></template><script>import Old from "./Old.vue"; export default {}</script>',
      'elements/scripts/components.twig': "<script src='{{ '/components/Old.js' | components_url }}'></script><script src='{{ '/components/NovoCard.js' | components_url }}'></script>",
      'sections/home/a.twig': '{% include "sections/home/inexistente.twig" %}',
    };
    const report = dependencyReport({targets: Object.keys(texts), texts, local, remote});
    const blocked = Object.fromEntries(report.blocked.map(b => [b.path, b.dependencies.map(d => d.path).sort()]));
    expect(blocked).toEqual({'assets/styles/main.scss': ['assets/styles/_novo.scss'], 'templates/home.twig': ['assets/images/hero.png', 'components/NovoCard.vue', 'sections/home/nova.twig'], 'components/Old.vue': ['components/NovoCard.vue'], 'elements/scripts/components.twig': ['components/NovoCard.vue']});
    expect(report.warnings).toContainEqual({path: 'sections/home/a.twig', message: 'Referência sem arquivo correspondente: sections/home/inexistente.twig'});
    const unlisted = dependencyReport({targets: [], texts: {'elements/scripts/components.twig': ''}, local: ['components/Solta.vue', 'elements/scripts/components.twig'], remote: ['elements/scripts/components.twig']});
    expect(unlisted.warnings[0]).toMatchObject({path: 'components/Solta.vue'}); expect(unlisted.warnings[0].message).toContain('não será carregado na Yampi');
    expect(resolvedReferences('templates/home.twig', texts['templates/home.twig'], local).sort()).toEqual(['assets/images/hero.png', 'components/NovoCard.vue', 'sections/home/a.twig', 'sections/home/nova.twig']);
  });
  test('paridade de CSS ignora diferenças de minificação e detecta divergências', () => {
    const local = '.a{color:#ffffff;background:transparent;width:calc(100% - 10px);margin:0px 0.5em}\n@media (max-width: 700px){.b{font-weight:bold}}\n.c{background:url("/__platform/assets/img/x.svg")}\n.empty{}';
    const served = '.a{color:#fff;background:rgba(0,0,0,0);width:calc(100% - 10px);margin:0 .5em}@media (max-width:700px){.b{font-weight:700}}.c{background:url(https://cdn.invalid/img/x.svg)}';
    expect(compareCss(local, served)).toMatchObject({equal: true, matched: 3, localRules: 3, servedRules: 3});
    const divergent = compareCss(local, served.replace('#fff', '#000'));
    expect(divergent.equal).toBe(false); expect(divergent.onlyServed[0]).toContain('#000');
    expect(normalizeCss('.x{color:white}')).toBe(normalizeCss('.x{color:#FFF}'));
  });
  test('API pública gravada: filtros por id/slug, rota ausente explícita e escrita bloqueada', async () => {
    const data = {products: [{id: 1, prices: {data: {price: 10}}}, {id: 2, prices: {data: {price: 90}}}], __preview: {api: [
      {method: 'GET', path: 'catalog/collections', query: 'id%5B%5D=21&limit=2', status: 200, body: {data: [{id: 21, name: 'A'}]}},
      {method: 'GET', path: 'catalog/collections', query: 'id%5B%5D=22&limit=2', status: 200, body: {data: [{id: 22, name: 'B'}]}},
      {method: 'GET', path: 'catalog/products/produto-a', query: '', status: 200, body: {data: {id: 5, slug: 'produto-a'}}},
    ]}};
    expect(replayFrom(data, 'api', 'catalog/collections', {'id[]': [22]}).data.data).toEqual([{id: 22, name: 'B'}]);
    expect(replayFrom(data, 'api', '/v2/loja/public/catalog/collections?ids=21,22').data.data.map((c: {id: number}) => c.id)).toEqual([21, 22]);
    expect(replayFrom(data, 'api', 'catalog/products/produto-a').data.data.slug).toBe('produto-a');
    expect(() => replayFrom(data, 'api', 'catalog/collections', {'id[]': [99]})).toThrow('Rota não capturada na prévia local: GET catalog/collections?id%5B%5D=99');
    for (const route of ['catalog/products/5/flags', 'placeholders/productDetail', 'catalog/products/count', 'catalog/banners']) expect(() => replayFrom(data, 'api', route), route).toThrow('Rota não capturada');
    expect(replayFrom(data, 'api', 'products', {price_min: 50}).data).toMatchObject({data: [{id: 2}], meta: {source: 'captured-sample'}});
    expect(replayFrom(data, 'api', 'filters').data.data.priceRange).toEqual({min: 10, max: 90, source: 'captured-sample'});
    await expect(clientFor('api').post('catalog/cart', {})).rejects.toThrow('desativado');
  });
});
