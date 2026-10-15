import {hashBytes, validateContext, type Context, type Assets, type Files} from './model';
import {pageSections, resolveSectionFile, referencedKeys, capturedKeys, expectedSections, CONTRACT_VERSION} from '../../local-runtime/contract.mjs';
export type Json = null | boolean | number | string | Json[] | {[key: string]: Json};
export type Data = {[key: string]: Json};
export type PageKind = 'home' | 'category' | 'product' | 'pages' | 'promotion';
export const PAGE_KIND_LIST: PageKind[] = ['home', 'category', 'product', 'pages', 'promotion'];
export interface PreviewIssue {code: string; resource?: string; reason: string}
// window.themeConfig, window.data and window.merchant as served, after the blocklist.
export interface RawPage {themeConfig?: Data; data?: Data; merchant?: Data; bodyClasses?: string[]}
export interface PreviewPage {id: string; kind: PageKind; context?: string; sourceUrl: string; raw: RawPage}
export type ResourceCategory = 'theme-css' | 'font-css' | 'css' | 'font' | 'icon' | 'image' | 'other';
export interface PreviewResource {url: string; path: string; type: string; bytes: number; sha256: string; category: ResourceCategory; priority: number}
export interface ApiRecord {method: 'GET'; path: string; query: string; url: string; status: number; body: Json}
export interface PreviewPlatform {assetsBase?: string; apiBase?: string; fontSheets: {url: string; families: string[]}[]; themeSheets: {url: string; group: string; page?: string}[]}
export interface PreviewBundle {
  format: 'yampi-local-preview'; version: 2; toolVersion: string; capturedAt: string;
  source: {kind: 'editor' | 'published' | 'demonstration'; origin: string; association: 'same-editor' | 'published-unverified' | 'unavailable'};
  limits: PreviewLimits; pages: PreviewPage[]; api: ApiRecord[]; assets: Assets; resources: PreviewResource[];
  aliases: Record<string, string>; platform: PreviewPlatform; issues: PreviewIssue[]; removedKeys: string[];
}
export interface PreviewLimits {pages: number; resources: number; resourceBytes: number; totalBytes: number; jsonBytes: number; apiRequests: number; apiBytes: number; timeoutMs: number}
export const PREVIEW_LIMITS: PreviewLimits = {pages: 8, resources: 200, resourceBytes: 2 * 1024 * 1024, totalBytes: 12 * 1024 * 1024, jsonBytes: 2 * 1024 * 1024, apiRequests: 40, apiBytes: 4 * 1024 * 1024, timeoutMs: 15000};
export const TOOL_VERSION = '0.4.0';
export function previewLimits(input: Partial<PreviewLimits> = {}): PreviewLimits {
  const output = {...PREVIEW_LIMITS, ...input};
  for (const key of Object.keys(PREVIEW_LIMITS) as (keyof PreviewLimits)[]) if (!Number.isInteger(output[key]) || output[key] < 1 || output[key] > PREVIEW_LIMITS[key]) throw new Error('Limite de prévia inválido: ' + key);
  return output;
}
export function publicUrl(value: string, base: string): string {
  if (value.length > 2000 || /[\u0000-\u0020\\]/.test(value)) throw new Error('URL insegura.');
  const url = new URL(value, base);
  if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|.*\.localhost|.*\.local|\d+(?:\.\d+){3}|\[.*\])$/i.test(url.hostname) || /(?:^|\/)(?:admin|checkout|cart|carrinho|account|customer|orders|login)(?:\/|$)/i.test(url.pathname)) throw new Error('URL fora da vitrine pública.');
  if ([...url.searchParams.keys()].some(k => /token|secret|auth|session|password|key|signature|credential/i.test(k))) throw new Error('URL contém parâmetro de sessão ou credencial.');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|_gl$|fbclid$|gclid$)/.test(key)) url.searchParams.delete(key);
  return url.href;
}
// Blocklist sanitization of public objects. The storefront already serves them to
// anonymous visitors; secrets, tracking IDs and personal data are still removed.
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const SECRET_SEGMENTS = new Set(['token', 'tokens', 'secret', 'secrets', 'password', 'passwords', 'passwd', 'pwd', 'signature', 'session', 'sessions', 'sessid', 'auth', 'authorization', 'cookie', 'credential', 'credentials', 'csrf', 'xsrf', 'jwt', 'bearer', 'otp', 'apikey']);
const TRACKING_SEGMENTS = new Set(['pixel', 'pixels', 'gtm', 'gtag', 'analytics', 'tracking', 'tracker', 'trackers', 'hotjar', 'clarity', 'criteo']);
const PRIVATE_KEYS = new Set(['customer', 'customers', 'orders', 'order_history', 'addresses']);
const segments = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
export function blockedKey(key: string): string | undefined {
  if (PRIVATE_KEYS.has(key.toLowerCase())) return 'dado de cliente';
  const parts = segments(key);
  if (parts.some(p => SECRET_SEGMENTS.has(p)) || parts.length > 1 && parts.some(p => p === 'key' || p === 'keys')) return 'segredo';
  if (parts.some(p => TRACKING_SEGMENTS.has(p))) return 'rastreamento';
  return undefined;
}
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, CPF = /\b\d{3}\.?\d{3}\.?\d{3}-\d{2}\b/g, CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-\d{2}\b/g;
const TOKENS = /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*|(?:sk|pk|rk)_live_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}/g;
const SECRET_QUERY = /[?&](?:token|secret|auth|session|password|key|signature|credential)[^=&]*=/i;
const ACTIVE = /<(?:script|iframe|object|embed|base|meta|link|form)\b|\bon[a-z]+\s*=|javascript:/i;
function neutralize(text: string): string {
  let current = text, previous;
  do {
    previous = current;
    current = current.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<\/?(?:script|iframe|object|embed|base|meta|link|form)\b[^>]*>/gi, '').replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/javascript:/gi, '');
  } while (current !== previous);
  return ACTIVE.test(current) ? '' : current;
}
interface Sanitizer {removed: Map<string, {reason: string; count: number}>; redacted: number; neutralized: number; truncated: string[]}
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
function sanitizeString(text: string, state: Sanitizer, path: string): string {
  if (text.length > 200000) {state.truncated.push(path); return '';}
  if (SECRET_QUERY.test(text)) {state.redacted++; return 'redacted';}
  let result = text.replace(TOKENS, () => {state.redacted++; return 'redacted';}).replace(EMAIL, () => {state.redacted++; return 'redacted';}).replace(CPF, () => {state.redacted++; return 'redacted';}).replace(CNPJ, () => {state.redacted++; return 'redacted';});
  if (ACTIVE.test(result)) {result = neutralize(result); state.neutralized++;}
  return result;
}
function sanitize(value: unknown, state: Sanitizer, path: string, depth = 0): Json | undefined {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return sanitizeString(value, state, path);
  if (depth > 32) {state.truncated.push(path); return null;}
  if (Array.isArray(value)) {
    if (value.length > 500) state.truncated.push(path);
    return Array.from({length: Math.min(value.length, 500)}, (_, i) => {const d = Object.getOwnPropertyDescriptor(value, String(i)); return d && 'value' in d ? sanitize(d.value, state, `${path}[${i}]`, depth + 1) ?? null : null;});
  }
  if (!plain(value)) return undefined;
  const output: Data = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor) || UNSAFE.has(key) || key.length > 200) continue;
    const reason = blockedKey(key);
    if (reason) {const entry = state.removed.get(key) || {reason, count: 0}; entry.count++; state.removed.set(key, entry); continue;}
    const child = sanitize(descriptor.value, state, path ? path + '.' + key : key, depth + 1);
    if (child !== undefined) output[key] = child;
  }
  return output;
}
// Probable personal data: the shape stays, values become "redacted".
const COMPANY_KEEP = new Set(['person_type', 'social']);
function redactCompany(value: Json): Json {
  if (Array.isArray(value)) return value.map(redactCompany);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, COMPANY_KEEP.has(key) ? item : redactCompany(item)]));
  if (typeof value === 'string') return value ? 'redacted' : value;
  return typeof value === 'number' ? null : value;
}
export function sanitizeRaw(input: unknown, resource: string, limits: PreviewLimits = PREVIEW_LIMITS): {raw: RawPage; issues: PreviewIssue[]; removed: string[]} {
  const state: Sanitizer = {removed: new Map(), redacted: 0, neutralized: 0, truncated: []}, raw: RawPage = {}, issues: PreviewIssue[] = [];
  const source = plain(input) ? input : {};
  // Descriptors only: getters on page objects are never invoked.
  const read = (key: string) => {const descriptor = Object.getOwnPropertyDescriptor(source, key); return descriptor && 'value' in descriptor ? descriptor.value : undefined;};
  for (const key of ['themeConfig', 'data', 'merchant'] as const) {
    const value = sanitize(read(key), state, key);
    if (value && typeof value === 'object' && !Array.isArray(value)) raw[key] = value as Data;
  }
  if (raw.merchant && raw.merchant.company && typeof raw.merchant.company === 'object') {raw.merchant = {...raw.merchant, company: redactCompany(raw.merchant.company)}; issues.push({code: 'company-redacted', resource, reason: 'merchant.company preserva as chaves; nome, documento, contatos e endereço viram "redacted".'});}
  const bodyClasses = read('bodyClasses');
  if (Array.isArray(bodyClasses)) raw.bodyClasses = bodyClasses.filter((v): v is string => typeof v === 'string' && /^[a-z0-9_-]{1,100}$/i.test(v)).slice(0, 30);
  if (state.removed.size) issues.push({code: 'keys-removed', resource, reason: 'Removidas pela lista de bloqueio: ' + [...state.removed].map(([key, item]) => `${key} (${item.reason})`).slice(0, 40).join(', ') + '.'});
  if (state.redacted) issues.push({code: 'values-redacted', resource, reason: `${state.redacted} valores com e-mail, CPF/CNPJ ou credencial substituídos por "redacted".`});
  if (state.neutralized) issues.push({code: 'active-content-neutralized', resource, reason: `${state.neutralized} textos com scripts, iframes ou handlers neutralizados.`});
  if (state.truncated.length) issues.push({code: 'values-limited', resource, reason: 'Valores acima dos limites de tamanho, profundidade ou 500 itens: ' + state.truncated.slice(0, 10).join(', ') + '.'});
  if (new TextEncoder().encode(JSON.stringify(raw)).length > limits.jsonBytes) throw new Error('JSON da página ultrapassa o limite; não foi truncado.');
  return {raw, issues, removed: [...state.removed.keys()]};
}
export function sanitizeJson(value: unknown, resource: string): {value: Json; issues: PreviewIssue[]; removed: string[]} {
  const {raw, issues, removed} = sanitizeRaw({data: plain(value) ? value : {data: value}}, resource);
  const body = raw.data ?? {};
  return {value: plain(value) ? body : (body.data ?? null), issues, removed};
}
export function previewPath(value: string): string {
  if (!/^assets\/[a-f0-9]{64}\.(?:png|jpg|webp|svg|woff2?|ttf|otf|css)$/.test(value)) throw new Error('Caminho de asset de prévia inválido.'); return value;
}
export function previewType(bytes: Uint8Array, mime: string): string {
  const hex = Array.from(bytes.slice(0, 12), b => b.toString(16).padStart(2, '0')).join('');
  if (hex.startsWith('89504e470d0a1a0a')) return 'png'; if (hex.startsWith('ffd8ff')) return 'jpg';
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250') return 'webp';
  if (hex.startsWith('774f4632')) return 'woff2'; if (hex.startsWith('774f4646')) return 'woff'; if (hex.startsWith('00010000')) return 'ttf'; if (hex.startsWith('4f54544f')) return 'otf';
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) {
    if (/<(?:script|foreignObject|iframe)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["']?(?:https?:|\/\/|javascript:|data:)/i.test(text)) throw new Error('SVG ativo ou externo rejeitado.'); return 'svg';
  }
  if (mime.split(';')[0] === 'text/css' && !/<\/?(?:script|html)\b/i.test(text)) return 'css';
  throw new Error('Tipo do recurso não suportado ou conteúdo inválido.');
}
// Fictional raw pages in the same format as a capture, for exports without context.
export function demonstrationPages(context: Context, paths: string[] = []): PreviewPage[] {
  const has = (alias: string, folder: string) => paths.includes(`sections/${folder}/${alias}.twig`);
  const image = '/__local/placeholder.svg', origin = context.previewOrigin;
  const prices = {price: 100, price_formated: 'R$ 100,00', price_sale: 100, price_sale_formated: 'R$ 100,00', has_promotion: false, discount: 0, installments: [], billet_discount: 0};
  const product = {id: 1, name: 'Produto fictício', sku: 'LOCAL-001', slug: 'produto-ficticio', url_path: origin + '/produto-ficticio', active: true, availability: 'Disponível', warranty: 'Exemplo local', brand: {data: {name: 'Marca fictícia'}}, prices: {data: prices}, texts: {data: {description: 'Produto fictício para conferir o layout.'}}, images: {data: [{id: 1, url: image, src: image, src_zoom: image, src_thumb: image, width: 640, height: 640}]}, skus: {data: []}, flags: {data: []}, breadcrumbs: {data: []}, extras: {data: {}}, variations: {data: []}, reviews: {data: []}, customizations: {data: []}, specifications: {data: []}};
  const category = {id: 1, name: 'Categoria fictícia', url_path: origin + '/categoria-ficticia', children: {data: []}, image_url: image};
  const params = {fonts_texts_family: 'Arial', fonts_titles_family: 'Arial', highlight_type_payment: 'promotional', color_general_background: '#ffffff', custom_css: '', show_dark_mode: false, cart_type: 'side_cart'};
  const section = (alias: string, position: number, order: number): Data => ({section_alias: alias, position, order, visible: true, params: {title: 'Prévia local fictícia', products_per_page: 12, filters_enabled: false, show_sku: true, show_availability: true, show_warranty: false, layout: 'container', slider_delay: 5, resource: {ids: [1], dimensions: {width: 1200, height: 400}, first_banner: {id: 1, image_url: image}}, collection_id: 1, collection: {id: 1}, show_title: true, mobile_products_per_line: 2, visible_products: 12, desktop_layout: 'grid', show_all_button: true, header_layout: 'inline', menu_text_color: '#222222', text_color: '#222222', background_color: '#ffffff', cart_icon_color: '#222222', searchbar_enabled: true, categories_enabled: true, categories_type: 'all', show_brand: true, show_description: true}});
  const merchant = {id: 1, alias: 'local', manifest: {name: context.storeName, description: 'Prévia com dados fictícios'}, domain: origin, logo_url: '', store_search_v1: true, checkout: {skip_cart: false, redirect_to: ''}, meta: {}, meta_tags: [], cashbacks: [], company: {name: 'redacted', person_type: 'person', social: {}, phone: {}, whatsapp: {}, address: {}}, payments: [], pages: [], cookies_policy: {active: false}, categories: [category]};
  const main: Record<PageKind, [string, string][]> = {home: [['main_banner', 'home'], ['collection', 'home']], category: [['category_content', 'category']], product: [['product_content', 'product']], promotion: [['promotion_content', 'promotion']], pages: [['base_page_content', 'content']]};
  const routes: Record<PageKind, string> = {home: '/', category: '/categoria-ficticia', product: '/produto-ficticio', pages: '/pagina-ficticia', promotion: '/promocao-ficticia'};
  // Only page kinds the exported theme has a template for.
  const kinds = paths.length ? PAGE_KIND_LIST.filter(kind => paths.includes(`templates/${kind}.twig`)) : PAGE_KIND_LIST;
  return kinds.map((kind, index) => ({id: 'page-' + index, kind, sourceUrl: origin + routes[kind], raw: {
    merchant, bodyClasses: [],
    themeConfig: {page: kind, theme: {alias: 'local', params}, sections: [...(has('header', 'global') ? [section('header', 0, 0)] : []), ...main[kind].filter(([alias, folder]) => has(alias, folder)).map(([alias], order) => section(alias, 1, order)), ...(has('footer', 'global') ? [section('footer', 2, 0)] : [])]},
    data: {products: [product], product: {data: product}, categories: [category], banners: [{id: 1, image_url: image, mobile_image_url: image, link: origin + routes.category}], content: {data: {data: [product], meta: {name: 'Categoria fictícia', parent: {}, total: 1}, content: 'Conteúdo fictício para a prévia local.', name: 'Página fictícia'}, meta: {}}, limit: 12, context: kind},
  } as RawPage}));
}
export function demonstration(context: Context, reason: string, paths: string[] = []): PreviewBundle {
  validateContext(context);
  return {format: 'yampi-local-preview', version: 2, toolVersion: TOOL_VERSION, capturedAt: new Date().toISOString(), source: {kind: 'demonstration', origin: context.previewOrigin, association: 'unavailable'}, limits: {...PREVIEW_LIMITS}, pages: demonstrationPages(context, paths), api: [], assets: {}, resources: [], aliases: {}, platform: {fontSheets: [], themeSheets: []}, issues: [{code: 'visual-context-unavailable', reason}], removedKeys: []};
}
const textFiles = (files: Files) => Object.fromEntries(Object.entries(files).filter(([p]) => /\.(?:twig|vue|s?css)$/.test(p)));
// Verification before the ZIP: aliases resolve, pages have visible sections and
// the keys the code references exist in the capture. CSS parity needs Sass and
// runs in `npm run check`.
export function contractReport(bundle: PreviewBundle, files: Files) {
  const paths = Object.keys(files), issues: PreviewIssue[] = [];
  const pages = bundle.pages.map(page => {
    const visible = expectedSections(page.raw), unresolved: {alias: string; reason: string}[] = [];
    for (const section of visible) try {resolveSectionFile(section.alias, page.kind, paths);} catch (error) {unresolved.push({alias: section.alias, reason: (error as Error).message});}
    for (const item of unresolved) issues.push({code: 'section-alias-unresolved', resource: page.id, reason: item.reason});
    if (!visible.length && bundle.source.kind !== 'demonstration') issues.push({code: 'page-without-main-sections', resource: page.id, reason: `Página ${page.kind} sem seções principais visíveis (position 1) na captura.`});
    const {header, footer} = pageSections(page.raw);
    return {id: page.id, kind: page.kind, context: page.context ?? null, sourceUrl: page.sourceUrl, visibleMainSections: visible.length, aliases: visible.map(v => v.alias), header: !!header, footer: !!footer, unresolved};
  });
  const referenced = referencedKeys(textFiles(files)), captured = capturedKeys(bundle.pages.map(p => p.raw)), removed = new Set(bundle.removedKeys);
  const keys = Object.fromEntries((['theme', 'section', 'merchant'] as const).map(scope => {
    const missing = referenced[scope].filter(key => !captured[scope].has(key)).map(key => ({key, reason: removed.has(key) ? 'removed-by-privacy-filter' : 'not-provided-by-storefront'}));
    return [scope, {referenced: referenced[scope].length, captured: captured[scope].size, missing}];
  }));
  const missingKeys = Object.values(keys).reduce((sum, scope) => sum + scope.missing.length, 0);
  if (missingKeys && bundle.source.kind !== 'demonstration') issues.push({code: 'referenced-keys-missing', reason: `${missingKeys} chaves referenciadas pelo código não vieram na captura; lista e motivo em report.json > contract.keys.`});
  const templates = paths.filter(p => /^templates\/[^/]+\.twig$/.test(p)).map(p => p.slice(10, -5)).map(kind => ({template: kind, captures: bundle.pages.filter(p => p.kind === kind).map(p => p.id)}));
  for (const item of templates) if (!item.captures.length && PAGE_KIND_LIST.includes(item.template as PageKind)) issues.push({code: 'page-kind-missing', resource: item.template, reason: `Template ${item.template} sem página capturada; a prévia mostra apenas cabeçalho e rodapé.`});
  return {contract: {version: CONTRACT_VERSION, pages, keys, templates, mainSectionPrecedence: 'window.data.config > themeConfig.sections (inferido; confirmar na plataforma)', cssParity: 'deferred-to-npm-run-check'}, issues};
}
function bytesByCategory(resources: PreviewResource[]) {
  const seen = new Set<string>(), output: Record<string, {count: number; bytes: number}> = {};
  for (const item of resources) {const entry = output[item.category] ||= {count: 0, bytes: 0}; entry.count++; if (!seen.has(item.path)) {seen.add(item.path); entry.bytes += item.bytes;}}
  return output;
}
export async function previewEntries(bundle: PreviewBundle, files: Files = {}): Promise<Assets> {
  if (bundle.format !== 'yampi-local-preview' || bundle.version !== 2 || !Number.isFinite(Date.parse(bundle.capturedAt))) throw new Error('Prévia inválida.');
  const limits = previewLimits(bundle.limits), entries: Assets = {}, seen = new Set<string>(); let total = 0;
  if (bundle.pages.length > limits.pages || bundle.resources.length > limits.resources || bundle.api.length > limits.apiRequests) throw new Error('Prévia ultrapassa limites.');
  for (const item of bundle.resources) {
    publicUrl(item.url, bundle.source.origin); previewPath(item.path);
    const bytes = bundle.assets[item.path];
    if (!bytes || bytes.length !== item.bytes || bytes.length > limits.resourceBytes || await hashBytes(bytes) !== item.sha256 || previewType(bytes, item.type) !== item.path.split('.').at(-1) || !['theme-css', 'font-css', 'css', 'font', 'icon', 'image', 'other'].includes(item.category)) throw new Error('Asset de prévia inválido: ' + item.path);
    if (!seen.has(item.path)) {if ((total += bytes.length) > limits.totalBytes) throw new Error('Assets ultrapassam limite total.'); seen.add(item.path); entries['preview/' + item.path] = bytes;}
  }
  if (Object.keys(bundle.assets).some(p => !seen.has(p))) throw new Error('Asset sem registro.');
  for (const [from, to] of Object.entries(bundle.aliases)) {publicUrl(from, bundle.source.origin); if (!bundle.resources.some(r => r.url === to)) throw new Error('Alias de imagem sem recurso capturado.');}
  const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v, null, 2) + '\n');
  // Raw captures are immutable; URL and route rewriting happens in the local tools.
  const pages = [], issues = [...bundle.issues];
  for (const page of bundle.pages) {
    if (!/^page-\d+$/.test(page.id) || !PAGE_KIND_LIST.includes(page.kind) || new URL(publicUrl(page.sourceUrl, bundle.source.origin)).origin !== bundle.source.origin) throw new Error('Página de prévia inválida.');
    const {raw} = sanitizeRaw(page.raw, page.id, limits), file = `raw/${page.id}.json`, bytes = encode(raw);
    entries['preview/' + file] = bytes;
    pages.push({id: page.id, kind: page.kind, ...(page.context ? {context: page.context} : {}), sourceUrl: page.sourceUrl, file, bytes: bytes.length, sha256: await hashBytes(bytes)});
  }
  let api;
  if (bundle.api.length) {
    const records = bundle.api.map(record => ({...record, body: sanitizeJson(record.body, record.path).value}));
    const bytes = encode({records});
    if (bytes.length > limits.apiBytes) throw new Error('Leituras públicas gravadas ultrapassam o limite.');
    entries['preview/raw/api.json'] = bytes; api = {file: 'raw/api.json', bytes: bytes.length, sha256: await hashBytes(bytes), records: records.length};
  }
  const {contract, issues: contractIssues} = contractReport(bundle, files);
  issues.push(...contractIssues);
  const {assets: _assets, pages: _pages, api: _api, removedKeys: _removed, ...manifest} = bundle;
  entries['preview/manifest.json'] = encode({...manifest, issues, pages, ...(api ? {api} : {})});
  entries['preview/report.json'] = encode({code: {integrity: 'hashes-and-sizes', completeness: 'stable-editor-inventory; independent remote inventory not verified'}, configuration: {source: bundle.source, status: bundle.source.kind === 'demonstration' ? 'demonstration' : 'partial', association: bundle.source.association}, contract, assets: {included: seen.size, byCategory: bytesByCategory(bundle.resources), aliases: Object.keys(bundle.aliases).length, issues}, api: {recorded: bundle.api.length, note: 'Somente GETs públicos anônimos; rotas não gravadas falham explicitamente na prévia.'}, compilation: 'not-run', initialization: 'not-run', visual: 'not-validated', capturedAt: bundle.capturedAt, toolVersion: bundle.toolVersion, limits});
  return entries;
}
