import Vue from 'vue/dist/vue.esm.js';
import Vuex from 'vuex';
import _ from 'lodash';
import Splide from '@splidejs/splide';
Vue.use(Vuex);
let fixture, localState = {};
const missingRoutes = new Set(), derivedRoutes = new Set();
export const eventBus = new Vue();
export const uuidv4 = () => crypto.randomUUID();
export const debounce = _.debounce;
export const smoothScroll = target => (typeof target === 'string' ? document.querySelector(target) : target)?.scrollIntoView?.({behavior: 'smooth'});
export const isLinkSameStoreDomain = value => {try {return new URL(value, location.origin).origin === location.origin;} catch {return false;}};
export const createPriceObjects = value => value?.data || value || {};
function imageReady(image){image.classList.remove('-loading');const owner=image.closest('.custom-image,.image-holder,.main-product-image');owner?.classList.remove('-loading');}
export const getImageMeta = (src, callback) => {const image=new Image();let done=false;const finish=()=>{if(!done){done=true;callback(image.naturalWidth,image.naturalHeight);}};image.onload=finish;image.onerror=()=>report('Imagem local indisponível: '+src);image.src=localImage(src);if(image.complete&&image.naturalWidth)queueMicrotask(finish);};
export const localImage=src=>{const value=String(src||'');if(/^\/(tema|preview|__platform)\/assets\//.test(value)||/^data:image\/(png|jpeg|webp);base64,/.test(value))return value;
  const map=fixture?.__preview?.assetMap||{};try{if(map[value])return map[value];const url=new URL(value.startsWith('//')?'https:'+value:value,map.__origin||location.origin);if(map[url.href])return map[url.href];}catch{}
  if(value){window.__yampiMissingImages||=new Set();if(!window.__yampiMissingImages.has(value)){window.__yampiMissingImages.add(value);report('Imagem não capturada; placeholder local em uso. Consulte preview/report.json.');}}
  return '/__local/placeholder.svg';};
export function report(message, error = false, details) {
  const scope = typeof window === 'undefined' ? globalThis : window;
  scope.__yampiLocalMessages ||= [];
  scope.__yampiLocalMessages.push({message, error, details});
  if (typeof window === 'undefined') return;
  if (error) window.__yampiLocalReady = false;
  if (typeof document === 'undefined') return;
  let target = document.querySelector('#yampi-local-notice');
  if (!target) {target = document.createElement('aside'); target.id = 'yampi-local-notice'; document.body.prepend(target);}
  target.textContent = message; target.dataset.error = String(error);
  if (localState.finished) updateStatus();
}
const denied = async () => {report('Esta ação depende dos serviços da loja e está desativada na prévia local.'); const error = new Error('Serviço real desativado na prévia local.'); error.response = {status: 403, data: {errors: {local: [error.message]}}}; throw error;};
const capturedPrices=value=>value?.prices?.data||value?.prices||{};
function capturedFilters(data = fixture) {
  const prices=(data.products||[]).map(p=>Number(capturedPrices(p).price_sale??capturedPrices(p).price)).filter(Number.isFinite);
  return {priceRange:data.priceRange||{min:prices.length?Math.min(...prices):null,max:prices.length?Math.max(...prices):null,source:'captured-sample'},categories:data.categories||[],attributes:[],...(data.filters||{})};
}
// Requests are normalized to the public API path and query, as recorded by the capture.
function normalize(url, params) {
  const parsed = new URL(String(url || ''), 'https://api.local.invalid/');
  const query = new URLSearchParams(parsed.search);
  for (const [key, value] of Object.entries(params || {})) for (const item of [].concat(value)) if (item !== undefined && item !== null) query.append(Array.isArray(value) && !key.endsWith('[]') ? key + '[]' : key, String(item));
  const path = parsed.pathname.replace(/^\/v\d+\/[^/]+\/public\//, '/').replace(/^\/+|\/+$/g, '');
  return {path, query};
}
const values = (query, ...names) => names.flatMap(name => [...query.getAll(name), ...query.getAll(name + '[]')]).flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
function routeError(module, path, query) {
  const label = 'GET ' + path + (String(query) ? '?' + query : '');
  if (!missingRoutes.has(label)) {missingRoutes.add(label); report('Rota não capturada: ' + label + (module !== 'api' ? ' (' + module + ')' : '') + '.');}
  const error = new Error('Rota não capturada na prévia local: ' + label);
  error.response = {status: 404, data: {errors: {local: [error.message]}}};
  return error;
}
// Recorded public reads are replayed. Filters by id/slug/limit select from the
// recorded items; an unrecorded route is an explicit error, never another route's data.
export function replayFrom(data, module, url, params) {
  const {path, query} = normalize(url, params), records = (data.__preview?.api || []).filter(r => r.path === path);
  if (records.length) {
    const ids = values(query, 'id', 'ids'), slugs = values(query, 'slug', 'slugs'), limit = Number(query.get('limit')) || undefined;
    const exact = records.find(r => r.query === String(query));
    if (exact && !ids.length && !slugs.length) return {data: _.cloneDeep(exact.body), status: exact.status};
    const items = [...new Map(records.flatMap(r => Array.isArray(r.body?.data) ? r.body.data : []).map(item => [item?.id ?? item?.slug, item])).values()];
    if (ids.length || slugs.length) {
      const selected = items.filter(item => ids.includes(String(item?.id)) || slugs.includes(String(item?.slug)));
      if (selected.length < Math.max(ids.length, slugs.length)) throw routeError(module, path, query);
      return {data: {..._.cloneDeep(records[0].body), data: _.cloneDeep(selected.slice(0, limit))}, status: 200};
    }
    const body = _.cloneDeep((exact || records[0]).body);
    if (limit && Array.isArray(body?.data)) body.data = body.data.slice(0, limit);
    return {data: body, status: (exact || records[0]).status};
  }
  // Documented derivations from the captured sample; labeled as such.
  const products = data.products || [];
  if (/^(?:catalog\/)?filters$/.test(path)) {derivedRoutes.add(path); return {data: {data: capturedFilters(data), meta: {source: 'captured-sample'}}, status: 200};}
  if (/^(?:catalog\/)?products$/.test(path)) {
    derivedRoutes.add(path);
    const min = Number(query.get('price_min') ?? query.get('min_price') ?? 0), max = Number(query.get('price_max') ?? query.get('max_price') ?? Infinity);
    const payload = products.filter(p => {const price = Number(capturedPrices(p).price_sale ?? capturedPrices(p).price ?? 0); return price >= min && price <= max;});
    return {data: {data: _.cloneDeep(payload), meta: {total: payload.length, current_page: 1, last_page: 1, source: 'captured-sample'}, links: {}}, status: 200};
  }
  throw routeError(module, path, query);
}
export function clientFor(module = 'api') {
  const read = async (url, config = {}) => replayFrom(fixture, module, url, config.params);
  return Object.assign(config => (String(config.method || 'get').toLowerCase() === 'get' ? read(config.url, config) : denied()), {get: read, post: denied, put: denied, patch: denied, delete: denied});
}
export const client = clientFor('api');
export const builderSearch = query => query || {};
export const urlSearch = query => '/busca?' + new URLSearchParams(query || {});
export class SearchAttributesHandler {
  constructor() {this.attributes = [];}
  add(value) {this.attributes.push(value); return this;}
  remove(value) {this.attributes = this.attributes.filter(item => item !== value); return this;}
  get() {return this.attributes;}
  clear() {this.attributes = [];}
}
// Store links become local paths; the local router renders captured pages and
// answers uncaptured ones with an explicit page. Other origins stay blocked.
const safeLink = value => {
  const text = String(value ?? '');
  if (/^\/preview(?:\?|$)/.test(text)) return text;
  try {
    const origin = fixture?.__preview?.source?.origin, url = new URL(text || '/', origin || location.origin);
    if ([location.origin, origin].includes(url.origin)) return url.pathname + url.search + url.hash;
    return url.href;
  } catch {return '#';}
};
const product = () => fixture.product?.data || fixture.product || fixture.products?.[0] || {};
function currentProduct(vm) {const value = vm.product || vm.$attrs.product; return value?.data || value?.content || value || product();}
function firstSku(value) {const skus=value?.skus?.data||value?.skus||[];return skus.find(s=>s.id===value.selected_sku_id)||skus.find(s=>s.blocked_sale!==true)||{...capturedPrices(value),id:value?.id,blocked_sale:true,allow_sell_without_customization:false,customizations:{data:[]}};}
const themeParams = () => fixture.pageConfig?.data?.theme?.params || fixture.pageConfig?.theme?.params || {};
export const mixins = {
  mobile: {data: () => ({isMobile: matchMedia('(max-width:700px)').matches}), mounted() {this.__localResize = () => {this.isMobile = matchMedia('(max-width:700px)').matches;}; window.addEventListener('resize', this.__localResize);}, beforeDestroy() {window.removeEventListener('resize', this.__localResize);}},
  merchant:{computed:{merchant:()=>fixture.merchantData,shouldUseNewSearchStrategy:()=>fixture.merchantData?.new_search===true||fixture.merchantData?.store_search_v1===true}},
  product: {computed: {validProduct() {return currentProduct(this);}, firstValidSku() {return firstSku(this.validProduct);}, selectedSku() {return this.$store.state.product.selectedSku || this.firstValidSku;}, validSku() {return this.selectedSku;}}, methods: {setSelectedSku(value) {this.$store.commit('product/SET', {selectedSku: value});}}},
  productCardTheme: {computed: {themeStyle: themeParams, spaceBetweenNamePrice:()=>themeParams().space_between_name_price||'small',oldPriceSize:()=>themeParams().old_price_size||'small',smallCentsPrice:()=>!!themeParams().small_cents_price,showMaxInstallment:()=>!!themeParams().show_max_installment}},
  prices: {data: () => ({loadingPrices: false, productPricesParams: {}}), computed: {
    productPrices() {const sku=this.selectedSku;if(sku?.prices)return sku.prices.data||sku.prices;if(sku&&(sku.price_sale!==undefined||sku.price!==undefined))return {...sku,price:sku.price??sku.price_sale,price_formated:sku.price_formated??sku.price_sale_formated};return capturedPrices(currentProduct(this));},
    selectedPrice() {return this.productPrices.price_formated || (this.hasPrice?this.$formatMoney(this.productPrices.price_sale??this.productPrices.price):'Preço não capturado');},
    priceText: () => '', hasPromotion() {return !!this.productPrices.has_promotion;}, hasPrice(){const price=this.productPrices.price_sale??this.productPrices.price;return price!==null&&price!==undefined&&Number.isFinite(Number(price));},
  }, methods: {formatMoney: v => Number(v || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}},
  helpers: {methods: {uuidv4, getImageMeta}},
  buttons: {methods: {buttonClass: () => '', handleClick: denied}},
  cache: {data: () => ({cache: {}}), methods: {getCache(key) {return this.cache[key];}, setCache(key, value) {Vue.set(this.cache, key, value);}}},
  cashback: {computed: {cashbackValue: () => 0}, methods: {calculateCashback: () => 0, getValidCashback: () => ({})}},
  errors: {data: () => ({errors: {}}), methods: {hasError(name) {return !!this.errors[name]?.length;}, getError(name) {return this.errors[name]?.[0] || '';}, clearErrors() {this.errors = {};}, handleErrors(error) {this.errors = error.response?.data?.errors || {}; report(error.message);}}},
  queryParams: {data: () => ({queryParams: {}}), methods: {bootQueryParams() {this.queryParams = Object.fromEntries(new URLSearchParams(location.search));}, updateQueryParams(values) {this.queryParams = {...this.queryParams, ...values};}, getQueryParam: name => new URLSearchParams(location.search).get(name)}},
  touchable: {data: () => ({isTouchable: matchMedia('(pointer:coarse)').matches})},
};
// The status is structural: rendered vs expected sections, placeholders, fonts
// with errors and uncaptured routes. HTTP 200 or a mounted app is not enough.
function updateStatus() {
  const target = document.querySelector('#yampi-preview-status [data-summary]');
  const s = window.__yampiLocalState;
  if (!target || !s) return;
  const parts = [];
  if (s.expectedSections !== null) parts.push(s.renderedSections < s.expectedSections ? `Prévia incompleta: ${s.renderedSections} de ${s.expectedSections} seções` : `${s.renderedSections}/${s.expectedSections} seções`);
  if (!s.captured) parts.push('página sem captura');
  if (s.placeholders) parts.push(`${s.placeholders} ${s.placeholders === 1 ? 'imagem' : 'imagens'} em placeholder`);
  if (s.failedFonts.length) parts.push(`${s.failedFonts.length} ${s.failedFonts.length === 1 ? 'fonte' : 'fontes'} com erro`);
  if (s.missingRoutes.length) parts.push(`${s.missingRoutes.length} ${s.missingRoutes.length === 1 ? 'rota não capturada' : 'rotas não capturadas'}`);
  if (s.errors) parts.push(`${s.errors} ${s.errors === 1 ? 'erro' : 'erros'}`);
  if (s.assetsUrl) parts.push('assets_url local não garante o caminho de produção');
  target.textContent = parts.join(' · ');
  target.closest('aside').dataset.incomplete = String(!window.__yampiLocalReady);
}
export async function finish() {
  await document.fonts?.ready;
  await new Promise(resolve => setTimeout(resolve, 0));
  const messages = window.__yampiLocalMessages || [];
  const expected = Number.isInteger(localState.expectedSections) ? localState.expectedSections : null;
  window.__yampiLocalState = {
    page: localState.page, captured: localState.page?.captured !== false, expectedSections: expected, renderedSections: localState.renderedSections ?? 0, missingSections: localState.missingSections || [],
    placeholders: [...document.images].filter(image => (image.currentSrc || image.src).includes('/__local/placeholder.svg')).length,
    failedFonts: [...(document.fonts || [])].filter(face => face.status === 'error').map(face => face.family),
    missingRoutes: [...missingRoutes], derivedRoutes: [...derivedRoutes], errors: messages.filter(m => m.error).length, assetsUrl: localState.assetsUrl || 0,
    warnings: localState.warnings || [],
  };
  window.__yampiLocalReady = (expected === null || window.__yampiLocalState.renderedSections >= expected) && !messages.some(m => m.error);
  localState.finished = true;
  updateStatus();
}
export function setup(data, state = {}) {
  fixture = data; localState = state || {};
  window.merchant = data.merchantData; window.product = product(); window.Yampi = {local: true, cache: {js: 10}, mago_config: {}}; window._ = _;
  Vue.config.productionTip = false;
  Vue.config.errorHandler = (error, component, info) => report('Erro Vue local: ' + error.message, true, {component: component?.$options.name, info, stack: error.stack});
  Vue.config.warnHandler = (message,component,trace) => report('Aviso Vue local: '+message,false,{component:component?.$options.name,trace});
  window.addEventListener('unhandledrejection', event => {if (!/^Rota não capturada/.test(event.reason?.message || '')) report('Promessa rejeitada na prévia local: ' + (event.reason?.message || event.reason), false); event.preventDefault();});
  const modules = {
    merchant: {merchant: data.merchantData, storeModules:{new_search:data.merchantData?.new_search===true},storeSearch:data.merchantData?.store_search_v1===true, defaultCard: {}, categories: data.categories || []},
    product: {product: data.product, validProduct: product(), validSku: null, selectedSku: null, loadingPrices: false, price: product().prices?.data || {}},
    theme: {themeStyle: themeParams()},
    preview: {isPreview: true, isIframe: true, activeSection: null},
    header: {showSearchBar: false},
    cart: {cart: {items: [], prices: {total: 0, subtotal: 0, shipment: 0, discount: 0}, cart_discounts: []}, cartType: 'side_cart'},
    buyTogether: {combos: []},
    filters: {activeFilters: [], searchSelectedAttributes: [], selectedAttributes: [], searchFilters:capturedFilters(),filters:data.filters?.attributes||[], selectedFilters: []},
    queryParams: {queryParams: {}, params: {}}, environment: {recomm: null}, images: {items: [], lazyloadImages: []}, queue: {items: []},
  };
  const store = new Vuex.Store({modules: Object.fromEntries(Object.entries(modules).map(([name, initial]) => [name, {
    namespaced: true, state: () => _.cloneDeep(initial), getters: Object.fromEntries(Object.keys(initial).map(key => [key, state => state[key]])),
    mutations: {PUSH(state, value) {state.items?.push(value);}, POP(state) {state.items?.shift();}, CLEAR(state) {if (state.items) state.items = [];}, SET(state, values) {Object.assign(state, values);}, SET_CART_TYPE(state, value) {state.cartType = value;}, SET_COMBOS(state, value) {state.combos = value;}},
    actions: {
      loadCart: () => null,
      redirectToCart: denied, addProductsToCart: denied, updateItemQuantity: denied, removeItem: denied,
      updateShowSearchBar: ({commit}, value) => commit('SET', {showSearchBar: value}),
      setRecomm: ({commit}, value) => commit('SET', {recomm: value}),
      updateQueryParams: ({commit}, value) => commit('SET', {queryParams: value}),
      setQueryParams: ({commit}, value) => commit('SET', {queryParams: value}),
      removeQueryParams: ({state, commit}, value) => {const query = {...state.queryParams}; for (const key of [].concat(value?.key || [])) delete query[key]; commit('SET', {queryParams: query});},
      bootQueryParams: () => null, removeActiveFilter: ({commit}, value) => commit('SET', {activeFilters: value || []}),
      trackViewItem: () => null,
    }
  }]))});
  Vue.prototype.$formatMoney = value => Number(value || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
  Vue.prototype.$baseUrl = location.origin;
  Vue.prototype.$thumborize = localImage;
  Vue.prototype.$safeCleanLink = safeLink;
  Vue.prototype.$checkoutUrl = () => '#';
  Vue.prototype.$redirectTo = value => {const url = safeLink(value); if (url.startsWith('/')) location.assign(url); else report('Link externo desativado na prévia local.');};
  Vue.prototype.$applyQueriesToUrl = (url, query) => {const result = new URL(url, location.origin); for (const [k, v] of Object.entries(query || {})) result.searchParams.set(k, v); return result.pathname + result.search;};
  Vue.prototype.$randomString = uuidv4;
  Vue.prototype.$t = Vue.prototype.$tc = (key, value) => value === undefined ? key : String(value);
  Vue.component('RocketEmitter', {functional: true, render: (h, context) => h('div', context.data, context.children)});
  Vue.component('Splide', {props: ['options', 'slides'], data: () => ({splide: null}), render(h) {return h('div', {class: 'splide'}, [h('div', {class: 'splide__track'}, [h('ul', {class: 'splide__list'}, this.$slots.default)])]);}, mounted() {
    this.splide = new Splide(this.$el, this.options || {});
    for (const event of ['move', 'moved', 'click', 'lazyload:loaded']) this.splide.on(event, (...args) => this.$emit('splide:' + event, this.splide, ...args));
    this.splide.mount(); setTimeout(() => {if (!this._isDestroyed && this.splide) this.$emit('splide:mounted', this.splide);}, 0);
  }, beforeDestroy() {this.splide?.destroy();}, watch: {slides() {this.$nextTick(() => this.splide?.refresh());}}, methods: {sync(other) {if (other) this.splide.sync(other);}, go(index) {this.splide.go(index);}}});
  Vue.component('SplideSlide', {functional: true, render: (h, context) => h('li', {...context.data, class: ['splide__slide', context.data.class]}, context.children)});
  Vue.component('PinchZoom', {functional: true, render: (h, context) => h('div', {...context.data, class: ['pinch-zoom-content', context.data.class]}, context.children)});
  Vue.component('ZoomOnHover', {props:['imgNormal','imgZoom','scale','altText'],mounted(){if(this.$el.complete&&this.$el.naturalWidth)this.$emit('loaded');},render(h) {return h('img', {attrs: {src: localImage(this.imgNormal), alt: this.altText || ''}, style: {maxWidth: '100%'}, on: {load: () => this.$emit('loaded')}});}});
  Vue.directive('lazyload',{inserted(el){el.addEventListener('load',()=>imageReady(el));el.addEventListener('error',()=>report('Imagem local não carregada.'));if(el.dataset.src)el.src=localImage(el.dataset.src);if(el.complete&&el.naturalWidth){imageReady(el);queueMicrotask(()=>el.dispatchEvent(new Event('load')));}}});
  Vue.directive('observe-visibility', {inserted(el, binding) {if (typeof binding.value === 'function') binding.value(true); else binding.value?.callback?.(true);}});
  Vue.directive('debounce', {inserted(el, binding) {if (typeof binding.value === 'function') el.addEventListener('input', _.debounce(binding.value, 250));}});
  document.addEventListener('load',event=>{if(event.target instanceof HTMLImageElement)imageReady(event.target);},true);
  document.addEventListener('error',event=>{if(event.target instanceof HTMLImageElement)report('Asset local não carregado; consulte o diagnóstico.');},true);
  document.addEventListener('securitypolicyviolation',event=>report('Recurso externo bloqueado na prévia local: '+event.violatedDirective));
  document.addEventListener('submit', event => {event.preventDefault(); report('Formulários reais estão desativados na prévia local.');}, true);
  document.addEventListener('click', event => {const link = event.target.closest?.('a'); if (link && link.href && new URL(link.href).origin !== location.origin) {event.preventDefault(); report('Link externo desativado na prévia local.');}}, true);
  return store;
}
