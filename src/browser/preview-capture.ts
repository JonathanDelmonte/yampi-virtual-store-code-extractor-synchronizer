import {parse} from 'acorn';
import {hashBytes, type Snapshot, type Files} from '../core/model';
import {publicUrl, sanitizeRaw, sanitizeJson, demonstration, previewLimits, previewType, PAGE_KIND_LIST, type Data, type PageKind, type PreviewBundle, type PreviewPage, type PreviewLimits, type PreviewIssue, type ResourceCategory, type RawPage} from '../core/preview';
import {pageSections, truthy, themeSheet, underlyingImage, plain} from '../../local-runtime/contract.mjs';
export interface FetchResult {bytes: Uint8Array; type: string; url: string}
export type PreviewFetch = (url: string) => Promise<FetchResult>;
type Ast = Record<string, any>;
function literal(node: Ast, depth = 0): unknown {
  if (depth > 40) throw new Error('Expressão estática aninhada demais.');
  if (node.type === 'Literal' && !node.regex && typeof node.value !== 'bigint') return node.value;
  if (node.type === 'ArrayExpression') return node.elements.map((n: Ast) => n ? literal(n, depth + 1) : null);
  if (node.type === 'ObjectExpression') {
    const out = Object.create(null);
    for (const p of node.properties) {
      if (p.type !== 'Property' || p.computed || p.method || p.kind !== 'init') throw new Error('Objeto dinâmico não é capturado.');
      const key = p.key.name ?? p.key.value;
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Chave insegura.');
      out[key] = literal(p.value, depth + 1);
    }
    return out;
  }
  if (node.type === 'UnaryExpression' && ['-', '+', '!'].includes(node.operator)) {const v = literal(node.argument, depth + 1); return node.operator === '!' ? !v : node.operator === '-' ? -Number(v) : Number(v);}
  if (node.type === 'CallExpression' && node.arguments.length === 1 && (node.callee.name === 'atob' || node.callee.type === 'MemberExpression' && !node.callee.computed && node.callee.object.name === 'window' && node.callee.property.name === 'atob')) {const value = literal(node.arguments[0], depth + 1); if (typeof value !== 'string' || value.length > 4 * 1024 * 1024) throw new Error('Base64 inválido.'); const binary = atob(value); try {return new TextDecoder('utf-8', {fatal: true}).decode(Uint8Array.from(binary, c => c.charCodeAt(0)));} catch {return binary;}}
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && !node.callee.computed && node.callee.object.name === 'JSON' && node.callee.property.name === 'parse' && node.arguments.length === 1) {
    const value = literal(node.arguments[0], depth + 1); if (typeof value !== 'string' || value.length > 4 * 1024 * 1024) throw new Error('JSON estático inválido.'); return JSON.parse(value);
  }
  throw new Error('Expressão dinâmica não é executada.');
}
// window.themeConfig, window.data and window.merchant, read without executing the page.
const NAMES = new Set(['themeConfig', 'data', 'merchant']);
export function staticContext(document: Document): {raw: Record<string, unknown>; issues: string[]} {
  const values: Record<string, unknown> = {}, issues: string[] = [];
  for (const script of document.querySelectorAll('script:not([src])')) {
    const text = script.textContent || ''; if (text.length > 4 * 1024 * 1024) {issues.push('Script/JSON excede limite; não foi truncado.'); continue;}
    if (script.getAttribute('type') === 'application/json' && ['yampi-preview-data', 'theme-data'].includes(script.id)) {
      try {const value = JSON.parse(text); if (plain(value)) for (const name of NAMES) if (value[name] !== undefined) values[name] = value[name];} catch {issues.push('JSON declarativo inválido.');} continue;
    }
    let body: Ast[]; try {body = (parse(text, {ecmaVersion: 'latest'}) as unknown as Ast).body;} catch {continue;}
    for (const statement of body) {
      const assignments = statement.type === 'VariableDeclaration' ? statement.declarations : statement.type === 'ExpressionStatement' && statement.expression.type === 'AssignmentExpression' && statement.expression.operator === '=' ? [statement.expression] : [];
      for (const assignment of assignments) {
        const target = assignment.id || assignment.left;
        const name = target.type === 'Identifier' ? target.name : target.type === 'MemberExpression' && !target.computed && target.object.name === 'window' ? target.property.name : undefined;
        if (!NAMES.has(name) || !(assignment.init || assignment.right)) continue;
        try {values[name] = literal(assignment.init || assignment.right);} catch (e) {issues.push(name + ': ' + (e as Error).message);}
      }
    }
  }
  return {raw: values, issues};
}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : plain(value) && Array.isArray(value.data) ? value.data : [];
const object = (value: unknown): Record<string, unknown> => plain(value) ? value : {};
function sameOrigin(value: unknown, base: string): string | undefined {
  if (typeof value !== 'string' || !value || /^(?:#|javascript:|mailto:|tel:)/i.test(value)) return undefined;
  try {const url = publicUrl(value, base); return new URL(url).origin === new URL(base).origin ? url : undefined;} catch {return undefined;}
}
function linkOf(item: unknown, base: string): string | undefined {
  for (const field of ['url_path', 'url', 'link', 'href', 'path']) {const url = sameOrigin(object(item)[field], base); if (url) return url;}
  return undefined;
}
// Data-driven candidates only; menu links are probed later to find missing kinds.
function candidates(raw: RawPage, base: string): Record<'category' | 'product' | 'pages' | 'promotion', string[]> {
  const merchant = object(raw.merchant), data = object(raw.data), content = object(data.content);
  const categories = [...list(merchant.categories), ...list(data.categories)].flatMap(c => [c, ...list(object(c).children)]);
  const products = [...list(data.products), ...list(object(content.data).data), ...list(content.data), object(data.product).data ?? data.product];
  const promotions = [merchant.promotion, ...list(merchant.promotions), ...list(data.promotions)];
  const links = (items: unknown[]) => [...new Set(items.map(item => linkOf(item, base)).filter((url): url is string => !!url))];
  return {category: links(categories), product: links(products), pages: links(list(merchant.pages)), promotion: links(promotions).concat(links(categories).filter(url => /promo|oferta/i.test(new URL(url).pathname)))};
}
// The theme marks <body> with the page name; data.context identifies a search.
function detectKind(raw: RawPage, expected: PageKind): {kind: PageKind; context?: string} {
  const data = object(raw.data);
  if (data.context === 'search') return {kind: 'category', context: 'search'};
  const fromBody = (raw.bodyClasses || []).find((name): name is PageKind => PAGE_KIND_LIST.includes(name as PageKind));
  const fromConfig = typeof raw.themeConfig?.page === 'string' && PAGE_KIND_LIST.includes(raw.themeConfig.page as PageKind) ? raw.themeConfig.page as PageKind : undefined;
  const kind = fromBody ?? fromConfig ?? expected;
  return typeof data.context === 'string' && data.context !== kind && /^[a-z_-]{1,40}$/.test(data.context) ? {kind, context: data.context} : {kind};
}
export interface ResourceCandidate {url: string; priority: number; category: ResourceCategory; source: 'html' | 'data' | 'css' | 'api'; attribute?: string; key?: string}
export interface PlannedRequest {url: string; path: string; query: string}
export interface PreviewDraft {bundle: PreviewBundle; resources: ResourceCandidate[]; api: PlannedRequest[]; documents: Map<string, Document>; themeAssets: string[]; cache?: Map<string, FetchResult>}
const IMAGE = /\.(?:png|jpe?g|webp|svg|gif)(?:[?#]|$)/i;
function addCandidate(output: Map<string, ResourceCandidate>, value: string, base: string, candidate: Omit<ResourceCandidate, 'url'>, issues?: PreviewIssue[]) {
  let url: string;
  try {url = publicUrl(value.startsWith('//') ? 'https:' + value : value, base);}
  catch (error) {const reason = (error as Error).message; if (issues && !issues.some(i => i.code === 'resource-rejected' && i.reason === reason)) issues.push({code: 'resource-rejected', resource: base, reason}); return;}
  const previous = output.get(url);
  if (!previous || candidate.priority < previous.priority || previous.source !== 'html' && candidate.source === 'html') output.set(url, {...candidate, url, priority: Math.min(candidate.priority, previous?.priority ?? Infinity)});
}
function cssUrls(css: string): {url: string; fontFace: boolean}[] {
  const faces = [...css.matchAll(/@font-face\s*\{[^{}]*\}/gi)].map(m => [m.index!, m.index! + m[0].length]);
  return [...css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)].filter(m => !/^(?:#|data:)/.test(m[1])).map(m => ({url: m[1], fontFace: faces.some(([start, end]) => m.index! > start && m.index! < end)}));
}
function htmlResources(doc: Document, base: string, logo: string | undefined, output: Map<string, ResourceCandidate>, issues: PreviewIssue[]) {
  const add = (value: string | null, candidate: Omit<ResourceCandidate, 'url'>) => {if (value && !value.startsWith('data:')) addCandidate(output, value, base, candidate, issues);};
  const srcset = (value: string | null, candidate: Omit<ResourceCandidate, 'url'>) => {for (const part of (value || '').split(',')) add(part.trim().split(/\s+/)[0] || null, candidate);};
  for (const link of doc.querySelectorAll('link[href]')) {
    const rel = (link.getAttribute('rel') || '').toLowerCase().split(/\s+/), as = (link.getAttribute('as') || '').toLowerCase();
    if (rel.includes('stylesheet') || rel.includes('preload') && as === 'style') add(link.getAttribute('href'), {priority: 1, category: 'css', source: 'html'});
    else if (rel.includes('preload') && as === 'font') add(link.getAttribute('href'), {priority: 1, category: 'font', source: 'html'});
    else if (rel.includes('preload') && as === 'image') {add(link.getAttribute('href'), {priority: 3, category: 'image', source: 'html', attribute: 'preload'}); srcset(link.getAttribute('imagesrcset'), {priority: 3, category: 'image', source: 'html', attribute: 'preload'});}
  }
  for (const element of doc.querySelectorAll('img,source,video[poster]')) {
    for (const attribute of ['src', 'data-src', 'poster']) {const value = element.getAttribute(attribute); if (value) add(value, {priority: logo && value === logo ? 2 : 4, category: 'image', source: 'html', attribute: 'src'});}
    for (const attribute of ['srcset', 'data-srcset']) srcset(element.getAttribute(attribute), {priority: 4, category: 'image', source: 'html', attribute: 'srcset'});
  }
  for (const element of doc.querySelectorAll('[style]')) for (const item of cssUrls(element.getAttribute('style') || '')) add(item.url, {priority: 5, category: 'image', source: 'html', attribute: 'style'});
  for (const style of doc.querySelectorAll('style')) {
    const css = style.textContent || '';
    for (const item of cssUrls(css)) add(item.url, item.fontFace ? {priority: 1, category: 'font', source: 'html'} : {priority: 5, category: 'image', source: 'html', attribute: 'style'});
    for (const m of css.matchAll(/@import\s+(?:url\(\s*["']?([^"')\s]+)["']?\s*\)|["']([^"']+)["'])/gi)) add(m[1] || m[2], {priority: 1, category: 'css', source: 'html'});
  }
}
// Image-like strings in the public data. Banners above the fold first, then products.
function dataResources(value: unknown, base: string, output: Map<string, ResourceCandidate>, trail: string[] = [], depth = 0) {
  if (depth > 32) return;
  if (typeof value === 'string') {
    const key = trail.at(-1) || '', path = trail.join('.').toLowerCase();
    if (!IMAGE.test(value) && !/(?:^|_)(?:image|logo|banner|thumb|src)(?:_|$)|^(?:url|src)$/i.test(key)) return;
    if (!/^(?:https?:)?\/\//i.test(value) && !value.startsWith('/')) return;
    if (!IMAGE.test(value) && !/^https?:\/\//i.test(value)) return;
    const priority = /logo/.test(key) ? 2 : /first_banner|main_banner|banner/.test(path) ? 3 : /product|image|collection/.test(path) ? 4 : 5;
    addCandidate(output, value, base, {priority, category: 'image', source: 'data', key});
    return;
  }
  if (Array.isArray(value)) value.forEach((item, i) => dataResources(item, base, output, [...trail, String(i)], depth + 1));
  else if (plain(value)) for (const [key, item] of Object.entries(value)) dataResources(item, base, output, [...trail, key], depth + 1);
}
// $assets-relative paths used by the theme Sass, for example image('x.svg').
export function themeAssetPaths(files: Files): string[] {
  const output = new Set<string>(), sources = Object.entries(files).filter(([p]) => /\.s?css$/.test(p)).map(([, text]) => text);
  const prefix = sources.map(text => text.match(/@function\s+image\s*\(\s*\$(\w+)\s*\)\s*\{\s*@return\s+\$assets\s*\+\s*["']([^"']*)["']\s*\+\s*\$\1/)?.[2]).find(Boolean) ?? '/img/';
  for (const text of sources) {
    for (const m of text.matchAll(/\bimage\(\s*["']([^"'$#{}]+)["']\s*\)/g)) output.add((prefix + m[1]).replace(/^\/+/, ''));
    for (const m of text.matchAll(/\$assets\s*\+\s*["']\/?([^"'$#{}]+)["']/g)) if (!m[1].endsWith('/')) output.add(m[1]);
    for (const m of text.matchAll(/#\{\$assets\}\/?([^"')\s$#{}]+)/g)) output.add(m[1]);
  }
  return [...output];
}
const API_ORIGIN = 'https://api.dooki.com.br';
// GETs the visible sections' components would make, recorded for local replay.
export function planApi(pages: PreviewPage[], limits: PreviewLimits): {base?: string; requests: PlannedRequest[]} {
  const alias = pages.map(p => p.raw.merchant?.alias).find((value): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/i.test(value));
  if (!alias) return {requests: []};
  const base = `${API_ORIGIN}/v2/${alias}/public/`, collections = new Map<string, number>(), banners = new Set<string>(), slugs = new Set<string>();
  const walk = (value: unknown, trail: string[], limit: number, depth = 0) => {
    if (!plain(value) || depth > 5) return;
    const path = trail.join('.').toLowerCase(), ids = Array.isArray(value.ids) ? value.ids.filter(id => typeof id === 'number' || typeof id === 'string' && /^[\w-]{1,40}$/.test(id)).map(String) : [];
    if (ids.length && /collection/.test(path) && !/banner/.test(path)) for (const id of ids) collections.set(id, Math.max(collections.get(id) || 0, limit));
    else if (ids.length && /banner/.test(path)) for (const id of ids) banners.add(id);
    if (Array.isArray(value.slugs)) for (const slug of value.slugs) if (typeof slug === 'string' && /^[\w-]{1,120}$/.test(slug)) slugs.add(slug);
    for (const [key, item] of Object.entries(value)) walk(item, [...trail, key], limit, depth + 1);
  };
  for (const page of pages) for (const section of pageSections(page.raw).main.filter(s => truthy(s.visible))) {
    const params = object(section.params), limit = [params.visible_products, params.limit, params.products_limit, params.quantity].map(Number).find(n => Number.isInteger(n) && n > 0 && n <= 60) ?? 12;
    walk(params, [String(section.section_alias || '')], limit);
  }
  const requests: PlannedRequest[] = [], add = (path: string, query: URLSearchParams) => {const q = query.toString(); requests.push({url: base + path + (q ? '?' + q : ''), path, query: q});};
  for (const [id, limit] of collections) add('catalog/collections', new URLSearchParams([['id[]', id], ['limit', String(limit)]]));
  if (banners.size) add('catalog/banners', new URLSearchParams([['status', 'active'], ...[...banners].slice(0, 50).map(id => ['id[]', id] as [string, string])]));
  for (const slug of [...slugs].slice(0, 24)) add('catalog/products/' + encodeURIComponent(slug), new URLSearchParams());
  return {base, requests: requests.slice(0, limits.apiRequests)};
}
// One public page, read without executing it: the three objects after the blocklist, the draft
// theme settings of the editor on top, and the kind the page says it is.
export interface ReadPage {raw: RawPage; kind: PageKind; context?: string; doc: Document; issues: PreviewIssue[]; removed: string[]; editor: boolean}
export async function readPage(url: string, fetcher: PreviewFetch, limits: PreviewLimits, expected: PageKind, editorData?: Data): Promise<ReadPage> {
  const response = await fetcher(url);
  if (response.bytes.length > 4 * 1024 * 1024 || !response.type.startsWith('text/html')) throw new Error('Página não é HTML público dentro do limite.');
  if (publicUrl(response.url, url) !== url) throw new Error('Redirecionamento não autorizado.');
  const doc = new DOMParser().parseFromString(new TextDecoder('utf-8', {fatal: true}).decode(response.bytes), 'text/html');
  const parsed = staticContext(doc);
  const bodyClasses = (doc.body?.className || '').split(/\s+/).filter(name => /^[a-z0-9_-]{1,100}$/i.test(name)).slice(0, 30);
  const clean = sanitizeRaw({...parsed.raw, bodyClasses}, url, limits);
  if (!clean.raw.themeConfig && !clean.raw.merchant) throw new Error('Configuração e identidade públicas não encontradas; nenhuma variável foi executada.');
  const raw = applyEditor(clean.raw, editorData);
  return {raw, ...detectKind(raw, expected), doc, issues: [...parsed.issues.map(reason => ({code: 'static-data', resource: url, reason})), ...clean.issues], removed: clean.removed, editor: raw !== clean.raw};
}
function applyEditor(raw: RawPage, editor: Data | undefined): RawPage {
  const config = object(editor?.themeConfig);
  if (!plain(config.theme)) return raw;
  // Draft theme settings win on every route; main sections stay page-specific.
  const edges = new Map((Array.isArray(config.sections) ? config.sections : []).filter(plain).filter(s => [0, 2].includes(Number(s.position))).map(s => [String(s.section_alias), s]));
  const sections = (Array.isArray(raw.themeConfig?.sections) ? raw.themeConfig!.sections : []).map(s => plain(s) && edges.has(String(s.section_alias)) ? edges.get(String(s.section_alias)) : s);
  return {...raw, themeConfig: {...raw.themeConfig, theme: config.theme, sections} as Data};
}
export async function preparePreview(snapshot: Snapshot, fetcher: PreviewFetch, options: {limits?: Partial<PreviewLimits>; editorData?: Data; enabled?: boolean; signal?: AbortSignal} = {}): Promise<PreviewDraft> {
  const paths = Object.keys(snapshot.files), themeAssets = themeAssetPaths(snapshot.files);
  const bundle = demonstration(snapshot.context, options.enabled === false ? 'Captura visual desativada ou sem permissão.' : 'A vitrine não expõe contexto estático compatível.', paths);
  bundle.limits = previewLimits(options.limits);
  const docs = new Map<string, Document>(), resources = new Map<string, ResourceCandidate>();
  if (options.enabled === false) return {bundle, resources: [], api: [], documents: docs, themeAssets};
  const origin = publicUrl(snapshot.context.previewOrigin, snapshot.context.previewOrigin), fetched = new Set<string>(), removed = new Set<string>();
  const demo = bundle.pages;
  bundle.pages = []; bundle.issues = [];
  const pool: Record<'category' | 'product' | 'pages' | 'promotion' | 'unknown', string[]> = {category: [], product: [], pages: [], promotion: [], unknown: []};
  const remember = (kind: keyof typeof pool, urls: string[]) => {for (const url of urls) if (!pool[kind].includes(url) && !fetched.has(url)) pool[kind].push(url);};
  async function capture(url: string, expected: PageKind, probe = false): Promise<PreviewPage | undefined> {
    if (fetched.has(url) || bundle.pages.length >= bundle.limits.pages) return undefined;
    if (options.signal?.aborted) throw new Error('Captura de prévia cancelada.');
    fetched.add(url);
    try {
      const read = await readPage(url, fetcher, bundle.limits, expected, options.editorData), {raw, doc} = read;
      if (read.editor) bundle.source = {kind: 'editor', origin: snapshot.context.previewOrigin, association: 'same-editor'};
      const found = candidates(raw, url);
      for (const kind of ['category', 'product', 'pages', 'promotion'] as const) remember(kind, found[kind]);
      if (expected === 'home') remember('unknown', [...doc.querySelectorAll('a[href]')].map(a => sameOrigin(a.getAttribute('href'), url)).filter((u): u is string => !!u && u !== url).slice(0, 40));
      // A probe only stays when it fills a missing page kind.
      if (probe && bundle.pages.some(p => p.kind === read.kind && (p.context ?? '') === (read.context ?? ''))) return undefined;
      bundle.issues.push(...read.issues); read.removed.forEach(key => removed.add(key));
      const page: PreviewPage = {id: 'page-' + bundle.pages.length, kind: read.kind, ...(read.context ? {context: read.context} : {}), sourceUrl: url, raw};
      bundle.pages.push(page); docs.set(url, doc);
      htmlResources(doc, url, typeof raw.merchant?.logo_url === 'string' ? raw.merchant.logo_url : undefined, resources, bundle.issues);
      dataResources({merchant: raw.merchant, themeConfig: raw.themeConfig, data: raw.data}, url, resources);
      return page;
    } catch (e) {bundle.issues.push({code: 'page-unavailable', resource: url, reason: (e as Error).message}); return undefined;}
  }
  const next = async (kind: 'category' | 'product' | 'pages' | 'promotion') => {while (pool[kind].length && bundle.pages.length < bundle.limits.pages) {const page = await capture(pool[kind].shift()!, kind); if (page) return page;} return undefined;};
  const home = await capture(origin, 'home');
  if (home) {
    if (bundle.source.kind !== 'editor') bundle.source = {kind: 'published', origin: snapshot.context.previewOrigin, association: 'published-unverified'};
    bundle.issues.push({code: 'published-association', reason: 'A vitrine publicada pode diferir do rascunho. O tema publicado não foi vinculado independentemente ao estado do editor; npm run check compara o CSS servido com o Sass exportado.'});
    if (!Object.keys(object(object(home.raw.themeConfig?.theme).params)).length) bundle.issues.push({code: 'configuration-incomplete', reason: 'Parâmetros visuais do tema não foram encontrados em formato estático compatível.'});
  }
  // One page of each supported kind first, then the remaining budget.
  for (const kind of ['category', 'product', 'pages', 'promotion'] as const) if (!bundle.pages.some(p => p.kind === kind)) await next(kind);
  let probes = 0;
  while (pool.unknown.length && probes < 6 && bundle.pages.length < bundle.limits.pages && PAGE_KIND_LIST.some(kind => !bundle.pages.some(p => p.kind === kind))) {probes++; await capture(pool.unknown.shift()!, 'home', true);}
  if (bundle.pages.length < bundle.limits.pages && home) {
    const name = bundle.pages.flatMap(p => [...list(object(object(p.raw.data).content).data), ...list(object(object(object(p.raw.data).content).data).data)]).map(item => object(item).name).find((n): n is string => typeof n === 'string');
    const term = (name || 'a').split(/\s+/).find(word => word.length >= 3) || 'a';
    await capture(origin.replace(/\/$/, '') + '/busca?q=' + encodeURIComponent(term.toLowerCase()), 'category');
  }
  for (const kind of ['product', 'category'] as const) if (bundle.pages.length < bundle.limits.pages) await next(kind);
  const remaining = pool.category.length + pool.product.length;
  if (remaining) bundle.issues.push({code: 'page-limit', reason: `Recorte limitado a ${bundle.limits.pages} páginas; ${remaining} candidatas restantes.`});
  for (const kind of PAGE_KIND_LIST) if (!bundle.pages.some(p => p.kind === kind)) bundle.issues.push({code: 'page-kind-missing', resource: kind, reason: `Nenhuma página "${kind}" foi encontrada nos dados públicos; a prévia informa a ausência.`});
  if (!bundle.pages.some(p => p.context === 'search')) bundle.issues.push({code: 'page-kind-missing', resource: 'search', reason: 'Página de busca não capturada.'});
  if (!bundle.pages.length) {bundle.pages = demo; bundle.source = {kind: 'demonstration', origin: snapshot.context.previewOrigin, association: 'unavailable'}; bundle.issues.push({code: 'visual-context-unavailable', reason: 'Nenhuma página visual compatível foi capturada. A prévia será demonstrativa.'});}
  bundle.removedKeys = [...removed];
  bundle.issues = mergeIssues(bundle.issues);
  const plan = bundle.source.kind === 'demonstration' ? {requests: [] as PlannedRequest[]} : planApi(bundle.pages, bundle.limits);
  if (plan.base) bundle.platform.apiBase = plan.base;
  return {bundle, resources: [...resources.values()], api: plan.requests, documents: docs, themeAssets};
}
const KEEP_SUBSETS = new Set(['latin', 'latin-ext']);
function coversLatin(range: string): boolean {
  return range.split(',').some(part => {const m = part.trim().match(/^U\+([0-9a-f?]+)(?:-([0-9a-f]+))?$/i); if (!m) return true; const start = parseInt(m[1].replace(/\?/g, '0'), 16), end = parseInt((m[2] || m[1]).replace(/\?/g, 'f'), 16); return start <= 0x24f && end >= 0;});
}
// Google-style font sheets: only latin/latin-ext faces, preferring WOFF2.
function fontFaces(css: string, base: string) {
  return [...css.matchAll(/(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^{}]*)\}/gi)].map(m => {
    const subset = m[1]?.toLowerCase(), body = m[2], range = body.match(/unicode-range\s*:\s*([^;]+)/i)?.[1];
    const sources = [...body.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)\s*(?:format\(\s*["']?([\w-]+)["']?\s*\))?/gi)].map(x => ({url: x[1], format: x[2]}));
    const preferred = sources.find(s => s.format === 'woff2' || /\.woff2(?:[?#]|$)/i.test(s.url)) || sources[0];
    let url: string | undefined; try {url = preferred && !preferred.url.startsWith('data:') ? publicUrl(preferred.url, base) : undefined;} catch {url = undefined;}
    return {whole: m[0], subset, family: body.match(/font-family\s*:\s*([^;]+)/i)?.[1].replace(/["']/g, '').trim() || '', keep: subset ? KEEP_SUBSETS.has(subset) : range ? coversLatin(range) : true, url};
  });
}
function rewriteSheet(css: string, base: string, map: Map<string, string>): string {
  const local = (value: string) => {try {return map.get(publicUrl(value.startsWith('//') ? 'https:' + value : value, base));} catch {return undefined;}};
  return css.replace(/(?:\/\*\s*[\w-]+\s*\*\/\s*)?@font-face\s*\{([^{}]*)\}/gi, (whole, body: string) => {
    const face = fontFaces(whole, base)[0];
    const target = face?.url ? map.get(face.url) : undefined;
    // Uncaptured or non-latin faces are removed; the fallback stack stays.
    if (!face || !face.keep || !target) return '';
    const format = /\.woff2$/.test(target) ? 'woff2' : /\.woff$/.test(target) ? 'woff' : /\.ttf$/.test(target) ? 'truetype' : 'opentype';
    return '@font-face{' + body.replace(/(?:^|;)\s*src\s*:[^;]*/gi, '').replace(/;?\s*$/, '') + `;src:url("${target}") format("${format}")}`;
  }).replace(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi, (whole, value: string) => {
    if (/^(?:#|data:|\/preview\/assets\/)/.test(value)) return whole;
    const target = local(value);
    return target ? `url("${target}")` : IMAGE.test(value) ? 'url("/__local/placeholder.svg")' : 'url("")';
  });
}
// The same sanitization note on every page becomes one issue with a page count. A note merged
// before (the representative pages) keeps adding to its count when more pages come.
export function mergeIssues(issues: PreviewIssue[]): PreviewIssue[] {
  const output: (PreviewIssue & {count: number})[] = [], index = new Map<string, PreviewIssue & {count: number}>();
  for (const issue of issues) {
    const merged = ['company-redacted', 'keys-removed', 'values-redacted', 'active-content-neutralized'].includes(issue.code), counted = merged ? issue.reason.match(/^([\s\S]*) \((\d+) páginas\)$/) : null;
    const reason = counted ? counted[1] : issue.reason, weight = counted ? Number(counted[2]) : 1, key = merged ? issue.code + '\u0000' + reason : undefined;
    const current = key ? index.get(key) : undefined;
    if (current) {current.count += weight; continue;}
    const entry = {...issue, reason, count: weight}; output.push(entry); if (key) index.set(key, entry);
  }
  return output.map(({count, ...issue}) => count > 1 ? {...issue, reason: `${issue.reason} (${count} páginas)`} : issue);
}
const unauthorized = 'Origem não autorizada para leitura.';
export function unauthorizedOrigins(bundle: PreviewBundle): string[] {
  return [...new Set(bundle.issues.filter(i => ['asset-unavailable', 'api-unavailable'].includes(i.code) && i.reason === unauthorized && i.resource).map(i => new URL(i.resource!).origin))];
}
export async function finishPreview(draft: PreviewDraft, fetcher: PreviewFetch, allowedOrigins: string[], signal?: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<PreviewBundle> {
  const check = () => {if (signal?.aborted) throw new Error('Captura de recursos cancelada.');}; check();
  // The draft keeps the original public data for a later permission round. The
  // successful-response cache belongs only to this draft, never to another export.
  const bundle = structuredClone(draft.bundle), cache = draft.cache ||= new Map<string, FetchResult>();
  bundle.resources = []; bundle.assets = {}; bundle.aliases = {}; bundle.api = []; bundle.platform = {...bundle.platform, fontSheets: [], themeSheets: []};
  const get = async (url: string) => {if (!allowedOrigins.includes(new URL(url).origin)) throw new Error(unauthorized); const cached = cache.get(url); if (cached) return cached; const response = await fetcher(url); return response;};
  const removed = new Set(bundle.removedKeys), candidates = new Map(draft.resources.map(c => [c.url, c]));
  let apiBytes = 0, done = 0;
  // Public reads first: their bodies reveal banner and product images.
  for (let i = 0; i < draft.api.length; i += 4) {
    check();
    const batch = draft.api.slice(i, i + 4), results = await Promise.all(batch.map(async request => {try {return {response: await get(request.url)};} catch (error) {return {error};}}));
    check();
    batch.forEach((request, index) => {
      try {
        const result = results[index]; if ('error' in result) throw result.error;
        const response = result.response!;
        if (response.url !== request.url) throw new Error('Redirecionamento rejeitado.');
        if (!/json/i.test(response.type) || response.bytes.length > bundle.limits.resourceBytes || (apiBytes += response.bytes.length) > bundle.limits.apiBytes) throw new Error('Resposta pública não é JSON dentro do limite.');
        const clean = sanitizeJson(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(response.bytes)), request.url);
        clean.removed.forEach(key => removed.add(key)); bundle.issues.push(...clean.issues.map(issue => ({...issue, resource: request.path})));
        cache.set(request.url, response);
        bundle.api.push({method: 'GET', path: request.path, query: request.query, url: request.url, status: 200, body: clean.value});
        const found = new Map<string, ResourceCandidate>(); dataResources(clean.value, request.url, found, [request.path]);
        for (const item of found.values()) if (!candidates.has(item.url)) candidates.set(item.url, {...item, source: 'api', priority: /banner/.test(request.path) ? 3 : 4});
      } catch (e) {bundle.issues.push({code: 'api-unavailable', resource: request.url, reason: (e as Error).message});}
    });
  }
  // One variant per underlying image: the rendered one (src/preload/srcset), else data.
  const rank = (c: ResourceCandidate) => (c.source === 'html' ? 0 : 10) + (c.attribute === 'src' ? 0 : c.attribute === 'preload' ? 1 : c.attribute === 'srcset' ? 2 : 3) + (/zoom|large|original/i.test(c.key || '') ? 5 : 0);
  const chosen = new Map<string, ResourceCandidate>();
  for (const item of [...candidates.values()].filter(c => c.category === 'image')) {const key = underlyingImage(item.url), current = chosen.get(key); if (!current || rank(item) < rank(current)) chosen.set(key, {...item, priority: Math.min(item.priority, current?.priority ?? Infinity)}); else if (item.priority < current.priority) current.priority = item.priority;}
  const queue: ResourceCandidate[] = [];
  const enqueue = (item: ResourceCandidate) => {const index = queue.findIndex(q => q.priority > item.priority); if (index < 0) queue.push(item); else queue.splice(index, 0, item);};
  for (const item of candidates.values()) {
    if (item.category !== 'image') {enqueue(item); continue;}
    const winner = chosen.get(underlyingImage(item.url))!;
    if (winner.url === item.url) enqueue(winner); else bundle.aliases[item.url] = winner.url;
  }
  const seen = new Set<string>(), map = new Map<string, string>(), sheets: {url: string; css: string; category: ResourceCategory}[] = [], skipped: Record<string, number> = {}, votes = new Map<string, number>();
  const captured = new Set<string>(), skippedUrls: string[] = [];
  let total = 0, count = 0;
  const pages = PAGE_KIND_LIST as string[], capturedUrl = new Map<string, string>();
  while (queue.length) {
    check();
    const batch: ResourceCandidate[] = [];
    while (queue.length && batch.length < 4) {
      const item = queue.shift()!;
      if (seen.has(item.url)) continue; seen.add(item.url);
      if (item.category === 'image') {const key = underlyingImage(item.url); if (captured.has(key)) {bundle.aliases[item.url] = capturedUrl.get(key)!; continue;}}
      if (count >= bundle.limits.resources) {skipped[item.category] = (skipped[item.category] || 0) + 1; if (skippedUrls.length < 10) skippedUrls.push(item.url); continue;}
      count++; batch.push(item);
    }
    if (!batch.length) continue;
    // Only public resources run concurrently; editor reads remain sequential.
    const results = await Promise.all(batch.map(async item => {try {return {response: await get(item.url)};} catch (error) {return {error};}}));
    check();
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      try {
        const result = results[i]; if ('error' in result) throw result.error;
        const response = result.response!, bytes = response.bytes;
        if (response.url !== item.url) throw new Error('Redirecionamento rejeitado.');
        // An empty stylesheet is valid (a page without mobile rules); other types are not.
        if (!bytes.length && !/^text\/css\b/i.test(response.type) || bytes.length > bundle.limits.resourceBytes) throw new Error('Recurso vazio ou acima dos limites de tamanho.');
        const ext = previewType(bytes, response.type), sha = await hashBytes(bytes), file = 'assets/' + sha + '.' + ext;
        if (!bundle.assets[file] && total + bytes.length > bundle.limits.totalBytes) {skipped[item.category] = (skipped[item.category] || 0) + 1; if (skippedUrls.length < 10) skippedUrls.push(item.url); continue;}
        if (!bundle.assets[file]) {bundle.assets[file] = bytes; total += bytes.length;}
        cache.set(item.url, {...response, bytes: bundle.assets[file]});
        let category: ResourceCategory = item.category;
        if (ext === 'css') {
          const css = new TextDecoder().decode(bytes), sheet = themeSheet(item.url, pages);
          category = sheet ? 'theme-css' : /@font-face/i.test(css) ? 'font-css' : 'css';
          sheets.push({url: item.url, css, category});
          if (sheet) bundle.platform.themeSheets.push({url: item.url, group: sheet.group, ...(sheet.page ? {page: sheet.page} : {})});
          for (const face of fontFaces(css, item.url)) if (face.url && face.keep) enqueue({url: face.url, priority: 1, category: 'font', source: 'css'});
          for (const m of css.matchAll(/@import\s+(?:url\(\s*["']?([^"')\s]+)["']?\s*\)|["']([^"']+)["'])/gi)) {try {enqueue({url: publicUrl(m[1] || m[2], item.url), priority: 1, category: 'css', source: 'css'});} catch {/* Unsafe imports are dropped when rewriting. */}}
          for (const ref of cssUrls(css).filter(r => !r.fontFace)) {
            let url: string; try {url = publicUrl(ref.url.startsWith('//') ? 'https:' + ref.url : ref.url, item.url);} catch {continue;}
            const relative = sheet ? draft.themeAssets.find(path => url.endsWith('/' + path)) : undefined;
            if (relative) {const base = url.slice(0, -(relative.length + 1)); votes.set(base, (votes.get(base) || 0) + 1);}
            if (!IMAGE.test(url)) continue;
            const key = underlyingImage(url), winner = chosen.get(key);
            if (winner && winner.url !== url) {bundle.aliases[url] = winner.url; continue;}
            enqueue({url, priority: relative ? 2 : 5, category: relative ? 'icon' : 'image', source: 'css'});
          }
        } else if (item.category === 'image') {captured.add(underlyingImage(item.url)); capturedUrl.set(underlyingImage(item.url), item.url);}
        bundle.resources.push({url: item.url, path: file, type: response.type, bytes: bytes.length, sha256: sha, category, priority: item.priority});
        map.set(item.url, '/preview/' + file);
      } catch (e) {bundle.issues.push({code: 'asset-unavailable', resource: item.url, reason: (e as Error).message});}
      onProgress?.(++done, Math.min(bundle.limits.resources, done + queue.length));
    }
  }
  const omitted = Object.entries(skipped);
  if (omitted.length) bundle.issues.push({code: 'resource-limit', reason: `Orçamento de ${bundle.limits.resources} recursos e ${Math.round(bundle.limits.totalBytes / 1048576)} MiB atingido; omitidos: ` + omitted.map(([category, n]) => `${n} ${category}`).join(', ') + ` (ex.: ${skippedUrls.join(', ')}). A ordem prioriza CSS, fontes, ícones, logotipo e banners.`});
  if (votes.size) bundle.platform.assetsBase = [...votes].sort((a, b) => b[1] - a[1])[0][0];
  for (const [alias, target] of Object.entries(bundle.aliases)) if (!map.has(target)) delete bundle.aliases[alias];
  // Rewrite captured CSS after all dependencies are known. Imported sheets are
  // rewritten first so parents reference their final hashes.
  const byUrl = new Map(sheets.map(s => [s.url, s])), built = new Set<string>();
  const build = async (url: string, stack: Set<string>): Promise<void> => {
    if (built.has(url)) return;
    const sheet = byUrl.get(url)!, item = bundle.resources.find(r => r.url === url)!; stack = new Set([...stack, url]);
    let css = sheet.css;
    for (const [whole, target, quoted] of [...css.matchAll(/@import\s+(?:url\(\s*["']?([^"')\s]+)["']?\s*\)|["']([^"']+)["'])[^;]*;/gi)]) {
      let dependency; try {dependency = publicUrl(target || quoted, url);} catch {css = css.split(whole).join('/* Import inseguro rejeitado. */'); continue;}
      if (stack.has(dependency)) {bundle.issues.push({code: 'css-import-cycle', resource: url, reason: 'Import CSS cíclico removido; demais regras preservadas.'}); css = css.split(whole).join('/* Import cíclico indisponível na prévia portátil. */'); continue;}
      if (byUrl.has(dependency)) await build(dependency, stack);
      const local = map.get(dependency); css = css.split(whole).join(local ? whole.replace(target || quoted, local) : '/* Import não capturado; consulte o relatório visual. */');
    }
    const rewritten = new TextEncoder().encode(rewriteSheet(css, url, map)), sha = await hashBytes(rewritten), file = 'assets/' + sha + '.css';
    bundle.assets[file] = rewritten; const old = item.path; item.path = file; item.bytes = rewritten.length; item.sha256 = sha; map.set(url, '/preview/' + file);
    if (!bundle.resources.some(r => r.path === old)) delete bundle.assets[old];
    if (sheet.category === 'font-css') {const families = [...new Set(fontFaces(css, url).filter(f => f.keep && f.url && map.has(f.url)).map(f => f.family).filter(Boolean))]; if (families.length) bundle.platform.fontSheets.push({url, families});}
    built.add(url);
  };
  for (const url of byUrl.keys()) await build(url, new Set());
  for (const file of Object.keys(bundle.assets)) if (!bundle.resources.some(r => r.path === file)) delete bundle.assets[file];
  bundle.removedKeys = [...removed];
  check();
  return bundle;
}
