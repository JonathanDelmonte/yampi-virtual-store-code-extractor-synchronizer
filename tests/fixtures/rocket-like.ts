import type {Snapshot} from '../../src/core/model';
import {fontBase64} from './visual-stores';
// Entirely fictional store and theme in the real capture format: raw section list
// with position 0/1/2, main_* aliases, window.data.config, order, company, font
// subsets, $assets icons, thumbor-like variants and public catalog reads.
export const STORE = 'https://ficticia-loja.invalid', CDN = 'https://cdn-ficticio.invalid', IMG = 'https://img-ficticio.invalid', FONTS = 'https://fontes-ficticias.invalid';
export const API = 'https://api.dooki.com.br/v2/ficticia/public/', ASSETS = CDN + '/vitrine/assets';
const SIG = 'AbCdEfGhIjKlMnOpQrStUvWxYz0=';
const variant = (size: string, path: string) => `${IMG}/${SIG}/fit-in/${size}/${path}`;
export interface FixtureResource {text?: string; base64?: string; type: string}
export interface RocketOptions {company?: boolean; missingAlias?: boolean; flagsRoute?: boolean}
const layout = `<!DOCTYPE html>
<html lang="pt-br">
<head>{% include "elements/head.twig" %}</head>
<body class="{{ merchantData.alias }} {{ page }} {{ pageConfig.data.theme.params.show_dark_mode ? 'dark-mode' : '' }}">
<div id="app">
{% include 'sections/global/header.twig' %}
{% for section in mainSections %}{% if section.visible %}{% include get_section_file(section.section_alias, page) with section %}{% endif %}{% endfor %}
{% include 'sections/global/footer.twig' %}
</div>
{% include "elements/footer.twig" %}
</body>
</html>
`;
export function themeFiles(options: RocketOptions = {}): Record<string, string> {
  return {
    'templates/home.twig': layout, 'templates/category.twig': layout, 'templates/product.twig': layout, 'templates/pages.twig': layout, 'templates/promotion.twig': layout,
    'elements/head.twig': `<meta charset="utf-8"><title>{{ merchantData.manifest.name }}</title>
{% include "elements/scripts/head.twig" %}
{% if page == 'home' %}{% include "elements/scripts/preload-home.twig" %}{% endif %}
<style>{{ pageConfig.data.theme.params.custom_css | raw }}</style>
`,
    'elements/footer.twig': '{% include "elements/scripts/components.twig" %}\n',
    'elements/scripts/head.twig': `<link href="{{ pageConfig.data.theme.params.fonts_texts_family | font_link }}" rel="stylesheet" media="screen">
<link rel="stylesheet" href="{{ '/css/global.css' | components_url }}" media="screen">
<link rel="stylesheet" href="{{ "/css/themes/vitrine-#{page}.css" | components_url }}" media="screen">
<link rel="stylesheet" href="{{ "/css/themes/vitrine-#{page}-mobile.css" | components_url }}" media="screen and (max-width: 700px)">
<link rel="stylesheet" href="{{ '/css/themes/vitrine-mobile.css' | components_url }}" media="screen and (max-width: 700px)">
`,
    'elements/scripts/preload-home.twig': `{% set banner = pageConfig.data.sections.1.params.resource.first_banner %}{% if banner.image %}<link rel="preload" as="image" href="{{ thumborize(banner.image) }}">{% endif %}
`,
    'elements/scripts/components.twig': `<!-- Exemplo fictício de lista gerada pela plataforma. -->
<script type='module' src='{{ '/dist/vendor/windowVue.js' | components_url }}'></script>
<script type='module' src='{{ '/components/BannerCarousel.js' | components_url }}'></script>
<script type='module' src='{{ '/components/CollectionShelf.js' | components_url }}'></script>
<script type='module' src='{{ '/components/ProductGrid.js' | components_url }}'></script>
${options.flagsRoute ? "<script type='module' src='{{ '/components/ProductFlags.js' | components_url }}'></script>\n" : ''}`,
    'sections/global/header.twig': `{% set section = header %}
<header class="site-header" style="background-color: {{ section.params.background_color }}">
{% if section.params.topbar_enabled %}<div class="topbar">{{ section.params.topbar_text }}</div>{% endif %}
<a href="{{ merchantData.base_url }}" class="logo-link"><img class="logo" src="{{ thumborize(merchantData.logo_url) }}" alt="{{ merchantData.manifest.name }}"></a>
<nav>{% for category in categories %}<a class="category-link" href="{{ category.url_path }}">{{ category.name }}</a>{% endfor %}</nav>
{% if section.params.search_enabled %}<span class="search-enabled">Buscar</span>{% endif %}
<i class="icon icon-cart"></i>
</header>
`,
    'sections/global/footer.twig': `{% set section = footer %}
{% set socialMedias = merchantData.company.social | filter(url => url) %}
<footer class="site-footer">
<nav class="social">{% for name, url in socialMedias %}<a class="social-link" href="{{ url }}">{{ name }}</a>{% endfor %}</nav>
{% if section.params.show_email and merchantData.company.email %}<span class="contact-email">{{ merchantData.company.email }}</span>{% endif %}
{% if section.params.newsletter_enabled %}<p class="newsletter">{{ section.params.newsletter_title }}</p>{% endif %}
{% if merchantData.cookies_policy.active %}<p class="cookies">{{ merchantData.cookies_policy.text }}</p>{% endif %}
<p class="pages">{% for item in merchantData.pages %}<a href="{{ item.url_path }}">{{ item.name }}</a>{% endfor %}</p>
</footer>
`,
    'sections/home/main_banner.twig': `<section class="main_banner main_banner-{{ section.order }}">
<img class="hero" src="{{ thumborize(section.params.resource.first_banner.image) }}" alt="Banner principal">
<banner-carousel :ids="{{ section.params.resource.ids | json_encode }}" :delay="{{ section.params.slider_delay }}"></banner-carousel>
</section>
`,
    'sections/home/text_button.twig': `<section class="text_button text_button-{{ section.order }}" style="text-align: {{ section.params.content_alignment }}">
<h2>{{ section.params.title_text | raw }}</h2>
<div class="description">{{ section.params.description_text | raw }}</div>
<p class="optional">{{ section.params.texto_opcional | raw }}</p>
{% if section.params.link_in_button %}<a class="cta" href="{{ section.params.link_in_button }}">{{ section.params.text_button }}</a>{% endif %}
</section>
`,
    'sections/home/collection.twig': `<section class="collection collection-{{ section.order }}">
<h2>{{ section.params.title }}</h2>
<collection-shelf :collection-id="{{ section.params.resource.ids | first }}" :limit="{{ section.params.visible_products }}"></collection-shelf>
</section>
`,
    'sections/category/category_content.twig': `<section class="category-content">
<h1 class="page-title">{% if context == 'search' %}Busca{% else %}{{ content.data.meta.name }}{% endif %}</h1>
<product-grid :products="{{ content.data.data | json_encode }}" :products-per-page="{{ customData.config.params.products_per_page }}"></product-grid>
</section>
`,
    'sections/product/product_content.twig': `<section class="main-product-content">
<h1 class="page-title">{{ product.data.name }}</h1>
<img class="product-image" src="{{ thumborize(product.data.images.data[0].url) }}" alt="{{ product.data.name }}">
<span class="price">{{ product.data.prices.data.price_formated }}</span>
${options.flagsRoute ? '<product-flags :product-id="{{ product.data.id }}"></product-flags>\n' : ''}</section>
`,
    'sections/product/product_similars.twig': '<section class="product-similars"><rocket-emitter event="similares"><h2>Semelhantes</h2></section>\n',
    'sections/content/base_page_content.twig': '<section class="page-content"><h1 class="page-title">{{ content.data.name }}</h1><div class="page-body">{{ content.data.content | raw }}</div></section>\n',
    'sections/promotion/promotion_content.twig': '<section class="promotion-content"><h1 class="page-title">{{ content.data.name }}</h1></section>\n',
    'assets/images/readme.md': 'Uploads fictícios da loja.\n',
    'assets/styles/global/functions.scss': "@function image($path) {\n  @return $assets + '/img/' + $path;\n}\n",
    'assets/styles/global/main.scss': `@import 'functions';
*{box-sizing:border-box}
body{margin:0;font-family:'Fictional Sans', Arial, sans-serif;background:#ffffff;color:#1f2a37}
.site-header{display:flex;align-items:center;gap:16px;padding:12px 24px}
.topbar{background:transparent;font-size:12px}
.logo{width:96px;height:48px}
.icon-cart{display:inline-block;width:24px;height:24px;background:url(image('themes/vitrine/icons/cart.svg')) no-repeat center/contain}
.category-link{color:#0b5d68;margin-right:12px}
.hero{width:100%;height:240px;object-fit:cover}
.order-probe{color:#000000}
`,
    'assets/styles/global/main-mobile.scss': '.order-probe{color:#222222}\n.site-header{padding:8px 12px}\n',
    'assets/styles/pages/home.scss': '.text_button{padding:24px 0.5rem}\n.collection-shelf{display:flex;gap:12px}\n',
    'assets/styles/pages/mobile/home.scss': '.order-probe{color:#111111}\n',
    'assets/styles/pages/category.scss': '.product-grid{display:grid;grid-template-columns:repeat(4, 1fr);gap:16px}\n',
    'assets/styles/pages/product.scss': '.product-image{width:320px;height:320px}\n',
    'assets/styles/pages/pages.scss': '.page-content{max-width:720px;margin:auto}\n',
    'assets/styles/pages/promotion.scss': '.promotion-content{text-align:center}\n',
    'components/BannerCarousel.vue': `<template><div class="banner-carousel"><img v-for="banner in banners" :key="banner.id" class="banner-image" :src="$thumborize(banner.image_url)" :alt="'Banner ' + banner.id"></div></template>
<script>import client from '@/modules/axios/api';
export default {name: 'BannerCarousel', props: ['ids', 'delay'], data: () => ({banners: []}), async mounted() {const response = await client.get('catalog/banners', {params: {'id[]': this.ids, status: 'active'}}); this.banners = response.data.data;}};</script>
`,
    'components/CollectionShelf.vue': `<template><div class="collection-shelf"><a v-for="product in products" :key="product.id" class="shelf-product" :href="$safeCleanLink(product.url_path)"><img class="shelf-image" :src="$thumborize(product.images.data[0].url)" :alt="product.name"><span>{{ product.name }}</span></a></div></template>
<script>import client from '@/modules/axios/api';
export default {name: 'CollectionShelf', props: ['collectionId', 'limit'], data: () => ({products: []}), async mounted() {const response = await client.get('catalog/collections', {params: {'id[]': [this.collectionId], limit: this.limit}}); this.products = response.data.data[0].products.data;}};</script>
`,
    'components/ProductGrid.vue': `<template><div class="product-grid" :data-per-page="productsPerPage"><a v-for="product in products" :key="product.id" class="grid-product" :href="$safeCleanLink(product.url_path)"><img class="grid-image" :src="$thumborize(product.images.data[0].url)" :alt="product.name"><b>{{ product.name }}</b></a></div></template>
<script>export default {name: 'ProductGrid', props: ['products', 'productsPerPage']};</script>
`,
    'components/UnlistedWidget.vue': '<template><p class="unlisted">Componente fora de components.twig</p></template>\n<script>export default {name: "UnlistedWidget"};</script>\n',
    ...(options.flagsRoute ? {'components/ProductFlags.vue': `<template><span class="flags">{{ state }}</span></template>
<script>import client from '@/modules/axios/api';
export default {name: 'ProductFlags', props: ['productId'], data: () => ({state: 'carregando'}), async mounted() {try {await client.get('catalog/products/' + this.productId + '/flags'); this.state = 'ok';} catch (error) {this.state = 'rota ausente';}}};</script>
`} : {}),
  };
}
const card = (id: number, name: string, image: string, price: number) => ({id, name, slug: 'produto-ficticio-' + id, url_path: `${STORE}/produto-ficticio-${id}`, images: {data: [{url: image}]}, prices: {data: {price, price_formated: 'R$ ' + price + ',00'}}});
export const products = {p1: card(1, 'Produto Fictício 1', `${IMG}/products/p1-large.jpg`, 35), p2: card(2, 'Produto Fictício 2', `${IMG}/products/p2-large.jpg`, 55), p3: card(3, 'Produto Fictício 3', `${IMG}/products/p3-large.jpg`, 75)};
const params = {
  fonts_texts_family: 'Fictional Sans', fonts_titles_family: 'Fictional Sans', show_dark_mode: false, color_general_background: '#ffffff', custom_css: '.text_button-2 h2{letter-spacing:1px}',
  grids_card_style: 'bordered', grids_image_ratio: 'square', buttons_style: 'rounded', buttons_radius: 8, empty_cart_title: 'Carrinho vazio fictício', empty_cart_button: 'Continuar', border_apply_on_images: true, highlight_type_payment: 'pix', cart_type: 'side_cart',
  checkout_api_key: 'FAKE-SECRET-KEY-0001', tracking_pixel_id: 'PX-FICTICIO',
};
const header = {section_alias: 'header', position: 0, order: 0, visible: true, params: {background_color: '#f4f7f8', topbar_enabled: true, topbar_text: 'Frete fictício', search_enabled: true, highlightbar_enabled: false, fixed_header: true}};
const footer = {section_alias: 'footer', position: 2, order: 0, visible: true, params: {show_email: true, newsletter_enabled: true, newsletter_title: 'Novidades fictícias', social_enabled: true}};
export function storefront(options: RocketOptions = {}) {
  const homeSections = [header,
    {section_alias: 'main_banner', position: 1, order: 1, visible: true, params: {slider_delay: 5, resource: {ids: [11], first_banner: {id: 11, link: '/promocao', image: `${IMG}/banners/hero-large.jpg`, mobile_image: `${IMG}/banners/hero-mobile-large.jpg`, stopwatch: null}}}},
    {section_alias: 'text_button', position: 1, order: 2, visible: true, params: {title_text: '<strong>Coleção</strong> fictícia', description_text: 'Texto <em>fictício</em>', link_in_button: '/categoria-a', text_button: 'Ver categoria', width_section: 'container', content_alignment: 'center'}},
    {section_alias: 'collection', position: 1, order: 3, visible: true, params: {title: 'Destaques fictícios', visible_products: 2, resource: {ids: [21]}}},
    {section_alias: 'collection', position: 1, order: 4, visible: false, params: {title: 'Coleção oculta', visible_products: 2, resource: {ids: [22]}}},
    ...(options.missingAlias ? [{section_alias: 'secao_inexistente', position: 1, order: 5, visible: true, params: {}}] : []),
    footer];
  const merchant = {
    id: 7, alias: 'ficticia', base_url: STORE, logo_url: `${IMG}/logo/logo-large.svg`, manifest: {name: 'Loja Fictícia Vitrine', description: 'Loja inteiramente fictícia'},
    ...(options.company === false ? {} : {company: {name: 'Pessoa Fictícia', person_type: 'person', cpf: '123.456.789-09', email: 'contato@ficticia.invalid', phone: {number: '(11) 90000-0000'}, whatsapp: {number: '11900000000'}, address: {street: 'Rua Fictícia', number: '1', city: 'Cidade Fictícia'}, social: {instagram: 'https://instagram.invalid/ficticia', facebook: ''}}}),
    cookies_policy: {active: true, text: 'Esta loja fictícia usa cookies de exemplo.'}, checkout: {skip_cart: false, checkout_token: 'FAKE-CHECKOUT-TOKEN'}, meta: {title: 'Loja Fictícia'}, meta_tags: [{name: 'description', content: 'Exemplo fictício'}],
    store_search_v1: true, session_id: 'FAKE-SESSION-ID',
    categories: [{id: 1, name: 'Categoria A', url_path: `${STORE}/categoria-a`, featured: true, children: {data: []}}, {id: 2, name: 'Categoria B', url_path: `${STORE}/categoria-b`, children: {data: []}}],
    pages: [{id: 1, name: 'Sobre nós', url_path: `${STORE}/sobre`}],
  };
  const theme = {id: 3, alias: 'vitrine', params};
  const main = (alias: string, extra: Record<string, unknown> = {}) => ({section_alias: alias, position: 1, order: 1, visible: true, params: {}, ...extra});
  const categoryConfig = (perPage: number) => ({section_alias: 'main_category_content', position: 1, order: 1, visible: true, params: {products_per_page: perPage, show_sort: true, filters_enabled: false}});
  const pages: Record<string, {kind: string; themeConfig: unknown; data: unknown; html?: string}> = {
    '/': {kind: 'home', themeConfig: {theme, sections: homeSections}, data: {context: 'home'}, html: `<img class="hero" src="${variant('1200x400', 'banners/hero-large.jpg')}"><a href="/sobre">Sobre</a><a href="/promocao">Promoção</a><a href="/carrinho">Carrinho</a><a href="/categoria-b">Categoria B</a>`},
    '/categoria-a': {kind: 'category', themeConfig: {theme, sections: [header, main('main_category_content'), footer]}, data: {context: 'category', slug: 'categoria-a', limit: 12, config: categoryConfig(12), content: {data: {data: [products.p1, products.p2], meta: {name: 'Categoria A', total: 2}}}}, html: `<img class="grid-image" src="${variant('600x600', 'products/p1-large.jpg')}">`},
    '/categoria-b': {kind: 'category', themeConfig: {theme, sections: [header, main('main_category_content'), footer]}, data: {context: 'category', slug: 'categoria-b', limit: 12, config: categoryConfig(8), content: {data: {data: [products.p3], meta: {name: 'Categoria B', total: 1}}}}},
    '/produto-ficticio-1': {kind: 'product', themeConfig: {theme, sections: [header, main('main_product_content'), main('product_similars', {order: 2}), footer]}, data: {context: 'product', config: main('main_product_content', {params: {show_sku: true}}), product: {data: {...products.p1, images: {data: [{url: `${IMG}/products/p1-large.jpg`}]}}}}, html: `<img class="product-image" src="${variant('600x600', 'products/p1-large.jpg')}">`},
    '/produto-ficticio-2': {kind: 'product', themeConfig: {theme, sections: [header, main('main_product_content'), main('product_similars', {order: 2}), footer]}, data: {context: 'product', config: main('main_product_content'), product: {data: products.p2}}},
    '/sobre': {kind: 'pages', themeConfig: {theme, sections: [header, main('base_page_content'), footer]}, data: {context: 'pages', content: {data: {name: 'Sobre nós', content: '<p>Texto fictício institucional.</p>'}}}},
    '/promocao': {kind: 'promotion', themeConfig: {theme, sections: [header, main('promotion_content'), footer]}, data: {context: 'promotion', content: {data: {name: 'Promoção fictícia'}}}},
    '/busca?q=produto': {kind: 'category', themeConfig: {theme, sections: [header, main('main_category_content'), footer]}, data: {context: 'search', config: categoryConfig(24), content: {data: {data: [products.p2], meta: {name: 'Busca'}}}}},
  };
  const sheets = (kind: string) => [`${FONTS}/css2?family=Fictional+Sans`, `${CDN}/vitrine/css/global.css`, `${CDN}/vitrine/css/themes/vitrine-${kind}.css`, `${CDN}/vitrine/css/themes/vitrine-${kind}-mobile.css`, `${CDN}/vitrine/css/themes/vitrine-mobile.css`];
  const resources: Record<string, FixtureResource> = {};
  for (const [path, page] of Object.entries(pages)) {
    const links = sheets(page.kind).map(href => `<link rel="stylesheet" href="${href}">`).join('');
    const preload = page.kind === 'home' ? `<link rel="preload" as="image" href="${variant('1200x400', 'banners/hero-large.jpg')}">` : '';
    resources[STORE + path] = {type: 'text/html; charset=utf-8', text: `<!doctype html><html><head>${links}${preload}<script>window.themeConfig = ${JSON.stringify(page.themeConfig)};\nwindow.data = ${JSON.stringify(page.data)};\nwindow.merchant = ${JSON.stringify(merchant)};</script></head><body class="ficticia ${page.kind}"><header><img class="logo" src="${variant('200x100', 'logo/logo-large.svg')}"><a href="/categoria-a">Categoria A</a></header>${page.html || ''}</body></html>`};
  }
  const svg = (label: string, color: string, size = 160) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${color}"/><text x="8" y="24" font-size="14" fill="#ffffff">${label}</text></svg>`;
  const image = (url: string, label: string, color: string) => {resources[url] = {type: 'image/svg+xml', text: svg(label, color)};};
  image(variant('1200x400', 'banners/hero-large.jpg'), 'Hero exibido', '#0b5d68');
  image(`${IMG}/banners/hero-large.jpg`, 'Hero original', '#0b5d68');
  image(`${IMG}/banners/hero-mobile-large.jpg`, 'Hero mobile', '#16404d');
  image(variant('200x100', 'logo/logo-large.svg'), 'Logo', '#1f2a37');
  image(`${IMG}/logo/logo-large.svg`, 'Logo original', '#1f2a37');
  for (const [name, color] of [['p1', '#aa3355'], ['p2', '#3355aa'], ['p3', '#33aa55']]) {image(variant('600x600', `products/${name}-large.jpg`), name + ' exibido', color); image(`${IMG}/products/${name}-large.jpg`, name + ' original', color);}
  resources[`${ASSETS}/img/themes/vitrine/icons/cart.svg`] = {type: 'image/svg+xml', text: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 4h18l-2 10H6z" fill="#0b5d68"/></svg>'};
  resources[`${FONTS}/css2?family=Fictional+Sans`] = {type: 'text/css; charset=utf-8', text: `/* cyrillic */\n@font-face{font-family:'Fictional Sans';font-style:normal;font-weight:400;src:url(${FONTS}/s/fictional-cyrillic.woff2) format('woff2');unicode-range:U+0400-045F}\n/* latin */\n@font-face{font-family:'Fictional Sans';font-style:normal;font-weight:400;src:url(${FONTS}/s/fictional-latin.woff2) format('woff2');unicode-range:U+0000-00FF}\n`};
  resources[`${FONTS}/s/fictional-latin.woff2`] = {type: 'font/woff2', base64: fontBase64};
  resources[`${FONTS}/s/fictional-cyrillic.woff2`] = {type: 'font/woff2', base64: fontBase64};
  resources[API + 'catalog/banners?status=active&id%5B%5D=11'] = {type: 'application/json', text: JSON.stringify({data: [{id: 11, image_url: `${IMG}/banners/hero-large.jpg`, mobile_image_url: `${IMG}/banners/hero-mobile-large.jpg`, link: '/promocao', session_token: 'FAKE-TOKEN'}]})};
  resources[API + 'catalog/collections?id%5B%5D=21&limit=2'] = {type: 'application/json', text: JSON.stringify({data: [{id: 21, name: 'Destaques fictícios', products: {data: [products.p1, products.p3]}}], meta: {total: 1}})};
  // Theme sheets as served: compiled by the caller, since Sass runs only in Node.
  const themeSheets: Record<string, string[]> = {[`${CDN}/vitrine/css/global.css`]: ['assets/styles/global/main.scss'], [`${CDN}/vitrine/css/themes/vitrine-mobile.css`]: ['assets/styles/global/main-mobile.scss']};
  for (const kind of ['home', 'category', 'product', 'pages', 'promotion']) {
    themeSheets[`${CDN}/vitrine/css/themes/vitrine-${kind}.css`] = [`assets/styles/pages/${kind}.scss`];
    themeSheets[`${CDN}/vitrine/css/themes/vitrine-${kind}-mobile.css`] = kind === 'home' ? ['assets/styles/pages/mobile/home.scss'] : [];
  }
  return {resources, themeSheets, merchant, homeSections};
}
// The platform minifier differs from Dart Sass in a few representations.
export const platformMinify = (css: string) => css.replace(/\btransparent\b/g, 'rgba(0,0,0,0)').replace(/:0px\b/g, ':0');
export function rocketLike(options: RocketOptions = {}) {
  const files = themeFiles(options), store = storefront(options);
  const snapshot: Snapshot = {context: {storeName: 'Loja Fictícia Vitrine', previewOrigin: STORE, editorOrigin: 'https://app.yampi.com.br'}, capturedAt: '2026-10-14T00:00:00Z', files, assets: {}};
  return {snapshot, ...store, origins: [STORE, CDN, IMG, FONTS, 'https://api.dooki.com.br']};
}
